// secp256k1 Schnorr (BIP-340) keys — everything the protocol signs and verifies.
//
// Sources of law:
//   DD §9.1        key hierarchy layered by lifetime
//   DD §35 F10     device keys (porch nodes get their own vouched keypair)
//   Build list M1-T1  what this module must expose and prove
//
// One rule: never hand-roll cryptography. We only wrap noble.

import { schnorr } from '@noble/curves/secp256k1';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';

/** Secret key material — always 32 bytes. Treat as a live secret; zero when done. */
export type SecretKey = Uint8Array;

/** x-only public key — always 32 bytes (BIP-340). */
export type PublicKey = Uint8Array;

/** BIP-340 Schnorr signature — always 64 bytes. */
export type Signature = Uint8Array;

export interface Keypair {
  readonly secret: SecretKey;
  readonly pubkey: PublicKey;
}

/**
 * Generate a fresh secp256k1 keypair with a cryptographically secure secret.
 * Uses noble's CSPRNG (crypto.getRandomValues in browsers, crypto.randomBytes in Node).
 */
export function generateKeypair(): Keypair {
  const secret = randomBytes(32);
  const pubkey = schnorr.getPublicKey(secret);
  return { secret, pubkey };
}

/** Derive x-only public key from an existing secret. */
export function publicKeyFromSecret(secret: SecretKey): PublicKey {
  assertLen(secret, 32, 'secret');
  return schnorr.getPublicKey(secret);
}

/**
 * BIP-340 sign.
 *
 * The message is signed as-is (BIP-340's convention is to hash before calling
 * sign — callers pass the digest, exactly 32 bytes). This matches how NIP-01
 * signs the event-id hash and how §30's invite-token signs the sha256 of the
 * CBOR body.
 *
 * `auxRand` defaults to fresh CSPRNG bytes (BIP-340 recommended). Pass
 * explicit bytes only for deterministic fixtures — see the invite-token
 * hex fixture in M1-T3.
 */
export function sign(
  messageHash: Uint8Array,
  secret: SecretKey,
  auxRand: Uint8Array = randomBytes(32),
): Signature {
  assertLen(messageHash, 32, 'messageHash');
  assertLen(secret, 32, 'secret');
  assertLen(auxRand, 32, 'auxRand');
  return schnorr.sign(messageHash, secret, auxRand);
}

/** BIP-340 verify. Returns true iff the signature is valid over messageHash under pubkey. */
export function verify(
  signature: Signature,
  messageHash: Uint8Array,
  pubkey: PublicKey,
): boolean {
  if (signature.length !== 64) return false;
  if (messageHash.length !== 32) return false;
  if (pubkey.length !== 32) return false;
  try {
    return schnorr.verify(signature, messageHash, pubkey);
  } catch {
    return false;
  }
}

/**
 * `withEphemeral` — generate a keypair, hand it to `fn`, then zero the secret.
 *
 * Ephemeral keys back handshake stages and reply routing (DD §5, §9.1); a
 * lingering ephemeral secret is a slow identity leak (`SECURITY.md` key
 * hierarchy). This helper is the canonical place to use them — the secret's
 * lifetime is bounded by `fn`'s stack frame.
 *
 * NOTE: This zeroes our own reference. If `fn` copies the secret elsewhere,
 * that copy is out of our reach — do not do that. In particular, do not
 * capture `kp.secret` in a closure that outlives the call.
 */
export function withEphemeral<T>(fn: (kp: Keypair) => T): T {
  const kp = generateKeypair();
  try {
    return fn(kp);
  } finally {
    (kp.secret as Uint8Array).fill(0);
  }
}

/** Async variant of `withEphemeral` — awaits `fn` before zeroing. */
export async function withEphemeralAsync<T>(fn: (kp: Keypair) => Promise<T>): Promise<T> {
  const kp = generateKeypair();
  try {
    return await fn(kp);
  } finally {
    (kp.secret as Uint8Array).fill(0);
  }
}

// ---------------------------------------------------------------------------
// Hex conversions — thin re-exports of noble helpers, kept here so callers
// never need to think about which noble module to import from.
// ---------------------------------------------------------------------------

export { bytesToHex, hexToBytes };

/** Convenience: derive an x-only public-key hex string from a secret. */
export function pubkeyHexFromSecret(secret: SecretKey): string {
  return bytesToHex(publicKeyFromSecret(secret));
}

// ---------------------------------------------------------------------------

function assertLen(bytes: Uint8Array, expected: number, name: string): void {
  if (bytes.length !== expected) {
    throw new Error(`${name} must be ${expected} bytes; got ${bytes.length}`);
  }
}
