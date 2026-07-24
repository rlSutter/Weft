// Cell-scoped signing key — DD §36.2 amendment (2026-07-19).
//
// Given a member's `nym_secret` for a cell and the cell's `scope_id`, derive
// a secp256k1 BIP-340 keypair `(k_sign, p_sign)` bound to that cell only.
// Used for signing 4922 consent receipts on the join path without exposing
// the joiner's real identity key to the greeter — the load-bearing property
// of greeter blind issuance (F7-group-layer).
//
// Construction:
//     seed  = HKDF-SHA256(salt = scope_id, IKM = nym_secret_bytes,
//                         info = "weft-v2/k_sign/1", L = 32)
//     k_sign = seed reduced mod n_secp256k1  (rejection-resample if 0)
//     p_sign = BIP-340 x-only pubkey of k_sign
//
// Sources of law:
//   DD §36.2 amendment  greeter blind issuance
//   DD §36.1            nym_secret is per-credential, cell-recoverable state

import { hkdf } from '@noble/hashes/hkdf';
import { sha256 } from '@noble/hashes/sha2';
import { secp256k1 } from '@noble/curves/secp256k1';
import { publicKeyFromSecret, type PublicKey, type SecretKey } from '../keys/keys';

const HKDF_INFO = new TextEncoder().encode('weft-v2/k_sign/1');

/**
 * Serialize a BLS12-381 Fr scalar (bigint) to 32 big-endian bytes.
 * Matches the convention used elsewhere in cred/.
 */
function scalarToBytes(x: bigint): Uint8Array {
  const out = new Uint8Array(32);
  let v = x;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

/**
 * Derive the cell-scoped signing keypair for a member.
 *
 * `scopeId` MUST match the scope_id used at credential presentation (== the
 * cell's genesis charter event id, as bytes). Both parties (joiner deriving
 * `k_sign`, greeter deriving `p_sign` from the join event's `p_sign` claim)
 * consume the same scope_id, so the derivation is deterministic and
 * independently verifiable.
 */
export function deriveKSign(nymSecret: bigint, scopeId: Uint8Array): {
  kSign: SecretKey;
  pSign: PublicKey;
} {
  if (scopeId.length !== 32) {
    throw new Error(`scope_id must be exactly 32 bytes (got ${scopeId.length})`);
  }
  const ikm = scalarToBytes(nymSecret);
  // Rejection-resample the extremely rare case where the HKDF output reduces
  // to 0 or falls outside [1, n). In secp256k1 this branch fires with
  // probability ~2^-128; we bound retries so the function terminates.
  let counter = 0;
  while (counter < 8) {
    const info = counter === 0
      ? HKDF_INFO
      : concatBytes(HKDF_INFO, Uint8Array.of(counter));
    const seed = hkdf(sha256, ikm, scopeId, info, 32);
    // secp256k1's utils.isValidPrivateKey wants bytes in [1, n).
    if (secp256k1.utils.isValidPrivateKey(seed)) {
      const pSign = publicKeyFromSecret(seed);
      return { kSign: seed, pSign };
    }
    counter++;
  }
  throw new Error('deriveKSign: HKDF exhausted retries (statistically impossible)');
}

function concatBytes(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}
