// NIP-01 event codec — build, sign, verify Nostr events.
//
// Sources of law:
//   NIP-01         event shape and id = sha256(canonical([0, pubkey, created_at, kind, tags, content]))
//   NIP-40         `expiration` tag (retention enforcement)
//   DD §33         our kind registry — retention class per kind
//   DD §35 F3      randomized wrapper timestamps (see kinds/timestamp.ts, applied by wrap/ at M2)
//   Build list M1-T2  what this module must expose and prove
//
// Design: everything that Nostr already knows (canonical serialization,
// id hashing, Schnorr sign, verify) comes from nostr-tools; we do not
// reimplement NIP-01. What lives here is Weft-specific: the automatic
// expiration tag derived from our kind registry (DD §33.1's retention
// classes), a typed builder that keeps the tag vocabulary honest, and
// a `WeftEvent` alias so callers don't reach into nostr-tools types.

import {
  finalizeEvent,
  getEventHash,
  verifyEvent as nostrVerifyEvent,
  type EventTemplate,
  type NostrEvent,
} from 'nostr-tools/pure';

import { kindByNumber } from '../kinds/registry';
import { Tags } from '../kinds/tags';

/** Fields required to build a Weft event. `pubkey`, `id`, `sig` come from signing. */
export interface WeftEventInput {
  readonly kind: number;
  readonly tags?: readonly (readonly string[])[];
  readonly content?: string;
  /** Unix seconds. If omitted, uses `Math.floor(Date.now() / 1000)`. */
  readonly created_at?: number;
}

/** A signed Weft event — identical shape to a NIP-01 event. */
export type WeftEvent = NostrEvent;

/** Template shape accepted by nostr-tools' `finalizeEvent`. */
export type WeftEventTemplate = EventTemplate;

/**
 * Build an event template ready for signing.
 *
 * If the kind's registry entry has a retention class (E / D / P with finite
 * `expirationSeconds`), an `expiration` tag is appended automatically at
 * `created_at + expirationSeconds` — NIP-40 wire form, DD §9.2 amnesia
 * enforced by the wire.
 *
 * The caller may pre-supply an `expiration` tag explicitly; we won't stomp
 * it (rare, e.g. shorter-than-class TTL for handshake states in flight).
 *
 * `registryOnly` kinds (currently only 4927 terms vocabulary) are refused:
 * they reserve a number but are not events, and emitting one is a bug.
 * `v2Only` kinds are also refused — v0 engines must never emit them
 * (build-list §13, kinds/registry.ts).
 */
export function buildEvent(input: WeftEventInput): WeftEventTemplate {
  const kindDef = kindByNumber(input.kind);
  if (kindDef?.registryOnly) {
    throw new Error(
      `kind ${input.kind} is registryOnly (reserves a number, not an event); cannot build`,
    );
  }
  if (kindDef?.v2Only) {
    throw new Error(
      `kind ${input.kind} is v2Only; v0 engines must not emit this (see kinds/registry.ts)`,
    );
  }

  const createdAt = input.created_at ?? Math.floor(Date.now() / 1000);
  const tags: string[][] = (input.tags ?? []).map((t) => [...t]);

  if (kindDef && kindDef.expirationSeconds !== null) {
    const alreadyPresent = tags.some((t) => t[0] === Tags.EXPIRATION);
    if (!alreadyPresent) {
      tags.push([Tags.EXPIRATION, String(createdAt + kindDef.expirationSeconds)]);
    }
  }

  return {
    kind: input.kind,
    created_at: createdAt,
    tags,
    content: input.content ?? '',
  };
}

/**
 * Sign a template with the given secret key. Returns a full NIP-01 event
 * (pubkey derived from secret, id = sha256 canonical, sig = BIP-340).
 *
 * Uses `nostr-tools/pure`'s `finalizeEvent` — do not reimplement.
 */
export function signEvent(template: WeftEventTemplate, secret: Uint8Array): WeftEvent {
  return finalizeEvent(template, secret);
}

/**
 * Build + sign in one call. Convenience wrapper for engines that don't need
 * to inspect the template between the two steps.
 */
export function buildAndSign(input: WeftEventInput, secret: Uint8Array): WeftEvent {
  return signEvent(buildEvent(input), secret);
}

/**
 * Verify a NIP-01 event. Checks the id (sha256 of canonical form) and the
 * BIP-340 signature. Delegates to `nostr-tools/pure`.
 */
export function verifyEvent(evt: WeftEvent): boolean {
  return nostrVerifyEvent(evt);
}

/** Recompute the event id from its content (does not check signatures). */
export function hashEvent(evt: WeftEventTemplate & { pubkey: string }): string {
  return getEventHash(evt);
}

/**
 * Read the `expiration` tag (NIP-40) if present. Returns unix seconds or null.
 * The reaper (M3-T2) uses this to decide when a cached event is dead.
 */
export function getExpiration(evt: Pick<WeftEvent, 'tags'>): number | null {
  for (const t of evt.tags) {
    if (t[0] === Tags.EXPIRATION && typeof t[1] === 'string') {
      const n = Number(t[1]);
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
