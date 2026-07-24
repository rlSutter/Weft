// Group join flow — inner kinds 4932 (request) / 4933 (grant) / 4922
// (consent receipt). DD §36.2 (with the 2026-07-19 blind-issuance amendment).
//
// **Blind issuance property.** The greeter learns the joiner's `scope_nym`
// (public within the group), the joiner's `p_sign` (a cell-scoped signing
// pubkey), a fresh `p_join_eph` (an ephemeral delivery pubkey), and a ZK
// credential presentation. **No wire field carries the joiner's identity
// pubkey.** The 4933 membership grant is wrapped to `p_join_eph`, not to
// the joiner's identity key.
//
// Flow:
//   Joiner:
//     1. present credential in scope (M9-T3) → { proof, pseudonym, ... }
//     2. derive (k_sign, p_sign) from nym_secret + scope_id (k-sign.ts)
//     3. generate fresh (s_join_eph, p_join_eph) — plain secp256k1
//     4. build 4932 inner event signed by the ephemeral key, wrap to greeter
//     5. subscribe to p_join_eph on relays, wait for 4933
//   Greeter:
//     6. unwrap 4932, verify credential presentation
//     7. check roster: scope_nym not already active, not previously ejected
//     8. add to roster, produce new roster envelope
//     9. build 4933 inner event signed by their identity (the greeter's
//        identity IS learned by the joiner — the property protects joiner
//        identity, not greeter identity), wrap to p_join_eph
//   Joiner:
//    10. unwrap 4933 using s_join_eph → get group key + roster
//    11. build 4922 consent receipt signed by k_sign, wrap to greeter
//
// Sources of law:
//   DD §36.2                     join wire kinds, roster collision rules
//   DD §36.2 amendment 2026-07-19  greeter blind issuance
//   Build list M10-T2

import type { NostrEvent } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';

import { buildAndSign, type WeftEvent } from '../codec/event';
import type { Presentation } from '../cred/cred';

const KIND_JOIN_REQUEST = 4932;
const KIND_MEMBERSHIP_GRANT = 4933;
const KIND_CHARTER_CONSENT = 4922;

/** Bumped whenever the join wire schema changes. */
export const JOIN_WIRE_VERSION = 1;

// ---------------------------------------------------------------------------
// 4932 Join request — joiner → greeter
// ---------------------------------------------------------------------------

/**
 * Everything the joiner needs to prove eligibility and receive the grant.
 * Signed by `p_join_eph` (a fresh ephemeral) — NOT the joiner's identity.
 */
export interface JoinRequest {
  /** hex — scope_id the presentation is bound to (== cell id). */
  scopeId: string;
  /** hex — the derived `scope_nym` (a.k.a. pseudonym). */
  scopeNym: string;
  /** hex — cell-scoped signing pubkey (BIP-340 x-only, 32 bytes). */
  pSign: string;
  /**
   * The credential presentation bytes (opaque BBS proof) + disclosure
   * metadata. This is the whole `Presentation` object serialized with the
   * standard cred hex/base10 encoding.
   */
  presentation: PresentationWire;
}

/** Wire form of a `cred.Presentation` (bytes → hex; disclosedIndexes as-is). */
export interface PresentationWire {
  proof: string;
  disclosedIndexes: number[];
  disclosedMessages: string[];
  header: string;
  presentationHeader: string;
  scopeId: string;
  pseudonym: string;
}

interface JoinRequestWire extends JoinRequest {
  readonly v: number;
}

/**
 * Convert a `cred.Presentation` to its wire form. Callers building a 4932
 * event use this — real clients rarely construct `PresentationWire` by hand.
 */
export function serializePresentation(p: Presentation): PresentationWire {
  return {
    proof: bytesToHex(p.proof),
    disclosedIndexes: [...p.disclosedIndexes],
    disclosedMessages: p.disclosedMessages.map((m) => bytesToHex(m)),
    header: bytesToHex(p.header),
    presentationHeader: bytesToHex(p.presentationHeader),
    scopeId: bytesToHex(p.scopeId),
    pseudonym: bytesToHex(p.pseudonym),
  };
}

function deserializePresentation(w: PresentationWire): Presentation {
  return {
    proof: hexToBytes(w.proof),
    disclosedIndexes: [...w.disclosedIndexes],
    disclosedMessages: w.disclosedMessages.map(hexToBytes),
    header: hexToBytes(w.header),
    presentationHeader: hexToBytes(w.presentationHeader),
    scopeId: hexToBytes(w.scopeId),
    pseudonym: hexToBytes(w.pseudonym),
  };
}

/**
 * Build a signed 4932 join request event. Signed by `pJoinEphSecret` (the
 * ephemeral delivery keypair the joiner just generated) — never by the
 * joiner's identity key. Callers wrap the result to the greeter's pubkey
 * (via `wrap()` from wrap/gift.ts) before publishing.
 */
export function buildJoinRequestEvent(
  request: JoinRequest,
  pJoinEphSecret: Uint8Array,
): WeftEvent {
  const wire: JoinRequestWire = { v: JOIN_WIRE_VERSION, ...request };
  return buildAndSign(
    { kind: KIND_JOIN_REQUEST, content: JSON.stringify(wire) },
    pJoinEphSecret,
  );
}

/**
 * Parse a decrypted inner 4932 event back to a JoinRequest + reconstructed
 * `Presentation`. Returns null on any malformed input.
 *
 * IMPORTANT: `inner.pubkey` on a valid 4932 is `p_join_eph` (the ephemeral),
 * never the joiner's identity. Greeters should NOT interpret it as an
 * identity — that would defeat blind issuance.
 */
export function parseJoinRequestEvent(inner: NostrEvent): {
  request: JoinRequest;
  presentation: Presentation;
  pJoinEphPubkey: string;
} | null {
  if (inner.kind !== KIND_JOIN_REQUEST) return null;
  try {
    const wire = JSON.parse(inner.content) as JoinRequestWire;
    if (wire.v !== JOIN_WIRE_VERSION) return null;
    return {
      request: {
        scopeId: wire.scopeId,
        scopeNym: wire.scopeNym,
        pSign: wire.pSign,
        presentation: wire.presentation,
      },
      presentation: deserializePresentation(wire.presentation),
      pJoinEphPubkey: inner.pubkey,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4933 Membership grant — greeter → joiner (via p_join_eph)
// ---------------------------------------------------------------------------

/**
 * What the greeter hands back on a successful join. `groupKey` and
 * `encryptedRoster` are both group-scoped; nothing here reveals the
 * greeter's or any other member's identity.
 */
export interface MembershipGrant {
  /** hex — current group key (32 bytes). */
  groupKey: string;
  /** hex — the updated roster envelope (from `encryptRoster`). */
  encryptedRoster: string;
  /**
   * hex — event id of the current charter (so the joiner can fetch, verify,
   * and sign a 4922 consent receipt referencing it).
   */
  charterEventId: string;
}

interface MembershipGrantWire extends MembershipGrant {
  readonly v: number;
}

/**
 * Build a signed 4933 event. Signed by the greeter's IDENTITY key (the
 * greeter is not blinded — only the joiner is). Callers wrap this to
 * `p_join_eph`, NOT the joiner's identity key.
 */
export function buildMembershipGrantEvent(
  grant: MembershipGrant,
  greeterSecret: Uint8Array,
): WeftEvent {
  const wire: MembershipGrantWire = { v: JOIN_WIRE_VERSION, ...grant };
  return buildAndSign(
    { kind: KIND_MEMBERSHIP_GRANT, content: JSON.stringify(wire) },
    greeterSecret,
  );
}

export function parseMembershipGrantEvent(inner: NostrEvent): MembershipGrant | null {
  if (inner.kind !== KIND_MEMBERSHIP_GRANT) return null;
  try {
    const wire = JSON.parse(inner.content) as MembershipGrantWire;
    if (wire.v !== JOIN_WIRE_VERSION) return null;
    if (typeof wire.groupKey !== 'string' || typeof wire.encryptedRoster !== 'string') return null;
    return {
      groupKey: wire.groupKey,
      encryptedRoster: wire.encryptedRoster,
      charterEventId: wire.charterEventId,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4922 Charter consent receipt — joiner → greeter (signed by k_sign)
// ---------------------------------------------------------------------------

/**
 * The joiner's "I agree to this charter" receipt. Signed by `k_sign`
 * (cell-scoped) — NEVER the joiner's identity key. This closes the join
 * loop and gives the greeter cryptographic evidence of consent bound to
 * the joiner's `scope_nym` (via `p_sign` from the earlier 4932).
 */
export interface ConsentReceipt {
  /** hex — the charter event id the joiner is consenting to. */
  charterEventId: string;
  /** hex — the joiner's `scope_nym` (must match the 4932 they sent). */
  scopeNym: string;
}

interface ConsentReceiptWire extends ConsentReceipt {
  readonly v: number;
}

/**
 * Build a signed 4922 consent receipt. Signed by `kSign` (derived via
 * `deriveKSign`) — never the joiner's identity. Callers wrap to greeter.
 */
export function buildConsentReceiptEvent(
  receipt: ConsentReceipt,
  kSign: Uint8Array,
): WeftEvent {
  const wire: ConsentReceiptWire = { v: JOIN_WIRE_VERSION, ...receipt };
  return buildAndSign(
    { kind: KIND_CHARTER_CONSENT, content: JSON.stringify(wire) },
    kSign,
  );
}

/**
 * Parse a decrypted 4922 event. Also returns `signerPubkey` so the greeter
 * can compare it to the `p_sign` from the 4932 (they must match — otherwise
 * this consent is for a different joiner).
 */
export function parseConsentReceiptEvent(inner: NostrEvent): {
  receipt: ConsentReceipt;
  signerPubkey: string;
} | null {
  if (inner.kind !== KIND_CHARTER_CONSENT) return null;
  try {
    const wire = JSON.parse(inner.content) as ConsentReceiptWire;
    if (wire.v !== JOIN_WIRE_VERSION) return null;
    return {
      receipt: {
        charterEventId: wire.charterEventId,
        scopeNym: wire.scopeNym,
      },
      signerPubkey: inner.pubkey,
    };
  } catch {
    return null;
  }
}
