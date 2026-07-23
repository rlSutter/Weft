// Credential revocation via 4903 voids (DD §36.1, DD §33.3 kind 4903).
//
// Each credential has a deterministic 32-byte revocation handle. An issuer
// (or steward-set with amendment rights) voids a credential by publishing
// a kind-4903 void event whose content is the handle. Verifiers check the
// set of observed void events before accepting a presentation.
//
// **Design trade-off (from DD §36.1).** The handle is a public identifier
// tied to the credential, and MUST be revealed by the presenter for the
// verifier's non-revocation check to be effective. This means: two
// presentations of the same credential (across any scopes) are linkable by
// handle to anyone watching the void feed. Cross-scope pseudonym
// unlinkability holds against the general observer, but not against an
// observer who is also collecting the revocation-handle at presentation
// time. This is the honest cost of enforceable revocation without an
// accumulator scheme (a v3 refinement).
//
// The MITIGATING factor: handles are stable across epochs, so revocation
// stops all future use of a specific credential, but expiry_epoch bounds
// the exposure window — a rotated credential gets a new signature and a
// new handle.

import { sha256 } from '@noble/hashes/sha2';
import type { Credential } from './cred';

/** Byte prefix that domain-separates Weft revocation handles from any other
 *  use of sha256 in the protocol. Bumped alongside the credential schema. */
const HANDLE_DST = new TextEncoder().encode('weft-v2/revocation-handle/1');

/**
 * Compute the 32-byte deterministic revocation handle for a credential.
 *
 * The signature is unique per issuance (blind BBS signatures are randomized),
 * so distinct credentials — even for the same subject with the same
 * attributes — produce distinct handles. Revoking one credential doesn't
 * revoke another the same subject holds.
 */
export function revocationHandle(cred: Credential): Uint8Array {
  const parts = [HANDLE_DST, cred.issuerPubkey, cred.signature];
  let total = 0;
  for (const p of parts) total += p.length;
  const buf = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    buf.set(p, off);
    off += p.length;
  }
  return sha256(buf);
}

/**
 * True iff `handle` appears in `voidedHandles` (a store of observed 4903
 * contents). Callers assemble the void set from their local relay
 * subscription; the check is a cheap set-membership lookup.
 */
export function isRevoked(
  handle: Uint8Array,
  voidedHandles: Iterable<Uint8Array>,
): boolean {
  for (const v of voidedHandles) {
    if (v.length !== handle.length) continue;
    let diff = 0;
    for (let i = 0; i < handle.length; i++) diff |= v[i]! ^ handle[i]!;
    if (diff === 0) return true;
  }
  return false;
}
