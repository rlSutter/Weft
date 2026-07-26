// Rendezvous — vouched-anonymous entry (DD §17.4, §20.3, §36.2).
//
// A rendezvous is a **group whose join requires only an in-scope credential
// presentation** — everyone proven-vouched, no one identified. It reuses
// M10's charter / roster / join / messaging / ejection primitives verbatim;
// the only differences from a regular cell are:
//
//   1. **Auto-admit.** No greeter approval step. A holder presenting a
//      valid network-scope credential is admitted; the "greeter" role
//      collapses to `autoAdmit(presentation, ...)`.
//   2. **Wider issuer scope.** Regular cells vouch narrowly (a specific
//      steward set); a rendezvous accepts a **network-scope** credential
//      (any vouched holder anywhere in the network's issuer scope).
//   3. **Charter marker.** Distinguished by a convention on
//      `CharterPayload.house_rules[0]` (see `RENDEZVOUS_MARKER` below).
//      We piggyback on the existing charter shape rather than extend it,
//      to keep DD §36.2's wire format unchanged.
//
// This is the "least-trust-but-still-vouched" venue §17.4 / §20.3
// promised: a place credentialed strangers can meet without either
// identifying themselves or trusting a specific steward.
//
// **Cross-rendezvous unlinkability holds.** Because scope_nyms are
// credential-bound (M9-T3) and each rendezvous has a distinct cell id
// (scope_id), the SAME credential presented at rendezvous A and
// rendezvous B produces DIFFERENT scope_nyms. Two rendezvous operators
// cannot collude to link the same person across venues from wire
// evidence alone.
//
// Sources of law:
//   DD §17.4                    rendezvous nodes, vouched-anonymous entry
//   DD §20.3                    equity ladders + rendezvous relationships
//   DD §36.2                    "rendezvous reuses M10's join/message/eject"
//   Build list M12-T1

import type { NostrEvent } from 'nostr-tools/pure';

import type { CharterPayload, Charter } from './charter';
import { buildCharterEvent } from './charter';
import type { Presentation } from '../cred/cred';
import { verifyPresentation } from '../cred/cred';
import type { SecretKey } from '../keys/keys';

/**
 * Canonical marker string. A charter is treated as a rendezvous iff its
 * `house_rules[0]` starts with this prefix. The full line is
 * human-readable and shown to entrants: "RENDEZVOUS · Entry is open to
 * anyone with a valid network-scope credential."
 */
export const RENDEZVOUS_MARKER = 'RENDEZVOUS';

/** Predicate: does this charter's payload describe a rendezvous? */
export function isRendezvousCharter(payload: CharterPayload): boolean {
  const first = payload.house_rules[0];
  return typeof first === 'string' && first.startsWith(RENDEZVOUS_MARKER);
}

// ---------------------------------------------------------------------------
// Build a rendezvous charter
// ---------------------------------------------------------------------------

/**
 * Options a rendezvous charter needs beyond the base charter payload.
 * The wider issuer_scope_tag is *policy*, not a wire field on the
 * charter — verifiers check it against the credential's own
 * `issuer_scope_tag` at auto-admit time.
 */
export interface RendezvousOptions {
  /** Human-facing preface line — appended after the marker. Kept short. */
  entryLine?: string;
  /**
   * The `issuer_scope_tag` values (hex) that this rendezvous accepts on
   * credential presentations. Empty list = accept any tag (fully open,
   * any network-scope credential). Non-empty = accept only these tags.
   */
  acceptedIssuerScopeTags?: readonly string[];
}

/**
 * Build a rendezvous CharterPayload from a base payload. Prepends the
 * marker line to `house_rules` and records the accepted-tag policy in
 * the following house-rule lines (so the policy survives serialization
 * and is inspectable by any client, without extending the wire format).
 *
 * The base payload's `steward_pubkeys` / `amendment_rule` /
 * `ejection_procedure` / `credential_constants` / `issuer_bbs_pubkey`
 * are all preserved — a rendezvous still has stewards who can amend
 * the charter and eject members (§17.4 rendezvous nodes are governed;
 * only the *entry* is automatic).
 */
export function makeRendezvousPayload(
  base: CharterPayload,
  opts: RendezvousOptions = {},
): CharterPayload {
  const entryLine = opts.entryLine ?? 'Entry is open to anyone with a valid network-scope credential.';
  const markerLine = `${RENDEZVOUS_MARKER} · ${entryLine}`;
  const acceptedLine = opts.acceptedIssuerScopeTags && opts.acceptedIssuerScopeTags.length > 0
    ? `Accepts: ${opts.acceptedIssuerScopeTags.join(', ')}`
    : 'Accepts: any';
  return {
    ...base,
    prev: base.prev,
    house_rules: [markerLine, acceptedLine, ...base.house_rules],
  };
}

/** Convenience: build the 4900 event for a rendezvous charter. */
export function buildRendezvousCharterEvent(
  base: CharterPayload,
  opts: RendezvousOptions,
  publisherSecret: SecretKey,
): NostrEvent {
  const payload = makeRendezvousPayload(base, opts);
  const charter: Charter = { payload, sigs: [] };
  return buildCharterEvent(charter, publisherSecret);
}

// ---------------------------------------------------------------------------
// Auto-admit gate — the "greeter" for a rendezvous
// ---------------------------------------------------------------------------

/**
 * Read the accepted-tag policy back out of a rendezvous charter. Returns
 * `null` if the charter isn't a rendezvous, or an empty array to mean
 * "accepts any tag." (Case-insensitive: the string carried in
 * `house_rules[1]` starts with "Accepts: ".)
 */
export function acceptedIssuerScopeTags(payload: CharterPayload): readonly string[] | null {
  if (!isRendezvousCharter(payload)) return null;
  const line = payload.house_rules[1];
  if (typeof line !== 'string') return null;
  const prefix = 'Accepts: ';
  if (!line.startsWith(prefix)) return null;
  const rest = line.slice(prefix.length).trim();
  if (rest === 'any' || rest === '') return [];
  return rest.split(',').map((s) => s.trim()).filter((s) => s.length > 0);
}

/** Verdict on an auto-admit attempt. */
export type AutoAdmitVerdict =
  | { ok: true }
  | { ok: false; reason: 'not-a-rendezvous' | 'issuer-tag-not-accepted' | 'invalid-presentation' | 'wrong-scope' };

/**
 * Auto-admit a credential presentation into a rendezvous. This is the
 * greeter step, collapsed: no human decision, only a cryptographic gate.
 *
 * Checks:
 *   1. The charter is a rendezvous (marker present).
 *   2. The presentation's scope_id matches the rendezvous's cell id.
 *   3. The presentation's disclosed `issuer_scope_tag` (at cleartext
 *      index 4) is on the charter's accepted list — or the charter
 *      accepts any tag.
 *   4. The presentation itself verifies against the cell's issuer BBS+
 *      public key (from `payload.issuer_bbs_pubkey`).
 *
 * The caller (rendezvous host / auto-greeter node) is responsible for
 * adding the presentation's `pseudonym` to the roster (using existing
 * M10-T1 `addMember`). This function is pure: no side effects.
 */
export function autoAdmit(
  presentation: Presentation,
  charter: Charter,
  cellIdHex: string,
  cellIssuerBbsPubkey: Uint8Array,
): AutoAdmitVerdict {
  if (!isRendezvousCharter(charter.payload)) {
    return { ok: false, reason: 'not-a-rendezvous' };
  }
  // Scope binding: presentation must be for THIS rendezvous.
  const presScopeHex = uint8ArrayToHex(presentation.scopeId);
  if (presScopeHex !== cellIdHex) {
    return { ok: false, reason: 'wrong-scope' };
  }

  // Issuer-tag policy: if the charter restricts, the presentation must
  // have disclosed its issuer_scope_tag (attribute index 4) AND that
  // value must be on the accepted list.
  const acceptedTags = acceptedIssuerScopeTags(charter.payload);
  if (acceptedTags !== null && acceptedTags.length > 0) {
    const disclosedIndex = presentation.disclosedIndexes.indexOf(4);
    if (disclosedIndex < 0) {
      // The presentation didn't disclose the tag; a restricted rendezvous
      // needs to see it to decide.
      return { ok: false, reason: 'issuer-tag-not-accepted' };
    }
    const disclosedTag = presentation.disclosedMessages[disclosedIndex]!;
    const tagHex = uint8ArrayToHex(disclosedTag);
    if (!acceptedTags.includes(tagHex)) {
      return { ok: false, reason: 'issuer-tag-not-accepted' };
    }
  }

  // Crypto: the presentation itself must be valid.
  if (!verifyPresentation(presentation, cellIssuerBbsPubkey)) {
    return { ok: false, reason: 'invalid-presentation' };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Local helper — avoids a hexEncode import cycle
// ---------------------------------------------------------------------------

function uint8ArrayToHex(u: Uint8Array): string {
  let out = '';
  for (let i = 0; i < u.length; i++) {
    const b = u[i]!;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}
