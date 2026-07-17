// NIP-59-style gift wrap — the outer envelope that carries every private
// object in Weft.
//
// Sources of law:
//   DD §33.1       every private object rides in a kind-1059 wrap under a
//                  fresh ephemeral key; relays see kind, recipient tag,
//                  ciphertext, expiration
//   DD §35 F3      wrapper `created_at` is drawn uniformly from the past
//                  48 h (randomizedCreatedAt) so timing correlation is
//                  bounded even for pubkey-level observers
//   DD §9.1        "sign inside, encrypt outside"
//   Build list M2-T2

import { finalizeEvent, verifyEvent as verifyNostr, type NostrEvent } from 'nostr-tools/pure';

import { Tags } from '../kinds/tags';
import { kindByNumber } from '../kinds/registry';
import { randomizedCreatedAt } from '../kinds/timestamp';
import { bytesToHex, publicKeyFromSecret, withEphemeral } from '../keys/keys';
import { openTextFrom, sealTextTo } from './nip44';

/** The outer 1059 gift-wrap event. */
export type GiftWrapEvent = NostrEvent;

/** Result of unwrapping — the inner event, plus the wrapper's ephemeral pubkey. */
export interface Unwrapped {
  readonly inner: NostrEvent;
  readonly wrapperPubkey: string;
}

/**
 * Wrap a signed inner event to a recipient under a fresh ephemeral key.
 *
 * The wrapper:
 *   - kind:       1059
 *   - pubkey:     ephemeral (never equals inner.pubkey)
 *   - content:    NIP-44 v2 seal of JSON(inner) from ephemeral to recipient
 *   - tags:       [['p', recipientPubkey], ['expiration', str(...)]]
 *   - created_at: uniform in [now - 48h, now - 1] (DD §35 F3)
 *   - sig:        BIP-340 by ephemeral over the wrapper id
 *
 * The wrapper's `expiration` is derived from the *inner* kind's retention
 * class via `kindByNumber(inner.kind).expirationSeconds`, then anchored to
 * true `now` (NOT the randomized `created_at` — the two clocks are decoupled
 * on purpose; retention is real-time, timestamps on the wrapper are chaff).
 *
 * If the inner kind is not in the registry, defaults to the D class (5 days).
 *
 * `now` (unix seconds) and `rng` are injectable for tests. Defaults are the
 * real wall-clock and `Math.random`.
 */
export function wrap(
  inner: NostrEvent,
  recipientPubkeyHex: string,
  now: number = Math.floor(Date.now() / 1000),
  rng: () => number = Math.random,
): GiftWrapEvent {
  return withEphemeral((eph) => {
    const ephPubHex = bytesToHex(eph.pubkey);
    const sealed = sealTextTo(recipientPubkeyHex, JSON.stringify(inner), eph.secret);

    // Expiration is anchored to true `now`, per inner-kind retention class.
    const kindDef = kindByNumber(inner.kind);
    const expSeconds =
      kindDef && kindDef.expirationSeconds !== null
        ? kindDef.expirationSeconds
        : 5 * 24 * 60 * 60; // D-class fallback
    const expiration = now + expSeconds;

    const randomizedTs = randomizedCreatedAt(now, rng);

    const outer = finalizeEvent(
      {
        kind: 1059,
        created_at: randomizedTs,
        tags: [
          [Tags.P, recipientPubkeyHex],
          [Tags.EXPIRATION, String(expiration)],
        ],
        content: sealed,
      },
      eph.secret,
    );

    // Sanity: outer pubkey MUST differ from inner (invariant 4-ish assertion
    // to keep the invariant in the codepath, not only in the docs).
    if (outer.pubkey === inner.pubkey) {
      throw new Error('wrap: ephemeral pubkey collided with inner pubkey');
    }
    // Verify ephPubHex tag consistency in test builds.
    if (outer.pubkey !== ephPubHex) {
      throw new Error('wrap: outer.pubkey drift vs. ephemeral derivation');
    }
    return outer;
  });
}

/**
 * Unwrap a 1059 gift wrap addressed to `recipientSecret`.
 *
 * Steps:
 *   1. Verify the outer BIP-340 signature.
 *   2. Confirm kind === 1059.
 *   3. NIP-44 decrypt content from outer.pubkey to recipient.
 *   4. JSON-parse the inner event.
 *   5. Verify the inner event's own BIP-340 signature (sign-inside).
 *
 * Returns `null` on any failure — callers show a "malformed" error, they do
 * not need to know why. Throwing here would leak parse details to logs the
 * observability layer forbids (`OBSERVABILITY.md`).
 */
export function unwrap(
  outer: GiftWrapEvent,
  recipientSecret: Uint8Array,
): Unwrapped | null {
  try {
    if (outer.kind !== 1059) return null;
    if (!verifyNostr(outer)) return null;

    const plaintext = openTextFrom(outer.pubkey, outer.content, recipientSecret);
    const inner = JSON.parse(plaintext) as NostrEvent;

    // Structural sanity before signature check — nostr-tools' verify assumes
    // a well-formed event.
    if (
      typeof inner !== 'object' ||
      inner === null ||
      typeof inner.id !== 'string' ||
      typeof inner.pubkey !== 'string' ||
      typeof inner.sig !== 'string' ||
      typeof inner.kind !== 'number' ||
      !Array.isArray(inner.tags)
    ) {
      return null;
    }

    if (!verifyNostr(inner)) return null;

    return { inner, wrapperPubkey: outer.pubkey };
  } catch {
    return null;
  }
}

/**
 * Convenience: wrap the same inner event to multiple recipients. Each wrap
 * uses a distinct ephemeral key and a distinct randomized `created_at`, so
 * the bytes differ per recipient (no cross-recipient correlation).
 */
export function wrapToMany(
  inner: NostrEvent,
  recipientPubkeyHexes: readonly string[],
  now: number = Math.floor(Date.now() / 1000),
  rng: () => number = Math.random,
): GiftWrapEvent[] {
  return recipientPubkeyHexes.map((p) => wrap(inner, p, now, rng));
}

/**
 * Pairwise wrap: same envelope shape as `wrap`, but signed and encrypted
 * with the sender's *real* key rather than a fresh ephemeral. The receiver
 * can therefore see WHICH contact sent them the wrapper (needed by the
 * query engine for postage / cameFrom / reverse-route bookkeeping), while
 * the *contents* remain hidden and origin ambiguity of the underlying
 * query holds per DD §17.2 (Sam sent it — Sam may have authored it, or
 * Sam may be forwarding).
 *
 * `extraTags` is used by the query engine to attach the per-edge route
 * token (`rt`); no other module should add wrapper tags unilaterally
 * (DD §33.4 "nothing else may carry routing-relevant meaning").
 */
export function wrapPairwise(
  inner: NostrEvent,
  senderSecret: Uint8Array,
  recipientPubkeyHex: string,
  extraTags: readonly (readonly string[])[] = [],
  now: number = Math.floor(Date.now() / 1000),
  rng: () => number = Math.random,
): GiftWrapEvent {
  const sealed = sealTextTo(recipientPubkeyHex, JSON.stringify(inner), senderSecret);
  const kindDef = kindByNumber(inner.kind);
  const expSeconds =
    kindDef && kindDef.expirationSeconds !== null
      ? kindDef.expirationSeconds
      : 5 * 24 * 60 * 60;
  const tags: string[][] = [
    [Tags.P, recipientPubkeyHex],
    [Tags.EXPIRATION, String(now + expSeconds)],
    ...extraTags.map((t) => [...t]),
  ];
  return finalizeEvent(
    {
      kind: 1059,
      created_at: randomizedCreatedAt(now, rng),
      tags,
      content: sealed,
    },
    senderSecret,
  );
}

/**
 * Pairwise unwrap counterpart. Verifies outer sig, decrypts using the
 * pairwise conversation key between the recipient and `outer.pubkey`,
 * parses and verifies the inner event.
 */
export function unwrapPairwise(
  outer: GiftWrapEvent,
  recipientSecret: Uint8Array,
): Unwrapped | null {
  try {
    if (outer.kind !== 1059) return null;
    if (!verifyNostr(outer)) return null;
    const plaintext = openTextFrom(outer.pubkey, outer.content, recipientSecret);
    const inner = JSON.parse(plaintext) as NostrEvent;
    if (
      typeof inner !== 'object' ||
      inner === null ||
      typeof inner.id !== 'string' ||
      typeof inner.pubkey !== 'string' ||
      typeof inner.sig !== 'string' ||
      typeof inner.kind !== 'number' ||
      !Array.isArray(inner.tags)
    ) {
      return null;
    }
    if (!verifyNostr(inner)) return null;
    return { inner, wrapperPubkey: outer.pubkey };
  } catch {
    return null;
  }
}

/**
 * Re-export: derive the ephemeral pubkey hex from a secret. Useful for
 * callers that want to know "who did I wrap as" before shipping the outer.
 */
export function derivePubkeyHex(secret: Uint8Array): string {
  return bytesToHex(publicKeyFromSecret(secret));
}
