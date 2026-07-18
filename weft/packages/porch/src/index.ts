// Porch node — DD §28.5. A headless always-on Weft engine that carries
// forwarding while phone clients sleep. Architecturally still an edge
// node with its own vouched keypair (DD §35 F10).
//
// Usage:
//   pnpm --filter @weft/porch start /path/to/config.json
//
// Config schema (JSON):
//   {
//     "secretHex":  "<64 hex chars, this porch's own vouched key>",
//     "displayName": "Sam's home box",
//     "relayUrls":  ["wss://relay-one.example", "wss://relay-two.example"],
//     "declaredInterests": ["koji fermentation", "trail running"]
//   }
//
// The porch node uses the same engines as the PWA; the only difference is
// the relay transport (SimplePool in Node vs. SimplePool in the browser).

import { readFileSync } from 'node:fs';
import { WebSocket } from 'ws';

// nostr-tools uses browser globals for WebSocket; injection here makes it
// work in Node without an extra polyfill dep.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(globalThis as any).WebSocket = WebSocket;

import { SimplePool } from 'nostr-tools/pool';
import {
  HealthLog,
  HandshakeEngine,
  InviteEngine,
  MemoryStore,
  QueryEngine,
  StubEmbedder,
  bytesToHex,
  hexToBytes,
  publicKeyFromSecret,
  type EventCallback,
  type NostrEvent,
  type Relay,
  type RelayFilter,
  type Subscription,
} from '@weft/core';

interface Config {
  secretHex: string;
  displayName: string;
  relayUrls: string[];
  declaredInterests?: string[];
}

class SimplePoolRelay implements Relay {
  private readonly pool = new SimplePool();
  constructor(private readonly urls: string[]) {}

  async publish(evt: NostrEvent, urls?: readonly string[]): Promise<void> {
    const target = [...(urls ?? this.urls)];
    await Promise.any(this.pool.publish(target, evt));
  }

  subscribe(filter: RelayFilter, onEvent: EventCallback): Subscription {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nostrFilter: any = {};
    if (filter.kinds) nostrFilter.kinds = [...filter.kinds];
    if (filter.p) nostrFilter['#p'] = [...filter.p];
    if (filter.ids) nostrFilter.ids = [...filter.ids];
    if (filter.since !== undefined) nostrFilter.since = filter.since;
    // nostr-tools 2.23's subscribeMany takes a single Filter object (not an
    // array). Passing an array silently degrades to a malformed REQ that
    // some relays (e.g. relay.primal.net) reject and others quietly drop —
    // caught by weft/packages/porch/scripts/e2e-public-relay.mts.
    const sub = (this.pool as { subscribeMany: (urls: string[], filter: unknown, opts: { onevent: (e: NostrEvent) => void }) => { close(): void } }).subscribeMany(
      this.urls,
      nostrFilter,
      { onevent: (evt: NostrEvent) => onEvent(evt) },
    );
    return {
      close: () => sub.close(),
    };
  }
}

async function main(): Promise<void> {
  const [, , configPath] = process.argv;
  if (!configPath) {
    console.error('usage: weft-porch <config.json>');
    process.exit(2);
  }
  const cfg: Config = JSON.parse(readFileSync(configPath, 'utf8'));
  if (!/^[0-9a-f]{64}$/i.test(cfg.secretHex)) {
    console.error('config.secretHex must be 32-byte hex');
    process.exit(2);
  }

  const secret = hexToBytes(cfg.secretHex);
  const pubkey = publicKeyFromSecret(secret);
  const me = { secret, pubkey };
  const pubkeyHex = bytesToHex(pubkey);

  console.error(`porch node up: ${cfg.displayName} (${pubkeyHex.slice(0, 8)}…)`);
  console.error(`relays: ${cfg.relayUrls.join(', ')}`);

  const store = new MemoryStore({ userPubkey: pubkeyHex });
  const relay = new SimplePoolRelay(cfg.relayUrls);
  const embedder = new StubEmbedder();
  const health = new HealthLog();

  const inviteEng = new InviteEngine(store, relay, me, cfg.relayUrls);
  const queryEng = new QueryEngine({ me, store, relay, embedder, relaysToPublish: cfg.relayUrls });
  const handshakeEng = new HandshakeEngine({
    me,
    displayName: cfg.displayName,
    store,
    relay,
    relaysToPublish: cfg.relayUrls,
  });

  for (const text of cfg.declaredInterests ?? []) {
    await queryEng.declareInterest(text);
  }

  // Single subscription for all 1059 wraps addressed to us. Dispatch by
  // inner kind after unwrap in each engine.
  relay.subscribe({ kinds: [1059], p: [pubkeyHex] }, (evt: NostrEvent) => {
    void inviteEng.handleIncomingWrap(evt);
    void queryEng.handleIncomingWrap(evt);
    void handshakeEng.handleIncomingWrap(evt);
  });

  queryEng.on((e: unknown) => {
    const t = (e as { type: string }).type;
    if (t === 'match') health.askMatched();
    if (t === 'droppedForward') health.deadQuery();
  });
  handshakeEng.on((e: unknown) => {
    const t = (e as { type: string }).type;
    if (t === 'channelOpen') health.handshakeCompleted();
  });

  // Print counters every minute.
  setInterval(() => {
    const s = health.snapshot();
    console.error(
      `[${new Date().toISOString()}] asksSent=${s.asksSent} asksMatched=${s.asksMatched} handshakesCompleted=${s.handshakesCompleted} forwardsRelayed=${s.forwardsRelayed} deadQueries=${s.deadQueries}`,
    );
  }, 60_000);

  // Periodically sweep expired handshakes.
  setInterval(() => {
    handshakeEng.sweep(Math.floor(Date.now() / 1000));
    void store.expireSweep(Math.floor(Date.now() / 1000));
  }, 30_000);
}

main().catch((err) => {
  console.error('porch fatal:', err);
  process.exit(1);
});
