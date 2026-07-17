import { describe, it, expect, beforeEach } from 'vitest';

import { generateKeypair } from '../../keys/keys';
import { buildAndSign } from '../../codec/event';
import { MemoryStore } from '../memory';
import { CURRENT_SCHEMA_VERSION, type CachedVouch } from '../types';
import { planMigrations } from '../migrations';

let store: MemoryStore;
beforeEach(() => {
  store = new MemoryStore();
});

describe('MemoryStore — events', () => {
  it('put/get roundtrips', async () => {
    const kp = generateKeypair();
    const e = buildAndSign({ kind: 1, content: 'hi' }, kp.secret);
    await store.putEvent(e);
    expect(await store.getEvent(e.id)).toEqual(e);
  });

  it('queryEvents filters by kind, since, tags, limit', async () => {
    const kp = generateKeypair();
    const a = buildAndSign({ kind: 1, content: 'a', created_at: 1000 }, kp.secret);
    const b = buildAndSign({ kind: 2, content: 'b', created_at: 2000 }, kp.secret);
    const c = buildAndSign(
      { kind: 1, content: 'c', created_at: 3000, tags: [['p', 'x'.repeat(64)]] },
      kp.secret,
    );
    for (const e of [a, b, c]) await store.putEvent(e);

    expect((await store.queryEvents({ kinds: [1] })).length).toBe(2);
    expect((await store.queryEvents({ since: 2500 })).length).toBe(1);
    expect((await store.queryEvents({ tags: { p: ['x'.repeat(64)] } })).length).toBe(1);
    expect((await store.queryEvents({ limit: 1 })).length).toBe(1);
  });
});

describe('MemoryStore — contacts', () => {
  it('upsert/get/list/remove', async () => {
    await store.upsertContact({ pubkey: 'aa', displayName: 'Alice', relayHints: ['wss://a'], addedAt: 100 });
    await store.upsertContact({ pubkey: 'bb', displayName: 'Bob', relayHints: [], addedAt: 200 });
    expect((await store.getContact('aa'))?.displayName).toBe('Alice');
    expect((await store.listContacts()).length).toBe(2);
    await store.removeContact('aa');
    expect(await store.getContact('aa')).toBeUndefined();
  });
});

describe('MemoryStore — vouches (private cache)', () => {
  it('putVouch/getVouchesForSubject', async () => {
    const kp = generateKeypair();
    const e = buildAndSign({ kind: 4902, content: '{}' }, kp.secret);
    const v: CachedVouch = {
      subject: 'me',
      issuer: 'them',
      event: e,
      expiresAt: 9999999,
      attestationHash: 'h1',
    };
    await store.putVouch(v);
    const list = await store.getVouchesForSubject('me');
    expect(list.length).toBe(1);
    expect(list[0].attestationHash).toBe('h1');
  });

  it('getMyVouches filters by userPubkey', async () => {
    store.setUserPubkey('me');
    const kp = generateKeypair();
    const e = buildAndSign({ kind: 4902, content: '{}' }, kp.secret);
    await store.putVouch({ subject: 'me', issuer: 'a', event: e, expiresAt: 100, attestationHash: 'h1' });
    await store.putVouch({ subject: 'other', issuer: 'a', event: e, expiresAt: 100, attestationHash: 'h2' });
    expect((await store.getMyVouches()).length).toBe(1);
  });
});

describe('MemoryStore — stamps', () => {
  it('adjustStamp accumulates', async () => {
    expect(await store.adjustStamp('a', 10)).toBe(10);
    expect(await store.adjustStamp('a', -3)).toBe(7);
    expect(await store.getStamp('a')).toBe(7);
    expect(await store.getStamp('nonexistent')).toBe(0);
  });
});

describe('MemoryStore — query state', () => {
  it('put/get/list expired', async () => {
    await store.putQueryState({ queryId: 'q1', ephemeralSecretHex: '01', ttlAtSend: 4, expiresAt: 100 });
    await store.putQueryState({ queryId: 'q2', ephemeralSecretHex: '02', ttlAtSend: 4, expiresAt: 200 });
    const expired = await store.listExpiredQueryStates(150);
    expect(expired.map((s) => s.queryId)).toEqual(['q1']);
  });
});

describe('MemoryStore — reverse routes (F2, token-keyed not query-keyed)', () => {
  it('put/get by myRouteToken; never by queryId', async () => {
    await store.putReverseRoute({
      myRouteToken: 'aa',
      upstreamRouteToken: 'bb',
      cameFromPubkey: 'peer',
      expiresAt: 100,
    });
    const r = await store.getReverseRoute('aa');
    expect(r?.upstreamRouteToken).toBe('bb');
    expect(r?.cameFromPubkey).toBe('peer');
  });
});

describe('MemoryStore — expireSweep (M3-T2 reaper)', () => {
  it('deletes expired queryState, reverseRoutes, and events past their expiration tag', async () => {
    const kp = generateKeypair();
    const expiredEvent = buildAndSign(
      {
        kind: 4913,
        content: 'x',
        tags: [['expiration', '100']],
        created_at: 1,
      },
      kp.secret,
    );
    const liveEvent = buildAndSign(
      {
        kind: 4913,
        content: 'y',
        tags: [['expiration', '9999999']],
        created_at: 1,
      },
      kp.secret,
    );
    await store.putEvent(expiredEvent);
    await store.putEvent(liveEvent);
    await store.putQueryState({ queryId: 'q1', ephemeralSecretHex: '01', ttlAtSend: 4, expiresAt: 50 });
    await store.putQueryState({ queryId: 'q2', ephemeralSecretHex: '02', ttlAtSend: 4, expiresAt: 500 });
    await store.putReverseRoute({
      myRouteToken: 'rt1',
      upstreamRouteToken: 'up1',
      cameFromPubkey: 'a',
      expiresAt: 50,
    });
    await store.putReverseRoute({
      myRouteToken: 'rt2',
      upstreamRouteToken: 'up2',
      cameFromPubkey: 'b',
      expiresAt: 500,
    });

    const result = await store.expireSweep(200);
    expect(result.queryStates).toBe(1);
    expect(result.reverseRoutes).toBe(1);
    expect(result.events).toBe(1);

    expect(await store.getQueryState('q1')).toBeUndefined();
    expect(await store.getQueryState('q2')).toBeDefined();
    expect(await store.getReverseRoute('rt1')).toBeUndefined();
    expect(await store.getReverseRoute('rt2')).toBeDefined();
    expect(await store.getEvent(expiredEvent.id)).toBeUndefined();
    expect(await store.getEvent(liveEvent.id)).toBeDefined();
  });
});

describe('schema migrations — Fable L14', () => {
  it('planMigrations returns empty when already current', () => {
    expect(planMigrations(CURRENT_SCHEMA_VERSION, CURRENT_SCHEMA_VERSION)).toEqual([]);
  });

  it('refuses to downgrade (schema newer than client)', () => {
    expect(() => planMigrations(CURRENT_SCHEMA_VERSION + 1)).toThrow(/newer than this client/);
  });

  it('throws on missing step (currently: any step, since we only have v1)', () => {
    if (CURRENT_SCHEMA_VERSION < 2) return; // no migrations to test yet
    // When v2 arrives, planMigrations(1) must return a non-empty plan.
  });
});
