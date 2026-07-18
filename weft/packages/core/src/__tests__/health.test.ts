import { describe, it, expect } from 'vitest';
import { HealthLog, zeroCounters } from '../health';

describe('HealthLog — M5-T5, OBSERVABILITY.md', () => {
  it('starts at zero', () => {
    const h = new HealthLog();
    expect(h.snapshot()).toEqual(zeroCounters());
  });

  it('increments each counter independently', () => {
    const h = new HealthLog();
    h.askSent();
    h.askSent();
    h.askMatched();
    h.forwardRelayed();
    h.handshakeCompleted();
    h.deadQuery();
    expect(h.snapshot()).toEqual({
      asksSent: 2,
      asksMatched: 1,
      handshakesCompleted: 1,
      forwardsRelayed: 1,
      deadQueries: 1,
    });
  });

  it('exposes no publish / serialize / reset API', () => {
    const h = new HealthLog();
    const surface = Object.getOwnPropertyNames(HealthLog.prototype);
    // Deliberately narrow surface — new methods should be reviewed against
    // OBSERVABILITY.md "never leaves this phone" contract.
    expect(surface.sort()).toEqual(
      [
        'askMatched',
        'askSent',
        'constructor',
        'deadQuery',
        'forwardRelayed',
        'handshakeCompleted',
        'snapshot',
      ].sort(),
    );
    // Also assert no 'toJSON' — accidental JSON serialization is a common
    // way for observability to leak.
    expect((h as unknown as { toJSON?: unknown }).toJSON).toBeUndefined();
  });
});
