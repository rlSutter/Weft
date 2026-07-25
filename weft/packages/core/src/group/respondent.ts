// Group-as-respondent — kind 4911 declaration + grp-tagged 4912 replies.
// DD §35 F9 + §36.2 (completes the F9 disposition).
//
// A greeter publishes a 4911 declaration listing:
//   - the group's declared-interest embeddings (what the group answers about)
//   - the scope_nyms authorized to speak for the group in reply
// The declaration is **encrypted under the group's key** (per DD §36.2
// correction), so relays learn nothing about the group's interest profile.
//
// When a member's client sees an ask matching one of the declared interests
// AND the member's scope_nym is on the authorized list, the client emits a
// `grp`-tagged 4912 match reply carrying a scope-bound credential
// presentation. A seeker who verifies the reply learns "a member of this
// cell wants to talk" — never which member.
//
// **Not integrated with the query engine in this task.** The query engine
// (M5 routing) emits person-to-person 4912 replies. Wiring it to also emit
// grp replies when appropriate is a follow-up refinement — M10-T5 only
// ships the wire kinds and the auth logic. That's enough to prove the
// design property "an authorized member can construct a valid group reply
// and an unauthorized one cannot."
//
// Sources of law:
//   DD §35 F9              group-as-respondent
//   DD §36.2               4911 encrypted under group key; grp-tagged 4912
//   Build list M10-T5

import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';

import { Tags } from '../kinds/tags';
import { openWithGroupKey, sealWithGroupKey } from './group-crypto';
import { generateKeypair } from '../keys/keys';
import { SCOPE_NYM_BYTES, verifyPresentation, type Presentation } from '../cred/cred';
import { serializePresentation, type PresentationWire } from './join';

const KIND_GROUP_INTEREST_DECLARATION = 4911;
const KIND_MATCH_REPLY = 4912;

/** Bumped whenever the respondent wire schema changes. */
export const RESPONDENT_WIRE_VERSION = 1;

// ---------------------------------------------------------------------------
// 4911 group-interest declaration
// ---------------------------------------------------------------------------

/**
 * The group's public-to-members statement of "we answer about these things,
 * and these members may speak for us." Published on the group's channel
 * `h`, encrypted under the group key.
 */
export interface GroupInterestDeclaration {
  readonly v: number;
  /** hex — the cell id (== genesis charter event id). */
  cellId: string;
  /**
   * Array of quantized interest embeddings (int8[384] each, base64url
   * or hex). Matches the format QueryEngine uses in MatchReplyPayload
   * bodies. A query is a match if any of these has cosine ≥ threshold.
   */
  interests: readonly InterestEntry[];
  /**
   * hex scope_nyms authorized to emit grp replies on the group's behalf
   * (each 96 hex chars = 48 bytes = one G1-compressed scope_nym).
   */
  authorizedScopeNyms: readonly string[];
  /** Unix seconds of publication (for expiry / renewal calibration). */
  issuedAt: number;
}

export interface InterestEntry {
  /** Short human tag for the interest — never leaves the group. */
  label: string;
  /** hex — quantized embedding (int8[384] as 384 hex bytes). */
  embedding: string;
}

/**
 * Build a signed 4911 event. Content is the declaration serialized as JSON
 * then encrypted under `groupKey`. Outer event signed by `greeterSecret`
 * (identity is inside the group — this is fine; only joiner identity is
 * blinded from greeters, not the other way around).
 */
export function buildInterestDeclarationEvent(
  declaration: Omit<GroupInterestDeclaration, 'v'>,
  groupKey: Uint8Array,
  greeterSecret: Uint8Array,
  channelId: string,
  now: number = Math.floor(Date.now() / 1000),
): NostrEvent {
  const wire: GroupInterestDeclaration = {
    v: RESPONDENT_WIRE_VERSION,
    ...declaration,
  };
  const plaintext = new TextEncoder().encode(JSON.stringify(wire));
  const ct = sealWithGroupKey(groupKey, plaintext);
  // 4911 is class P — no expiration tag (persistent). Charter relays keep
  // it as long as the greeter's declaration is current.
  return finalizeEvent(
    {
      kind: KIND_GROUP_INTEREST_DECLARATION,
      created_at: now,
      tags: [[Tags.H, channelId]],
      content: bytesToHex(ct),
    },
    greeterSecret,
  );
}

/**
 * Decrypt and parse a 4911 event with the group key. Returns null on
 * malformed input or wrong key.
 */
export function parseInterestDeclarationEvent(
  evt: NostrEvent,
  groupKey: Uint8Array,
): GroupInterestDeclaration | null {
  if (evt.kind !== KIND_GROUP_INTEREST_DECLARATION) return null;
  try {
    const ct = hexToBytes(evt.content);
    const pt = openWithGroupKey(groupKey, ct);
    if (pt === null) return null;
    const parsed = JSON.parse(new TextDecoder().decode(pt)) as GroupInterestDeclaration;
    if (parsed.v !== RESPONDENT_WIRE_VERSION) return null;
    if (!Array.isArray(parsed.interests) || !Array.isArray(parsed.authorizedScopeNyms)) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** True iff `scopeNym` is on the declaration's authorized list. */
export function isAuthorizedToRespond(
  declaration: GroupInterestDeclaration,
  scopeNym: Uint8Array,
): boolean {
  if (scopeNym.length !== SCOPE_NYM_BYTES) return false;
  const hex = bytesToHex(scopeNym);
  return declaration.authorizedScopeNyms.includes(hex);
}

// ---------------------------------------------------------------------------
// grp-tagged 4912 match reply
// ---------------------------------------------------------------------------

/**
 * A group-mode match reply. Same 4912 kind number as person-to-person
 * match replies (from M5 routing), distinguished by the `grp` tag on the
 * outer event. Content carries a scope-bound credential presentation
 * proving the responder is an authorized member of {cellId}.
 */
export interface GroupMatchReplyPayload {
  readonly v: number;
  /** Standard reply fields — mirror MatchReplyPayload from routing. */
  scoreBucket: 'high' | 'medium';
  hopEstimate: number;
  /** Presentation binding the reply to the group. */
  presentation: PresentationWire;
}

/**
 * Build a 4912 event marked with the `grp` tag. The responder's identity
 * is not signed onto the outer event — a fresh ephemeral is used, per
 * the same origin-ambiguity discipline the base 4912 uses.
 *
 * Callers wrap the returned event to the seeker's `ephemeralReplyPub`
 * (from the incoming 4910) using `wrap()` from wrap/gift.ts.
 */
export function buildGroupMatchReply(
  reply: Omit<GroupMatchReplyPayload, 'v' | 'presentation'>,
  presentation: Presentation,
  now: number = Math.floor(Date.now() / 1000),
): NostrEvent {
  const wire: GroupMatchReplyPayload = {
    v: RESPONDENT_WIRE_VERSION,
    scoreBucket: reply.scoreBucket,
    hopEstimate: reply.hopEstimate,
    presentation: serializePresentation(presentation),
  };
  const eph = generateKeypair();
  const expiration = now + 5 * 24 * 60 * 60; // D-class
  return finalizeEvent(
    {
      kind: KIND_MATCH_REPLY,
      created_at: now,
      tags: [
        [Tags.GRP, ''],
        [Tags.EXPIRATION, String(expiration)],
      ],
      content: JSON.stringify(wire),
    },
    eph.secret,
  );
}

/**
 * Parse a grp-tagged 4912 event back to a GroupMatchReplyPayload +
 * reconstructed `Presentation`. Returns null on malformed input or if the
 * `grp` tag is absent (a plain 4912 is a person-to-person reply, not this).
 */
export function parseGroupMatchReply(evt: NostrEvent): {
  reply: GroupMatchReplyPayload;
  presentation: Presentation;
} | null {
  if (evt.kind !== KIND_MATCH_REPLY) return null;
  if (!evt.tags.some((t) => t[0] === Tags.GRP)) return null;
  try {
    const wire = JSON.parse(evt.content) as GroupMatchReplyPayload;
    if (wire.v !== RESPONDENT_WIRE_VERSION) return null;
    return {
      reply: wire,
      presentation: {
        proof: hexToBytes(wire.presentation.proof),
        disclosedIndexes: [...wire.presentation.disclosedIndexes],
        disclosedMessages: wire.presentation.disclosedMessages.map(hexToBytes),
        header: hexToBytes(wire.presentation.header),
        presentationHeader: hexToBytes(wire.presentation.presentationHeader),
        scopeId: hexToBytes(wire.presentation.scopeId),
        pseudonym: hexToBytes(wire.presentation.pseudonym),
      },
    };
  } catch {
    return null;
  }
}

/**
 * Verify a group match reply:
 *   1. The presentation verifies against the cell's BBS+ issuer pubkey.
 *   2. The presentation's pseudonym is on the declaration's authorized list.
 *   3. The presentation's scope_id matches the cell id.
 *
 * A seeker who trusts the group (i.e., has seen a valid 4911 with a signed
 * charter chain) can call this to confirm "yes, this reply speaks for
 * {cellId}, and the responder is an authorized member — but which one is
 * hidden."
 */
export function verifyGroupMatchReply(
  presentation: Presentation,
  declaration: GroupInterestDeclaration,
  cellIssuerBbsPubkey: Uint8Array,
): boolean {
  // Scope check: presentation was bound to this cell.
  if (bytesToHex(presentation.scopeId) !== declaration.cellId) return false;
  // Auth check: pseudonym is on the authorized list.
  if (!isAuthorizedToRespond(declaration, presentation.pseudonym)) return false;
  // Crypto check: the presentation itself is valid.
  return verifyPresentation(presentation, cellIssuerBbsPubkey);
}
