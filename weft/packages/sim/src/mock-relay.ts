// In-memory MockRelay — satisfies the same @weft/core `Relay` interface
// used by the pwa/porch SimplePool adapters, but with a fake clock and no
// network. Every M4/M5 sim test runs against this.

import type {
  EventCallback,
  NostrEvent,
  Relay,
  RelayFilter,
  Subscription,
} from '@weft/core';

interface SubscriptionInternal {
  readonly filter: RelayFilter;
  readonly onEvent: EventCallback;
  active: boolean;
}

export class MockRelay implements Relay {
  private readonly stored = new Map<string, NostrEvent>();
  private readonly subs = new Set<SubscriptionInternal>();
  private now: number;
  /** When true, publish() throws. Used to simulate a "down" relay. */
  private down = false;
  /** All events ever published, in publish order — audit tape for tests. */
  readonly log: NostrEvent[] = [];

  constructor(initialNow: number = 1_800_000_000) {
    this.now = initialNow;
  }

  // --- clock control (test-only) ---
  advance(seconds: number): void {
    this.now += seconds;
    this.sweep();
  }
  setNow(seconds: number): void {
    this.now = seconds;
    this.sweep();
  }
  currentTime(): number {
    return this.now;
  }

  // --- outage control (test-only) ---
  goDown(): void {
    this.down = true;
  }
  goUp(): void {
    this.down = false;
  }

  // --- Relay interface ---
  async publish(evt: NostrEvent, _relayUrls?: readonly string[]): Promise<void> {
    if (this.down) throw new Error('MockRelay: relay is down');
    this.stored.set(evt.id, evt);
    this.log.push(evt);
    // Deliver to matching subscribers synchronously.
    for (const s of this.subs) {
      if (s.active && matches(evt, s.filter)) {
        s.onEvent(evt);
      }
    }
  }

  subscribe(filter: RelayFilter, onEvent: EventCallback): Subscription {
    const internal: SubscriptionInternal = { filter, onEvent, active: true };
    this.subs.add(internal);
    // Replay stored events matching the filter.
    for (const evt of this.stored.values()) {
      if (matches(evt, filter)) onEvent(evt);
    }
    return {
      close: () => {
        internal.active = false;
        this.subs.delete(internal);
      },
    };
  }

  // --- inspection helpers (test-only) ---

  /** All currently-stored events (post-sweep). */
  storedEvents(): NostrEvent[] {
    return [...this.stored.values()];
  }

  /** Events of a given kind in the publish log (in order). */
  logByKind(kind: number): NostrEvent[] {
    return this.log.filter((e) => e.kind === kind);
  }

  /** Events published by a given pubkey (author). */
  logByAuthor(pubkey: string): NostrEvent[] {
    return this.log.filter((e) => e.pubkey === pubkey);
  }

  // --- expiration sweep ---
  private sweep(): void {
    for (const [id, evt] of this.stored) {
      const expTag = evt.tags.find((t: string[]) => t[0] === 'expiration');
      if (expTag && Number(expTag[1]) <= this.now) {
        this.stored.delete(id);
      }
    }
  }
}

function matches(evt: NostrEvent, filter: RelayFilter): boolean {
  if (filter.kinds && !filter.kinds.includes(evt.kind)) return false;
  if (filter.ids && !filter.ids.includes(evt.id)) return false;
  if (filter.since !== undefined && evt.created_at < filter.since) return false;
  if (filter.p) {
    const pTags = evt.tags.filter((t: string[]) => t[0] === 'p').map((t: string[]) => t[1]);
    if (!filter.p.some((want: string) => pTags.includes(want))) return false;
  }
  return true;
}
