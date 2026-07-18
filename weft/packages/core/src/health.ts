// Local-only health counters — M5-T5, DD §10.1, OBSERVABILITY.md.
//
// Five increment-only counters shown to the user on the "What leaves this
// phone" screen. They NEVER leave the device: this module has no publish
// path, no relay coupling, and no way to serialize into a wire event. The
// beacon layer (kind 4905) is v2 and not implemented; when it lands, its
// design must survive the red-team test in OBSERVABILITY.md.

export interface HealthCounters {
  asksSent: number;
  asksMatched: number;
  handshakesCompleted: number;
  forwardsRelayed: number;
  deadQueries: number;
}

export const zeroCounters = (): HealthCounters => ({
  asksSent: 0,
  asksMatched: 0,
  handshakesCompleted: 0,
  forwardsRelayed: 0,
  deadQueries: 0,
});

/**
 * Increment-only counter store. Every method returns the updated value so
 * callers can log a delta if they want (e.g., for a session-scoped debug
 * view), but the stored counters themselves only ever grow.
 *
 * There is intentionally NO reset(), export(), or serialize() method. The
 * design's contract with the user is "these numbers never leave this
 * phone" — the code enforces that by not offering a way out.
 */
export class HealthLog {
  private readonly counters: HealthCounters = zeroCounters();

  askSent(): number {
    return ++this.counters.asksSent;
  }
  askMatched(): number {
    return ++this.counters.asksMatched;
  }
  handshakeCompleted(): number {
    return ++this.counters.handshakesCompleted;
  }
  forwardRelayed(): number {
    return ++this.counters.forwardsRelayed;
  }
  deadQuery(): number {
    return ++this.counters.deadQueries;
  }

  /** Read the current counters. Returns a defensive copy. */
  snapshot(): HealthCounters {
    return { ...this.counters };
  }
}
