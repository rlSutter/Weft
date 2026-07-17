// M5-T2 sim: two nodes, full invite → redeem → confirm cycle.
// Includes Gate 3 assertion: no plaintext 4902 ever lands on MockRelay.

import { describe, it, expect } from 'vitest';
import {
  InviteEngine,
  MemoryStore,
  bytesToHex,
  generateKeypair,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

interface Node {
  keys: ReturnType<typeof generateKeypair>;
  store: MemoryStore;
  engine: InviteEngine;
  events: unknown[];
}

function makeNode(relay: MockRelay, now: () => number): Node {
  const keys = generateKeypair();
  const store = new MemoryStore({ userPubkey: bytesToHex(keys.pubkey) });
  const engine = new InviteEngine(store, relay, keys, [], now);
  const events: unknown[] = [];
  engine.on((e) => events.push(e));

  // Route every 1059 addressed to me into engine.handleIncomingWrap.
  relay.subscribe({ kinds: [1059], p: [bytesToHex(keys.pubkey)] }, (evt: NostrEvent) => {
    void engine.handleIncomingWrap(evt);
  });
  return { keys, store, engine, events };
}

describe('invite engine — full happy path (M5-T2)', () => {
  it('createInvite → redeem → confirm ends with mutual contacts + private vouches (Gate 3)', async () => {
    const relay = new MockRelay();
    const now = () => relay.currentTime();
    const alice = makeNode(relay, now);
    const bob = makeNode(relay, now);
    const charterId = new Uint8Array(32).fill(0xcc);

    // Alice creates an invite.
    const { tokenStr, iid } = await alice.engine.createInvite({
      sentTo: 'Bob T.',
      tier: 3,
      ctx: 'personal',
      relays: ['wss://irrelevant'],
      charterId,
    });
    expect(iid).toMatch(/^[0-9a-f]{32}$/);
    expect((await alice.store.getInvite(iid))?.status).toBe('sent');

    // Bob redeems.
    const redeem = await bob.engine.redeemInvite(tokenStr, 'Bob T.');
    expect(redeem.ok).toBe(true);
    if (!redeem.ok) return;

    // Because the subscribe callback fires the engine's handler on publish,
    // Alice's engine should have processed the 4918 by now.
    // Allow any queued microtasks to drain.
    await new Promise((r) => setTimeout(r, 5));

    const inviteAfterRedeem = await alice.store.getInvite(iid);
    expect(inviteAfterRedeem?.status).toBe('awaitingConfirm');
    expect(inviteAfterRedeem?.redeemerPubkey).toBe(bytesToHex(redeem.bobKeypair.pubkey));

    // Alice confirms — this is where the 4902 is created and WRAPPED to Bob.
    // Bob's node needs to be able to unwrap with his fresh keypair, but the
    // default node uses a different keypair. Wire Bob's redeemed key into
    // his engine so the vouch delivery is decryptable by him.
    // Simplest: create a Bob2 engine using redeem.bobKeypair, hook it up.
    const bobStore2 = new MemoryStore({ userPubkey: bytesToHex(redeem.bobKeypair.pubkey) });
    const bobEngine2 = new InviteEngine(bobStore2, relay, redeem.bobKeypair, [], now);
    const bobEvents2: unknown[] = [];
    bobEngine2.on((e) => bobEvents2.push(e));
    relay.subscribe(
      { kinds: [1059], p: [bytesToHex(redeem.bobKeypair.pubkey)] },
      (evt: NostrEvent) => void bobEngine2.handleIncomingWrap(evt),
    );

    await alice.engine.confirmInvite(iid, true);
    await new Promise((r) => setTimeout(r, 5));

    // Alice: invite is confirmed, Bob is a contact, Alice cached her attestation.
    expect((await alice.store.getInvite(iid))?.status).toBe('confirmed');
    expect(await alice.store.getContact(bytesToHex(redeem.bobKeypair.pubkey))).toBeDefined();
    expect((await alice.store.getMyVouches()).length).toBe(0); // Alice isn't the subject
    const aliceCache = await alice.store.getVouchesForSubject(bytesToHex(redeem.bobKeypair.pubkey));
    expect(aliceCache.length).toBe(1);
    expect(aliceCache[0].issuer).toBe(bytesToHex(alice.keys.pubkey));

    // Bob: cached vouch privately (as subject).
    const bobVouches = await bobStore2.getMyVouches();
    expect(bobVouches.length).toBe(1);
    expect(bobVouches[0].issuer).toBe(bytesToHex(alice.keys.pubkey));
    // Bob has Alice as a contact too.
    expect(await bobStore2.getContact(bytesToHex(alice.keys.pubkey))).toBeDefined();

    // Gate 3: NO plaintext 4902 on the relay. Only 1059 gift wraps and
    // possibly a 4903 void (but not on the happy path).
    const plaintextVouches = relay.logByKind(4902);
    expect(plaintextVouches.length).toBe(0);
    // Also assert: no 4919 hello plaintext either (was wrapped).
    expect(relay.logByKind(4919).length).toBe(0);
  });

  it('second redemption of the same iid surfaces replayAlert; no second vouch', async () => {
    const relay = new MockRelay();
    const now = () => relay.currentTime();
    const alice = makeNode(relay, now);
    const bob = makeNode(relay, now);
    const charterId = new Uint8Array(32).fill(0xcc);

    const { tokenStr } = await alice.engine.createInvite({
      sentTo: 'Bob',
      tier: 2,
      ctx: 'personal',
      relays: [],
      charterId,
    });

    // First redemption — legitimate.
    await bob.engine.redeemInvite(tokenStr, 'Bob');
    await new Promise((r) => setTimeout(r, 5));

    // Second redemption by an attacker (a different keypair reusing the leaked token).
    const eve = makeNode(relay, now);
    await eve.engine.redeemInvite(tokenStr, 'not Bob');
    await new Promise((r) => setTimeout(r, 5));

    // Alice should have emitted exactly one replayAlert.
    const alerts = alice.events.filter(
      (e): e is { type: string } => (e as { type: string }).type === 'replayAlert',
    );
    expect(alerts.length).toBe(1);
  });

  it('void path: no vouch created; 4903 published', async () => {
    const relay = new MockRelay();
    const now = () => relay.currentTime();
    const alice = makeNode(relay, now);
    const bob = makeNode(relay, now);
    const charterId = new Uint8Array(32).fill(0xcc);

    const { tokenStr, iid } = await alice.engine.createInvite({
      sentTo: 'Bob',
      tier: 2,
      ctx: 'personal',
      relays: [],
      charterId,
    });
    const redeem = await bob.engine.redeemInvite(tokenStr, 'Bob');
    expect(redeem.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 5));

    await alice.engine.confirmInvite(iid, false);
    expect((await alice.store.getInvite(iid))?.status).toBe('voided');
    expect(await alice.store.getContact(bytesToHex((redeem as { bobKeypair: { pubkey: Uint8Array } }).bobKeypair.pubkey))).toBeUndefined();

    // A 4903 void was published — the ONLY vouch-related object that
    // legitimately touches a relay.
    expect(relay.logByKind(4903).length).toBe(1);
    // Still no plaintext 4902.
    expect(relay.logByKind(4902).length).toBe(0);
  });
});
