// M5-T3 sim: query engine end-to-end + Gate 1 (byte-shape) + Gate 4 (route-token blinding).

import { describe, it, expect } from 'vitest';
import {
  MemoryStore,
  QueryEngine,
  StubEmbedder,
  bytesToHex,
  generateKeypair,
  readRt,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

interface QueryNode {
  name: string;
  keys: ReturnType<typeof generateKeypair>;
  store: MemoryStore;
  engine: QueryEngine;
  received: unknown[];
}

async function makeNode(
  relay: MockRelay,
  embedder: StubEmbedder,
  name: string,
  rng: () => number = Math.random,
): Promise<QueryNode> {
  const keys = generateKeypair();
  const store = new MemoryStore({ userPubkey: bytesToHex(keys.pubkey) });
  const engine = new QueryEngine({
    me: keys,
    store,
    relay,
    embedder,
    now: () => relay.currentTime(),
    rng,
  });
  const received: unknown[] = [];
  engine.on((e: unknown) => received.push(e));

  // Route incoming 1059's addressed to me into the engine, remembering
  // WHICH neighbor delivered it (we look at the outer.pubkey — but that's
  // the ephemeral wrap pubkey, not the real neighbor. We need out-of-band
  // context: the sim harness wraps this).
  relay.subscribe({ kinds: [1059], p: [bytesToHex(keys.pubkey)] }, (evt: NostrEvent) => {
    // The "cameFrom" concept requires knowing the previous-hop identity,
    // which the wire deliberately hides. In the sim we tag each outer's
    // `cameFrom` via a wire-external note attached to the event by the
    // harness that connected the two nodes. Simplest: pass the wrapper's
    // ephemeral pubkey as a stand-in — good enough for postage/probe
    // accounting per-ephemeral-neighbor; the real client will track this
    // via the outbox layer.
    void engine.handleIncomingWrap(evt);
  });
  return { name, keys, store, engine, received };
}

/** Add mutual contact edges between two nodes with a starting stamp balance. */
async function connect(a: QueryNode, b: QueryNode): Promise<void> {
  const now = 1_800_000_000;
  await a.store.upsertContact({
    pubkey: bytesToHex(b.keys.pubkey),
    displayName: b.name,
    relayHints: [],
    addedAt: now,
  });
  await a.store.setStamp(bytesToHex(b.keys.pubkey), 100);
  await b.store.upsertContact({
    pubkey: bytesToHex(a.keys.pubkey),
    displayName: a.name,
    relayHints: [],
    addedAt: now,
  });
  await b.store.setStamp(bytesToHex(a.keys.pubkey), 100);
}

describe('query engine — end-to-end match through a graph', () => {
  it('ask from A reaches F planted with matching interest; match reply comes back', async () => {
    const relay = new MockRelay();
    const embedder = new StubEmbedder();
    // Force max TTL so a 5-hop chain (A→B→C→D→E→F) always reaches F.
    const maxTtl = () => 0.99;
    const A = await makeNode(relay, embedder, 'A', maxTtl);
    const B = await makeNode(relay, embedder, 'B', maxTtl);
    const C = await makeNode(relay, embedder, 'C', maxTtl);
    const D = await makeNode(relay, embedder, 'D', maxTtl);
    const E = await makeNode(relay, embedder, 'E', maxTtl);
    const F = await makeNode(relay, embedder, 'F', maxTtl);

    // Topology: A - B - C - D - E - F (a line), each pair connected.
    await connect(A, B);
    await connect(B, C);
    await connect(C, D);
    await connect(D, E);
    await connect(E, F);

    // Plant matching interest at F. Text is chosen to score high under the
    // StubEmbedder's bag-of-words cosine (same tokens, no extra tokens that
    // would dilute the vector).
    await F.engine.declareInterest('koji fermentation');

    // A asks about koji.
    const { queryId } = await A.engine.ask('koji fermentation');
    expect(queryId).toBeTruthy();

    // Drain microtasks — MockRelay delivers synchronously via subscribe.
    await new Promise((r) => setTimeout(r, 50));

    // A should have received at least one match arrival.
    const matches = A.received.filter(
      (e): e is { type: string } => (e as { type: string }).type === 'match',
    );
    expect(matches.length).toBeGreaterThanOrEqual(1);
  });

  it('a stamp-zero neighbor forwards nothing', async () => {
    const relay = new MockRelay();
    const embedder = new StubEmbedder();
    const A = await makeNode(relay, embedder, 'A');
    const B = await makeNode(relay, embedder, 'B');
    const C = await makeNode(relay, embedder, 'C');
    await connect(A, B);
    await connect(B, C);
    // Bob's balance for A → 0 (Alice-authored queries cost).
    await B.store.setStamp(bytesToHex(A.keys.pubkey), 0);

    await C.engine.declareInterest('koji fermentation');
    await A.engine.ask('koji fermentation');
    await new Promise((r) => setTimeout(r, 100));

    // No match should come back — B refused to forward (stamp negative
    // after first debit).
    const matches = A.received.filter(
      (e): e is { type: string } => (e as { type: string }).type === 'match',
    );
    expect(matches.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Gate 1 — byte-shape identity of authored vs. forwarded 4910
// ---------------------------------------------------------------------------

describe('Gate 1 — authored 4910 and forwarded 4910 are byte-shape identical', () => {
  it('no field distinguishes author from forwarder', async () => {
    const relay = new MockRelay();
    const embedder = new StubEmbedder();
    const A = await makeNode(relay, embedder, 'A');
    const B = await makeNode(relay, embedder, 'B');
    const C = await makeNode(relay, embedder, 'C');
    await connect(A, B);
    await connect(B, C);

    await A.engine.ask('gate one shape test');
    await new Promise((r) => setTimeout(r, 50));

    // The MockRelay's log contains every 1059 that was published. Unwrap
    // to peek at inner 4910 shapes.
    // Import at test scope to avoid polluting core.
    const { unwrap } = await import('@weft/core');
    const wraps4910: NostrEvent[] = [];
    for (const evt of relay.log) {
      if (evt.kind !== 1059) continue;
      // Try unwrapping with A's or B's or C's secret to find the inner.
      for (const kp of [A.keys, B.keys, C.keys]) {
        const opened = unwrap(evt, kp.secret);
        if (opened && opened.inner.kind === 4910) {
          wraps4910.push(opened.inner);
          break;
        }
      }
    }
    expect(wraps4910.length).toBeGreaterThanOrEqual(2);

    // Every inner 4910 must have the same schema: kind, tags:[], content is
    // a JSON with exactly {embedding, ttl, ephemeralReplyPub, terms}.
    const schemaKeys = ['embedding', 'ttl', 'ephemeralReplyPub', 'terms'];
    for (const inner of wraps4910) {
      expect(inner.kind).toBe(4910);
      // The only tag allowed on an inner 4910 is `expiration` (auto-added
      // from the kind's D-class retention). No routing-relevant, no
      // origin-attributable tags may appear.
      const nonExpTags = inner.tags.filter((t: string[]) => t[0] !== 'expiration');
      expect(nonExpTags).toEqual([]);
      const body = JSON.parse(inner.content);
      expect(Object.keys(body).sort()).toEqual(schemaKeys.slice().sort());
      for (const banned of ['origin', 'from', 'author', 'signer', 'sender']) {
        expect(body[banned]).toBeUndefined();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Gate 4 — non-adjacent hops cannot correlate route tokens
// ---------------------------------------------------------------------------

describe('Gate 4 — reply paths cannot be correlated (route-token blinding)', () => {
  it('two non-adjacent nodes on the path share no identifier for the query', async () => {
    const relay = new MockRelay();
    const embedder = new StubEmbedder();
    const A = await makeNode(relay, embedder, 'A');
    const B = await makeNode(relay, embedder, 'B');
    const C = await makeNode(relay, embedder, 'C');
    const D = await makeNode(relay, embedder, 'D');
    await connect(A, B);
    await connect(B, C);
    await connect(C, D);

    // A asks; B and D are non-adjacent (B, C, D chain from A's ask).
    await A.engine.ask('gate four blinding test');
    await new Promise((r) => setTimeout(r, 50));

    // Collect every rt tag seen on outer wraps addressed to B and every rt
    // seen on outer wraps addressed to D.
    const rtsB = new Set<string>();
    const rtsD = new Set<string>();
    for (const evt of relay.log) {
      if (evt.kind !== 1059) continue;
      const pTag = evt.tags.find((t) => t[0] === 'p')?.[1];
      const rt = readRt(evt);
      if (!rt) continue;
      if (pTag === bytesToHex(B.keys.pubkey)) rtsB.add(rt);
      if (pTag === bytesToHex(D.keys.pubkey)) rtsD.add(rt);
    }

    // Intersection must be empty — no shared identifier across non-adjacent hops.
    const intersection = [...rtsB].filter((rt) => rtsD.has(rt));
    expect(intersection).toEqual([]);
  });
});
