import { describe, it, expect } from 'vitest';
import { generateKeypair, buildAndSign, wrap, unwrap, bytesToHex } from '@weft/core';
import { MockRelay } from '../mock-relay';

describe('MockRelay — build-list M4-T1 acceptance', () => {
  it('publish → subscribe delivery', () => {
    const kp = generateKeypair();
    const relay = new MockRelay();
    const received: string[] = [];
    relay.subscribe({ kinds: [1] }, (e) => received.push(e.content));
    const evt = buildAndSign({ kind: 1, content: 'hello' }, kp.secret);
    return relay.publish(evt).then(() => {
      expect(received).toEqual(['hello']);
    });
  });

  it('subscribes with p-tag filter (Weft common case)', async () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const relay = new MockRelay();
    const forBob: string[] = [];
    relay.subscribe({ kinds: [1059], p: [bytesToHex(bob.pubkey)] }, (e) => forBob.push(e.id));

    const inner = buildAndSign({ kind: 4913 }, alice.secret);
    const wrapped = wrap(inner, bytesToHex(bob.pubkey));
    await relay.publish(wrapped);
    expect(forBob).toEqual([wrapped.id]);

    // A wrap to someone else should NOT deliver to bob's sub.
    const eve = generateKeypair();
    const otherInner = buildAndSign({ kind: 4913 }, alice.secret);
    const otherWrap = wrap(otherInner, bytesToHex(eve.pubkey));
    await relay.publish(otherWrap);
    expect(forBob).toEqual([wrapped.id]);
  });

  it('node A → wrap → publish → node B receives and unwraps', async () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const relay = new MockRelay();
    const inner = buildAndSign({ kind: 4913, content: 'intent' }, alice.secret);
    const outer = wrap(inner, bytesToHex(bob.pubkey));

    let receivedInner: string | undefined;
    relay.subscribe({ kinds: [1059], p: [bytesToHex(bob.pubkey)] }, (evt: import('@weft/core').NostrEvent) => {
      const opened = unwrap(evt, bob.secret);
      if (opened) receivedInner = opened.inner.id;
    });
    await relay.publish(outer);
    expect(receivedInner).toBe(inner.id);
  });

  it('honors expiration on fake-clock advance', async () => {
    const kp = generateKeypair();
    const relay = new MockRelay(1000);
    const evt = buildAndSign(
      { kind: 4913, content: 'x', created_at: 1000, tags: [['expiration', '1500']] },
      kp.secret,
    );
    await relay.publish(evt);
    expect(relay.storedEvents().length).toBe(1);
    relay.advance(600); // now 1600, past expiration 1500
    expect(relay.storedEvents().length).toBe(0);
  });

  it('down mode causes publish to throw (used by outbox tests)', async () => {
    const kp = generateKeypair();
    const relay = new MockRelay();
    relay.goDown();
    const evt = buildAndSign({ kind: 1, content: 'x' }, kp.secret);
    await expect(relay.publish(evt)).rejects.toThrow();
    relay.goUp();
    await relay.publish(evt); // succeeds now
    expect(relay.log.length).toBe(1);
  });
});
