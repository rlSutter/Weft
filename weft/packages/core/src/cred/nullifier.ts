// k-show nullifiers — bounded plurality enforcement.
//
// Sources of law:
//   DD §36.1        "k-show enforcement (bounded plurality, §18.2)"
//   DD §18.2        why bounded plurality matters
//   Build list M9-T2  what this module ships
//
// **What this enforces.** A single root secret may generate at most k
// unlinkable presentations per epoch against a given issuer. The (k+1)th
// presentation is forced to reuse a `show_index`, which produces a nullifier
// collision that any observer can detect — and (this is the trapdoor) the
// collision recovers the over-spender's root secret in the clear. Cheating is
// self-incriminating; honest use within k is fully unlinkable.
//
// **The construction (Brands' double-spending trapdoor, 1993).** Each show at
// slot i attaches a linear share
//
//     s = c * root + r_i    (mod q)
//
// where c is a verifier challenge (fresh per show) and r_i is a per-slot
// pseudorandom pad derived from the root. Reusing slot i with two different
// challenges c1, c2 yields
//
//     s1 = c1 * root + r_i
//     s2 = c2 * root + r_i
//     root = (s1 - s2) / (c1 - c2)
//
// Anyone can compute this from public presentation data. One honest show at
// slot i leaks nothing (one equation, two unknowns).
//
// **Field choice.** We work in BLS12-381 Fr (the same field the credential
// engine uses). This keeps k-show interoperable with the presentation
// challenges the BBS engine already emits (see M9-T1 `presentCredential`'s
// `presentationHeader`, which will be hashed into a scalar challenge when
// wiring lands in M11-T1 persona standing).

import { bls12_381 } from '@noble/curves/bls12-381';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha2';
import { randomBytes } from '@noble/hashes/utils';

const Fr = bls12_381.fields.Fr;
const FR_BYTES = 32;

/** A slot index in [0, k). Presenting twice at the same slot in one epoch is the double-show. */
export type ShowIndex = number;

/** An epoch number (uint32). Global quarter-epoch derivation per DD §36.1. */
export type Epoch = number;

/**
 * The `issuer_scope_tag` from the credential attributes (see cred.ts).
 * A 32-byte hash of the issuer's charter id — identifies the issuer's *set*,
 * not any specific issuer, so nullifiers on the same "who is issuing here"
 * cluster together whether one steward signed or another rotated in.
 */
export type IssuerId = Uint8Array;

/** Default k per DD §36.1 ("initial value 3 per quarter-epoch"). */
export const DEFAULT_K = 3;

// ---------------------------------------------------------------------------
// Encoding — kept private and mechanical
// ---------------------------------------------------------------------------

function u32BE(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 0 || n > 0xffff_ffff) {
    throw new Error(`value must fit in uint32 (got ${String(n)})`);
  }
  return Uint8Array.of((n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff);
}

function assertRoot(root: Uint8Array): void {
  if (root.length !== FR_BYTES) {
    throw new Error(`root_secret must be exactly ${FR_BYTES} bytes (got ${root.length})`);
  }
}

function assertIssuer(id: IssuerId): void {
  if (id.length !== 32) {
    throw new Error(`issuer_id must be exactly 32 bytes (got ${id.length})`);
  }
}

/**
 * Big-endian bytes → non-negative integer → reduced mod r.
 * Matches the library's `os2ip` convention (§M9-T1 `skBytesToScalar`).
 */
function bytesToScalar(b: Uint8Array): bigint {
  let x = 0n;
  for (const byte of b) x = (x << 8n) | BigInt(byte);
  return x % Fr.ORDER;
}

/** Non-negative integer → 32-byte big-endian, left-padded. */
function scalarToBytes(x: bigint): Uint8Array {
  if (x < 0n) x = ((x % Fr.ORDER) + Fr.ORDER) % Fr.ORDER;
  const out = new Uint8Array(FR_BYTES);
  for (let i = FR_BYTES - 1; i >= 0; i--) {
    out[i] = Number(x & 0xffn);
    x >>= 8n;
  }
  return out;
}

/**
 * PRF: HMAC-SHA256 keyed by the root secret. Domain-separated by a tag byte
 * (so `nullifier` and `sharePad` derive independent outputs from the same
 * underlying inputs — otherwise a leaked nullifier could be used as the
 * share pad and reveal the root).
 */
function prf(root: Uint8Array, tag: number, issuerId: IssuerId, epoch: Epoch, showIndex: ShowIndex): Uint8Array {
  const msg = new Uint8Array(1 + issuerId.length + 4 + 4);
  msg[0] = tag;
  msg.set(issuerId, 1);
  msg.set(u32BE(epoch), 1 + issuerId.length);
  msg.set(u32BE(showIndex), 1 + issuerId.length + 4);
  return hmac(sha256, root, msg);
}

const TAG_NULLIFIER = 0x01;
const TAG_SHARE_PAD = 0x02;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Deterministic 32-byte tag identifying the (root, issuer, epoch, slot)
 * combination. Two presentations at the same slot within the same epoch
 * against the same issuer share this tag — that's the collision detector.
 *
 * Unlinkable across slots and across issuers under standard PRF assumptions.
 */
export function nullifier(
  root: Uint8Array,
  issuerId: IssuerId,
  epoch: Epoch,
  showIndex: ShowIndex,
): Uint8Array {
  assertRoot(root);
  assertIssuer(issuerId);
  return prf(root, TAG_NULLIFIER, issuerId, epoch, showIndex);
}

/**
 * Presentation ticket the prover attaches to each show. Verifier stores the
 * whole thing; if two tickets ever share a nullifier, run `detectDoubleSpend`.
 *
 * `challenge` is chosen by the verifier fresh per show. In a real flow this
 * will be the hash of the presentation context (relay, nonce, timestamp);
 * for k-show correctness what matters is only that it differs across shows.
 */
export interface ShareTicket {
  /** 32 bytes, from `nullifier(root, issuer, epoch, slot)`. */
  nullifier: Uint8Array;
  /** 32-byte scalar (the verifier's challenge, mod r). */
  challenge: Uint8Array;
  /** 32-byte scalar: `s = challenge * root + PRF_pad(slot)` mod r. */
  share: Uint8Array;
}

/**
 * Build a share ticket. The share leaks nothing about `root` by itself
 * (it's `challenge * root` masked by a slot-scoped pseudorandom pad).
 * Reusing the same slot with a different challenge is what breaks it.
 */
export function makeShareTicket(
  root: Uint8Array,
  issuerId: IssuerId,
  epoch: Epoch,
  showIndex: ShowIndex,
  challenge: Uint8Array,
): ShareTicket {
  assertRoot(root);
  assertIssuer(issuerId);
  if (challenge.length !== FR_BYTES) {
    throw new Error(`challenge must be exactly ${FR_BYTES} bytes (got ${challenge.length})`);
  }
  const nul = prf(root, TAG_NULLIFIER, issuerId, epoch, showIndex);
  const padBytes = prf(root, TAG_SHARE_PAD, issuerId, epoch, showIndex);
  const rootScalar = bytesToScalar(root);
  const challengeScalar = bytesToScalar(challenge);
  const padScalar = bytesToScalar(padBytes);
  // s = challenge * root + pad (mod r)
  const s = Fr.add(Fr.mul(challengeScalar, rootScalar), padScalar);
  return { nullifier: nul, challenge, share: scalarToBytes(s) };
}

/**
 * Fresh 32-byte scalar suitable as a `challenge` argument to
 * `makeShareTicket`. Verifiers call this at the start of each presentation.
 */
export function freshChallenge(): Uint8Array {
  // Sample 32 random bytes; interpretation as Fr scalar happens inside
  // `makeShareTicket`. The tiny bias from "not reducing mod r before storing"
  // is negligible for challenge purposes (statistical distance << 2^-100).
  return randomBytes(FR_BYTES);
}

/**
 * If two tickets share a nullifier AND differ in challenge, recover the root
 * secret from their linear equations. Returns null if they don't collide, or
 * if the challenges are identical (a byte-for-byte replay reveals nothing —
 * verifiers should reject replays before this point on nonce grounds).
 *
 * The returned 32 bytes are the recovered secret **reduced mod Fr.ORDER**.
 * To match against a suspect's raw root secret, reduce the suspect the same
 * way (interpret as big-endian, take mod Fr.ORDER) — that is what makes the
 * comparison well-defined regardless of whether the original root exceeded r.
 */
export function detectDoubleSpend(
  a: ShareTicket,
  b: ShareTicket,
): Uint8Array | null {
  if (!bytesEqual(a.nullifier, b.nullifier)) return null;
  if (bytesEqual(a.challenge, b.challenge)) return null;

  const c1 = bytesToScalar(a.challenge);
  const c2 = bytesToScalar(b.challenge);
  const s1 = bytesToScalar(a.share);
  const s2 = bytesToScalar(b.share);
  // s1 - s2 = (c1 - c2) * root  ⟹  root = (s1 - s2) / (c1 - c2)
  const dc = Fr.sub(c1, c2);
  const ds = Fr.sub(s1, s2);
  if (dc === 0n) return null; // paranoia: also caught by challenge-equal check above
  const rootScalar = Fr.mul(ds, Fr.inv(dc));
  return scalarToBytes(rootScalar);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
