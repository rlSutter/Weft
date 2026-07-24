// Group-key symmetric AEAD for kind-4920-class objects (roster, group
// messages) — DD §36.2.
//
// A group has one shared 32-byte symmetric key (the group key). Members
// receive it via `4933` (join grant) or `4921` (rotation). Every payload
// encrypted under it is a versioned envelope of {nonce ‖ ciphertext ‖ tag}
// using XChaCha20-Poly1305 (24-byte nonce lets us use a fresh random nonce
// per encryption without nonce-reuse anxiety, unlike ChaCha20-Poly1305's
// 12-byte nonce).
//
// Sources of law:
//   DD §36.2   groups: 4920 messages, 4921 rotation, roster
//   Build list M10-T1

import { xchacha20poly1305 } from '@noble/ciphers/chacha';
import { randomBytes } from '@noble/hashes/utils';

/** Group keys are 32 bytes. */
export const GROUP_KEY_BYTES = 32;
/** XChaCha20 nonce is 24 bytes. */
const NONCE_BYTES = 24;
/** Bumped whenever the envelope shape changes. */
const ENVELOPE_VERSION = 1;

/** Generate a fresh group key (32 CSPRNG bytes). */
export function generateGroupKey(): Uint8Array {
  return randomBytes(GROUP_KEY_BYTES);
}

/**
 * Encrypt `plaintext` under `groupKey`. Returns a self-contained envelope
 * `[v ‖ nonce(24) ‖ ct+tag]`. Includes a fresh random nonce per call, so
 * `sealWithGroupKey(same key, same plaintext)` twice produces different
 * bytes.
 */
export function sealWithGroupKey(groupKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  assertGroupKey(groupKey);
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = xchacha20poly1305(groupKey, nonce);
  const ct = cipher.encrypt(plaintext);
  const out = new Uint8Array(1 + NONCE_BYTES + ct.length);
  out[0] = ENVELOPE_VERSION;
  out.set(nonce, 1);
  out.set(ct, 1 + NONCE_BYTES);
  return out;
}

/**
 * Decrypt an envelope produced by `sealWithGroupKey`. Returns null on
 * tamper, malformed envelope, or wrong key — matches the invite/wrap
 * discipline of not throwing parse-detail exceptions.
 */
export function openWithGroupKey(groupKey: Uint8Array, envelope: Uint8Array): Uint8Array | null {
  try {
    if (envelope.length < 1 + NONCE_BYTES + 16) return null; // 16 = Poly1305 tag
    if (envelope[0] !== ENVELOPE_VERSION) return null;
    assertGroupKey(groupKey);
    const nonce = envelope.slice(1, 1 + NONCE_BYTES);
    const ct = envelope.slice(1 + NONCE_BYTES);
    const cipher = xchacha20poly1305(groupKey, nonce);
    return cipher.decrypt(ct);
  } catch {
    return null;
  }
}

function assertGroupKey(k: Uint8Array): void {
  if (k.length !== GROUP_KEY_BYTES) {
    throw new Error(`group key must be exactly ${GROUP_KEY_BYTES} bytes (got ${k.length})`);
  }
}
