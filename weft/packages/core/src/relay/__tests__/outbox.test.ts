import { describe, it, expect } from 'vitest';
import { generateKeypair } from '../../keys/keys';
import { buildAndSign } from '../../codec/event';
import { MemoryOutboxStorage, OutboxImpl } from '../outbox';
import type { NostrEvent } from 'nostr-tools/pure';
import type { Relay, RelayFilter, EventCallback } from '../types';

class ScriptedRelay implements Relay {
  published: NostrEvent[] = [];
  shouldThrow = false;
  async publish(evt: NostrEvent): Promise<void> {
    if (this.shouldThrow) throw new Error('down');
    this.published.push(evt);
  }
  subscribe(_f: RelayFilter, _c: EventCallback) {
    return { close: () => {} };
  }
}

describe('Outbox — build-list M4-T2', () => {
  it('enqueue then flush publishes and clears', async () => {
    const kp = generateKeypair();
    const evt = buildAndSign({ kind: 1, content: 'hi' }, kp.secret);
    const relay = new ScriptedRelay();
    const outbox = new OutboxImpl(new MemoryOutboxStorage());
    await outbox.enqueue(evt, ['wss://r']);
    expect(await outbox.size()).toBe(1);
    const result = await outbox.flush(relay);
    expect(result.sent).toBe(1);
    expect(await outbox.size()).toBe(0);
    expect(relay.published[0].id).toBe(evt.id);
  });

  it('failed publish keeps item queued', async () => {
    const kp = generateKeypair();
    const evt = buildAndSign({ kind: 1, content: 'hi' }, kp.secret);
    const relay = new ScriptedRelay();
    relay.shouldThrow = true;
    const outbox = new OutboxImpl(new MemoryOutboxStorage());
    await outbox.enqueue(evt, ['wss://r']);
    const result = await outbox.flush(relay);
    expect(result.sent).toBe(0);
    expect(result.failed).toBe(1);
    expect(await outbox.size()).toBe(1);
  });

  it('idempotent by event id', async () => {
    const kp = generateKeypair();
    const evt = buildAndSign({ kind: 1, content: 'hi' }, kp.secret);
    const outbox = new OutboxImpl(new MemoryOutboxStorage());
    await outbox.enqueue(evt, ['wss://a']);
    await outbox.enqueue(evt, ['wss://a']);
    expect(await outbox.size()).toBe(1);
  });
});
