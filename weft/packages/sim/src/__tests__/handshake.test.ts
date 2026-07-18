// M5-T4 sim: handshake engine — happy path (channelOpen) + Gate 2 (silent decline).

import { describe, it, expect } from 'vitest';
import {
  HandshakeEngine,
  MemoryStore,
  bytesToHex,
  buildAndSign,
  generateKeypair,
  type IdentityPayload,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

interface Party {
  keys: ReturnType<typeof generateKeypair>;
  store: MemoryStore;
  engine: HandshakeEngine;
  events: unknown[];
}

function makeParty(relay: MockRelay, name: string): Party {
  const keys = generateKeypair();
  const store = new MemoryStore({ userPubkey: bytesToHex(keys.pubkey) });
  const engine = new HandshakeEngine({
    me: keys,
    displayName: name,
    store,
    relay,
    now: () => relay.currentTime(),
  });
  const events: unknown[] = [];
  engine.on((e: unknown) => events.push(e));
  return { keys, store, engine, events };
}

/** Subscribe the relay to all of an engine's current ephemeral pubkeys.
 *  Called after registerResponderMatch / initiate so wraps to those pubkeys
 *  are routed into handleIncomingWrap. */
function subscribeEph(relay: MockRelay, engine: HandshakeEngine): void {
  for (const eph of engine.ephPubkeys()) {
    relay.subscribe({ kinds: [1059], p: [eph] }, (evt: NostrEvent) => {
      void engine.handleIncomingWrap(evt);
    });
  }
}

describe('handshake engine — happy path', () => {
  it('full A↔B handshake ends channelOpen with verified names', async () => {
    const relay = new MockRelay();
    const A = makeParty(relay, 'Alice');
    const B = makeParty(relay, 'Bob');

    const matchId = 'match-1';

    // B registers as responder BEFORE A initiates (so the ephemeral pubkey
    // is on the relay's subscribe list when A's 4913 lands).
    B.engine.registerResponderMatch(matchId);
    subscribeEph(relay, B.engine);

    // A initiates using B's ephemeral (they'd learn this from a real match
    // reply; the test passes it directly).
    const bEphPub = B.engine.ephPubkeys()[0];
    await A.engine.initiate(matchId, bEphPub, ['reveal.name', 'reveal.vouches']);
    subscribeEph(relay, A.engine);

    // Now that B's engine has the 'termsRequested' event, accept.
    await new Promise((r) => setTimeout(r, 20));
    const termsReq = B.events.find(
      (e): e is { type: string } => (e as { type: string }).type === 'termsRequested',
    );
    expect(termsReq).toBeDefined();

    // Build identity payloads. For simplicity, no vouches in this test.
    const aIdentity: IdentityPayload = {
      pubkey: bytesToHex(A.keys.pubkey),
      displayName: 'Alice',
      vouches: [],
    };
    const bIdentity: IdentityPayload = {
      pubkey: bytesToHex(B.keys.pubkey),
      displayName: 'Bob',
      vouches: [],
    };

    await B.engine.acceptTerms(matchId, bIdentity);
    await new Promise((r) => setTimeout(r, 20));

    // A saw the 4914; A should now send its own commit.
    await A.engine.sendMyCommit(matchId, aIdentity);
    await new Promise((r) => setTimeout(r, 50));

    // Both should reach channelOpen.
    const aOpen = A.events.find(
      (e): e is { type: string; theirIdentity: IdentityPayload } =>
        (e as { type: string }).type === 'channelOpen',
    );
    const bOpen = B.events.find(
      (e): e is { type: string; theirIdentity: IdentityPayload } =>
        (e as { type: string }).type === 'channelOpen',
    );
    expect(aOpen).toBeDefined();
    expect(bOpen).toBeDefined();
    expect(aOpen!.theirIdentity.displayName).toBe('Bob');
    expect(bOpen!.theirIdentity.displayName).toBe('Alice');
  });

  it('impersonation: tampered vouch subject → impersonationAlert, never channelOpen', async () => {
    const relay = new MockRelay();
    const A = makeParty(relay, 'Alice');
    const B = makeParty(relay, 'Bob');
    const matchId = 'match-imp';
    B.engine.registerResponderMatch(matchId);
    subscribeEph(relay, B.engine);
    const bEphPub = B.engine.ephPubkeys()[0];
    await A.engine.initiate(matchId, bEphPub, []);
    subscribeEph(relay, A.engine);
    await new Promise((r) => setTimeout(r, 20));

    // Build B's identity WITH a bogus vouch whose subject is NOT B.
    const bogusIssuer = generateKeypair();
    const bogusVouch = buildAndSign(
      {
        kind: 4902,
        content: JSON.stringify({
          subject: 'ff'.repeat(32), // NOT Bob's real pubkey
          tier: 3,
          ctx: 'personal',
          expires_at: 9999999999,
        }),
      },
      bogusIssuer.secret,
    );
    const bIdentity: IdentityPayload = {
      pubkey: bytesToHex(B.keys.pubkey),
      displayName: 'Bob',
      vouches: [bogusVouch],
    };
    const aIdentity: IdentityPayload = {
      pubkey: bytesToHex(A.keys.pubkey),
      displayName: 'Alice',
      vouches: [],
    };
    await B.engine.acceptTerms(matchId, bIdentity);
    await new Promise((r) => setTimeout(r, 20));
    await A.engine.sendMyCommit(matchId, aIdentity);
    await new Promise((r) => setTimeout(r, 50));

    const aAlert = A.events.find(
      (e): e is { type: string } => (e as { type: string }).type === 'impersonationAlert',
    );
    expect(aAlert).toBeDefined();
    const aOpen = A.events.find(
      (e): e is { type: string } => (e as { type: string }).type === 'channelOpen',
    );
    expect(aOpen).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Gate 2 — zero events on decline
// ---------------------------------------------------------------------------

describe('Gate 2 — silent decline emits zero events', () => {
  it('B receives an intent ping, taps Pass; B emits zero events on the wire', async () => {
    const relay = new MockRelay();
    const A = makeParty(relay, 'Alice');
    const B = makeParty(relay, 'Bob');
    const matchId = 'match-pass';

    B.engine.registerResponderMatch(matchId);
    subscribeEph(relay, B.engine);
    const bEphPub = B.engine.ephPubkeys()[0];
    await A.engine.initiate(matchId, bEphPub, []);
    subscribeEph(relay, A.engine);
    await new Promise((r) => setTimeout(r, 20));

    // Record baseline: what has been published so far?
    const baselineLog = [...relay.log];
    const bPubHex = bytesToHex(B.keys.pubkey);
    const bEphSet = new Set(B.engine.ephPubkeys());

    // B taps Pass.
    B.engine.pass(matchId);

    // Wait a real interval to give any lingering async work a chance to emit.
    await new Promise((r) => setTimeout(r, 100));

    // Assert: since Pass was called, NO new event was published by B.
    // "By B" means: any 1059 whose outer.pubkey is Bob's real pubkey OR
    // Bob's ephemeral pubkey for this match. Neither should exist.
    const afterPass = relay.log.slice(baselineLog.length);
    for (const evt of afterPass) {
      expect(evt.pubkey).not.toBe(bPubHex);
      expect(bEphSet.has(evt.pubkey)).toBe(false);
    }
    // In fact, in this scenario NOTHING should be published post-pass —
    // A already sent its ping, A doesn't retry.
    expect(afterPass.length).toBe(0);
  });

  it('B never responds → A state evaporates on sweep; A emits zero handshake events', async () => {
    const relay = new MockRelay(1000);
    const A = makeParty(relay, 'Alice');
    const matchId = 'match-timeout';

    // Fabricate B's ephemeral pubkey (we're not creating B; A initiates
    // into the void).
    const fakeB = generateKeypair();
    await A.engine.initiate(matchId, bytesToHex(fakeB.pubkey), []);
    subscribeEph(relay, A.engine);

    // Simulate time passing past the handshake TTL (6h + 1s).
    relay.setNow(1000 + 6 * 60 * 60 + 1);
    A.engine.sweep(relay.currentTime());

    // Filter out the 4913 that A sent when initiating.
    const wireEventsByA = relay.log.filter((e) => e.pubkey === bytesToHex(A.keys.pubkey));
    // A's real key shouldn't ever appear on the wire in handshakes — it
    // uses ephemerals.
    expect(wireEventsByA.length).toBe(0);
    // A's expired event (a listener event, not a wire event) IS allowed.
    const expiredEvent = A.events.find(
      (e): e is { type: string } => (e as { type: string }).type === 'expired',
    );
    expect(expiredEvent).toBeDefined();
  });
});
