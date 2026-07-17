// Offline-first outbox — the queue of events waiting to be published.
//
// Discipline: callers never call relay.publish() directly. They enqueue()
// and either wait for the next flush() or fire an immediate flush against a
// known-up relay. This is DD §32.3's offline posture in code — asks
// compose while offline, travel when reconnected.
//
// Build list M4-T2.

import type { NostrEvent } from 'nostr-tools/pure';
import type { Relay } from './types';

/** One queued event, with the relay set it should ride to. */
export interface OutboxItem {
  readonly id: string; // event id (also our dedupe key inside the queue)
  readonly event: NostrEvent;
  readonly relays: readonly string[];
  readonly enqueuedAt: number; // unix seconds
}

/**
 * Minimal outbox interface — the store implements the physical queue;
 * this class is the discipline layer that stops direct publish calls.
 */
export interface OutboxStorage {
  enqueue(item: OutboxItem): Promise<void>;
  list(): Promise<OutboxItem[]>;
  remove(id: string): Promise<void>;
}

/** Simple in-memory outbox storage. IdbStore-backed version arrives with M6. */
export class MemoryOutboxStorage implements OutboxStorage {
  private readonly items = new Map<string, OutboxItem>();

  async enqueue(item: OutboxItem): Promise<void> {
    this.items.set(item.id, item);
  }
  async list(): Promise<OutboxItem[]> {
    return [...this.items.values()].sort((a, b) => a.enqueuedAt - b.enqueuedAt);
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
}

export interface Outbox {
  /** Add to the queue. Idempotent by event id. */
  enqueue(evt: NostrEvent, relays: readonly string[], now?: number): Promise<void>;
  /** Publish everything in the queue. On failure, item stays queued. */
  flush(relay: Relay): Promise<FlushResult>;
  /** How many events are waiting. */
  size(): Promise<number>;
  /** Read the queue (for UI's "Asks out" list). */
  list(): Promise<OutboxItem[]>;
}

export interface FlushResult {
  readonly sent: number;
  readonly failed: number;
}

export class OutboxImpl implements Outbox {
  constructor(private readonly storage: OutboxStorage) {}

  async enqueue(evt: NostrEvent, relays: readonly string[], now?: number): Promise<void> {
    await this.storage.enqueue({
      id: evt.id,
      event: evt,
      relays,
      enqueuedAt: now ?? Math.floor(Date.now() / 1000),
    });
  }

  async flush(relay: Relay): Promise<FlushResult> {
    const items = await this.storage.list();
    let sent = 0;
    let failed = 0;
    for (const item of items) {
      try {
        await relay.publish(item.event, item.relays);
        await this.storage.remove(item.id);
        sent++;
      } catch {
        // Failed items stay queued for the next flush. We deliberately don't
        // count retries — this is a per-flush report.
        failed++;
      }
    }
    return { sent, failed };
  }

  async size(): Promise<number> {
    return (await this.storage.list()).length;
  }

  async list(): Promise<OutboxItem[]> {
    return this.storage.list();
  }
}
