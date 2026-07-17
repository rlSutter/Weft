// Relay interface — transport-agnostic. Adapters live in pwa/ (SimplePool)
// and porch/ (Node WebSocket); MockRelay lives in sim/.
//
// Sources of law:
//   DD §33.1     relays see kind 1059, p tag, ciphertext, expiration
//   DD §11.4     multi-homing; relays are fireable by config change
//   Build list M4-T1

import type { NostrEvent } from 'nostr-tools/pure';

/** Subscription filter — subset of NIP-01 REQ filter that Weft uses. */
export interface RelayFilter {
  /** Match by kind (e.g., [1059]). */
  readonly kinds?: readonly number[];
  /** Match by `p` tag (recipient) — the most common Weft filter. */
  readonly p?: readonly string[];
  /** Match by event ids. */
  readonly ids?: readonly string[];
  /** `created_at >= since`. */
  readonly since?: number;
}

export interface Subscription {
  /** Stop receiving events. Idempotent. */
  close(): void;
}

/** Callback for events matching a subscription. */
export type EventCallback = (evt: NostrEvent) => void;

export interface Relay {
  /**
   * Publish an event to the underlying relays. `relayUrls` selects a subset;
   * omit to use whatever the adapter's default relay set is.
   */
  publish(evt: NostrEvent, relayUrls?: readonly string[]): Promise<void>;

  /**
   * Subscribe to events matching a filter. Returns a handle whose `close()`
   * stops delivery.
   */
  subscribe(filter: RelayFilter, onEvent: EventCallback): Subscription;
}
