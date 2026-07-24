// Group messaging + key rotation — kinds 4920 (message) and 4921 (rotation).
// DD §36.2.
//
// **4920 messages.** Ordinary group chat. Encrypted under the current
// symmetric group key with XChaCha20-Poly1305 (via group-crypto.ts).
// Published with an `h` tag = hash of the cell id, so members subscribe
// on the channel without leaking the cell id to relays. Sender identity
// is inside the ciphertext (scope_nym), never on the outer event —
// outer events are signed by fresh ephemeral keys per message, so
// relays see "someone published on channel h" and nothing else.
//
// **4921 rotation.** Publishing a new group key to remaining members
// after a join or ejection. To keep the outer event count minimal (and
// avoid leaking per-member deliveries), a single 4921 event carries an
// array of per-recipient NIP-44 seals. Each recipient scans the array,
// finds their `p_sign` hex, and decrypts with their `k_sign`. Cost is
// O(n) ciphertexts per rotation, which matches Ostrom-scale groups the
// design targets (≤150 members; MLS takes over above that per M10-T6).
//
// **Known residual.** The 4921 event's content size (N entries) reveals
// the group's approximate current member count to any relay operator.
// Padding to the nearest power-of-two would obscure this at ~1.5×
// bandwidth cost; deferred to a v3 refinement.
//
// Sources of law:
//   DD §36.2   4920/4921 wire kinds and group-key regime
//   Build list M10-T3

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';

import { Tags } from '../kinds/tags';
import { openWithGroupKey, sealWithGroupKey } from './group-crypto';
import { openTextFrom, sealTextTo } from '../wrap/nip44';
import { generateKeypair } from '../keys/keys';

const KIND_GROUP_MESSAGE = 4920;
const KIND_GROUP_ROTATION = 4921;

/** Bumped whenever the messaging wire schema changes. */
export const GROUP_MSG_WIRE_VERSION = 1;

// ---------------------------------------------------------------------------
// Channel id derivation — public, deterministic from cell id
// ---------------------------------------------------------------------------

/**
 * Hash the cell id to a channel handle for the `h` tag. Members subscribe
 * by this handle; a relay operator cannot learn which cell a given `h`
 * corresponds to unless they also know the cell id.
 */
export function channelIdForCell(cellIdHex: string): string {
  const bytes = new TextEncoder().encode(`weft-v2/channel/1|${cellIdHex}`);
  return bytesToHex(sha256(bytes));
}

// ---------------------------------------------------------------------------
// 4920 group message
// ---------------------------------------------------------------------------

interface GroupMessagePlaintext {
  readonly v: number;
  /** hex — sender's scope_nym in this cell (32 bytes). */
  senderScopeNym: string;
  /** UTF-8 text. */
  body: string;
  /** Unix seconds — inner, honest timestamp; the outer wrapper's
   *  created_at is a fresh ephemeral timestamp (per NIP-59 pattern). */
  sentAt: number;
}

/**
 * Publish a group message. Encrypts the payload under the group key and
 * emits a kind-4920 event signed by a fresh ephemeral key, tagged only
 * with the channel handle. The relay sees kind, channel `h`, ciphertext,
 * and expiration — never sender, never cell id.
 *
 * `now` (unix seconds) is injectable for tests.
 */
export function buildGroupMessageEvent(
  senderScopeNym: Uint8Array,
  body: string,
  groupKey: Uint8Array,
  channelId: string,
  now: number = Math.floor(Date.now() / 1000),
): NostrEvent {
  if (senderScopeNym.length !== 32) {
    throw new Error(`senderScopeNym must be 32 bytes (got ${senderScopeNym.length})`);
  }
  const plaintext: GroupMessagePlaintext = {
    v: GROUP_MSG_WIRE_VERSION,
    senderScopeNym: bytesToHex(senderScopeNym),
    body,
    sentAt: now,
  };
  const ct = sealWithGroupKey(
    groupKey,
    new TextEncoder().encode(JSON.stringify(plaintext)),
  );
  const eph = generateKeypair();
  // D-class retention (5 days), matching group-message conventions in DD §33.1.
  const expiration = now + 5 * 24 * 60 * 60;
  return finalizeEvent(
    {
      kind: KIND_GROUP_MESSAGE,
      created_at: now,
      tags: [
        [Tags.H, channelId],
        [Tags.EXPIRATION, String(expiration)],
      ],
      content: bytesToHex(ct),
    },
    eph.secret,
  );
}

/** Parsed group message. `senderScopeNym` is bytes matched against the roster. */
export interface DecryptedGroupMessage {
  senderScopeNym: Uint8Array;
  body: string;
  sentAt: number;
}

/**
 * Decrypt a 4920 event with the current group key. Returns null on any
 * failure (wrong kind, wrong key, tampered, malformed inner). No
 * signature check on the outer event — the ephemeral pubkey has no
 * meaning; authenticity comes from the group-key AEAD tag.
 */
export function parseGroupMessageEvent(
  evt: NostrEvent,
  groupKey: Uint8Array,
): DecryptedGroupMessage | null {
  if (evt.kind !== KIND_GROUP_MESSAGE) return null;
  try {
    const ct = hexToBytes(evt.content);
    const pt = openWithGroupKey(groupKey, ct);
    if (pt === null) return null;
    const inner = JSON.parse(new TextDecoder().decode(pt)) as GroupMessagePlaintext;
    if (inner.v !== GROUP_MSG_WIRE_VERSION) return null;
    if (typeof inner.senderScopeNym !== 'string' || inner.senderScopeNym.length !== 64) return null;
    return {
      senderScopeNym: hexToBytes(inner.senderScopeNym),
      body: inner.body,
      sentAt: inner.sentAt,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 4921 group-key rotation
// ---------------------------------------------------------------------------

interface RotationEntry {
  /** hex — recipient's p_sign (32 bytes, BIP-340 x-only). */
  pSign: string;
  /** NIP-44 v2 payload string — the new group key encrypted from the
   *  rotator to this recipient. */
  wrapped: string;
}

interface RotationWire {
  readonly v: number;
  /** Unix seconds when the rotation was issued. */
  issuedAt: number;
  entries: RotationEntry[];
}

/**
 * Build a 4921 rotation event. One entry per remaining member's `p_sign`.
 * A single ephemeral key is generated and used for BOTH the outer event
 * signature AND the NIP-44 seals — this keeps the rotator's real identity
 * off the event and lets each recipient decrypt using `evt.pubkey` as the
 * sender. Members can infer roles from timing and content authority, but
 * no cryptographic linkage to the rotator's identity is exposed.
 *
 * `recipientPSigns` is the list of remaining members' `p_sign` hex values
 * (from the roster after any join/ejection has been applied).
 */
export function buildGroupRotationEvent(
  newGroupKey: Uint8Array,
  recipientPSigns: readonly string[],
  channelId: string,
  now: number = Math.floor(Date.now() / 1000),
): NostrEvent {
  if (newGroupKey.length !== 32) {
    throw new Error(`newGroupKey must be 32 bytes (got ${newGroupKey.length})`);
  }
  // One ephemeral for both the outer signature and every NIP-44 seal.
  // Recipients recover the sender pubkey from `evt.pubkey`. The group key
  // is hex-encoded before sealing because `sealTo`'s UTF-8 roundtrip
  // corrupts arbitrary 32-byte payloads — NIP-44 v2 expects text-shaped
  // plaintext at the API boundary.
  const eph = generateKeypair();
  const keyHex = bytesToHex(newGroupKey);
  const entries: RotationEntry[] = recipientPSigns.map((pSign) => ({
    pSign,
    wrapped: sealTextTo(pSign, keyHex, eph.secret),
  }));
  const wire: RotationWire = {
    v: GROUP_MSG_WIRE_VERSION,
    issuedAt: now,
    entries,
  };
  const expiration = now + 5 * 24 * 60 * 60;
  return finalizeEvent(
    {
      kind: KIND_GROUP_ROTATION,
      created_at: now,
      tags: [
        [Tags.H, channelId],
        [Tags.EXPIRATION, String(expiration)],
      ],
      content: JSON.stringify(wire),
    },
    eph.secret,
  );
}

/**
 * A member decrypts the rotation event. Requires their `k_sign` (secret)
 * and the rotator's ephemeral pubkey (which was on the SEAL, not the outer
 * event — but we don't have separate seal-pubkey and outer-pubkey here;
 * the design collapses them by having the rotator use one ephemeral for
 * BOTH the outer signature AND the seal senders). So the rotator's
 * ephemeral pubkey to hand in is the *outer event's* pubkey.
 *
 * Returns the new 32-byte group key on success, null on any failure.
 */
export function extractRotatedGroupKey(
  evt: NostrEvent,
  memberPSignHex: string,
  memberKSignSecret: Uint8Array,
): Uint8Array | null {
  if (evt.kind !== KIND_GROUP_ROTATION) return null;
  try {
    const wire = JSON.parse(evt.content) as RotationWire;
    if (wire.v !== GROUP_MSG_WIRE_VERSION) return null;
    const entry = wire.entries.find((e) => e.pSign === memberPSignHex);
    if (!entry) return null;
    // The rotator's ephemeral pubkey is `evt.pubkey` (same key signs and
    // seals — see `buildGroupRotationEvent`). The group key was hex-encoded
    // before sealing to avoid UTF-8 corruption.
    const openedHex = openTextFrom(evt.pubkey, entry.wrapped, memberKSignSecret);
    if (openedHex.length !== 64) return null;
    const opened = hexToBytes(openedHex);
    if (opened.length !== 32) return null;
    return opened;
  } catch {
    return null;
  }
}
