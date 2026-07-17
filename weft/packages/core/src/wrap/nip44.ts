// NIP-44 pairwise seal — thin wrapper over nostr-tools' NIP-44 v2.
//
// Sources of law:
//   NIP-44 v2       ChaCha20 + HMAC construction with a versioned payload
//   DD §9.1         "sign inside, encrypt outside" — this file is the outside
//   Build list M2-T1

import { v2 as nip44v2, getConversationKey } from 'nostr-tools/nip44';

/**
 * Encrypt `bytes` from sender to recipient using NIP-44 v2. Returns the
 * versioned base64 payload string that goes in a Nostr event's `content`.
 */
export function sealTo(
  recipientPubkeyHex: string,
  bytes: Uint8Array,
  senderSecret: Uint8Array,
): string {
  const conv = getConversationKey(senderSecret, recipientPubkeyHex);
  const plaintext = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  return nip44v2.encrypt(plaintext, conv);
}

/** Decrypt a NIP-44 v2 payload from sender to recipient. Returns raw bytes. */
export function openFrom(
  senderPubkeyHex: string,
  payload: string,
  recipientSecret: Uint8Array,
): Uint8Array {
  const conv = getConversationKey(recipientSecret, senderPubkeyHex);
  const text = nip44v2.decrypt(payload, conv);
  return new TextEncoder().encode(text);
}

/**
 * String-in / string-out variant — convenience for the common case where the
 * payload is UTF-8 text (a serialized inner event, for example).
 */
export function sealTextTo(
  recipientPubkeyHex: string,
  text: string,
  senderSecret: Uint8Array,
): string {
  const conv = getConversationKey(senderSecret, recipientPubkeyHex);
  return nip44v2.encrypt(text, conv);
}

export function openTextFrom(
  senderPubkeyHex: string,
  payload: string,
  recipientSecret: Uint8Array,
): string {
  const conv = getConversationKey(recipientSecret, senderPubkeyHex);
  return nip44v2.decrypt(payload, conv);
}
