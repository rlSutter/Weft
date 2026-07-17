import { describe, it } from 'vitest';
import {
  MemoryStore,
  QueryEngine,
  StubEmbedder,
  bytesToHex,
  generateKeypair,
  unwrapPairwise,
  readRt,
  type NostrEvent,
} from '@weft/core';
import { MockRelay } from '../mock-relay';

describe('diag', () => {
  it('traces the forward chain', async () => {
    const relay = new MockRelay();
    const embedder = new StubEmbedder();
    const A = generateKeypair();
    const B = generateKeypair();
    const C = generateKeypair();
    const stA = new MemoryStore();
    const stB = new MemoryStore();
    const stC = new MemoryStore();
    const engA = new QueryEngine({ me: A, store: stA, relay, embedder });
    const engB = new QueryEngine({ me: B, store: stB, relay, embedder });
    const engC = new QueryEngine({ me: C, store: stC, relay, embedder });
    engA.on((e) => process.stderr.write('A: ' + JSON.stringify(e) + '\n'));
    engB.on((e) => process.stderr.write('B: ' + JSON.stringify(e) + '\n'));
    engC.on((e) => process.stderr.write('C: ' + JSON.stringify(e) + '\n'));
    relay.subscribe({ kinds: [1059], p: [bytesToHex(A.pubkey)] }, (evt: NostrEvent) => {
      process.stderr.write(' ->A from ' + evt.pubkey.slice(0, 8) + '\n');
      void engA.handleIncomingWrap(evt);
    });
    relay.subscribe({ kinds: [1059], p: [bytesToHex(B.pubkey)] }, (evt: NostrEvent) => {
      process.stderr.write(' ->B from ' + evt.pubkey.slice(0, 8) + '\n');
      void engB.handleIncomingWrap(evt);
    });
    relay.subscribe({ kinds: [1059], p: [bytesToHex(C.pubkey)] }, (evt: NostrEvent) => {
      process.stderr.write(' ->C from ' + evt.pubkey.slice(0, 8) + '\n');
      void engC.handleIncomingWrap(evt);
    });
    await stA.upsertContact({ pubkey: bytesToHex(B.pubkey), displayName: 'B', relayHints: [], addedAt: 0 });
    await stA.setStamp(bytesToHex(B.pubkey), 100);
    await stB.upsertContact({ pubkey: bytesToHex(A.pubkey), displayName: 'A', relayHints: [], addedAt: 0 });
    await stB.upsertContact({ pubkey: bytesToHex(C.pubkey), displayName: 'C', relayHints: [], addedAt: 0 });
    await stB.setStamp(bytesToHex(A.pubkey), 100);
    await stB.setStamp(bytesToHex(C.pubkey), 100);
    await stC.upsertContact({ pubkey: bytesToHex(B.pubkey), displayName: 'B', relayHints: [], addedAt: 0 });
    await stC.setStamp(bytesToHex(B.pubkey), 100);

    process.stderr.write('=== asking ===\n');
    await engA.ask('koji fermentation');
    await new Promise((r) => setTimeout(r, 200));
    process.stderr.write('=== relay log ===\n');
    for (const evt of relay.log) {
      if (evt.kind !== 1059) continue;
      const p = evt.tags.find((t) => t[0] === 'p')?.[1]?.slice(0, 8);
      const rt = readRt(evt);
      process.stderr.write(
        `  1059 by=${evt.pubkey.slice(0, 8)} to=${p} rt=${rt?.slice(0, 8)}\n`,
      );
      for (const kp of [A, B, C]) {
        const o = unwrapPairwise(evt, kp.secret);
        if (o) {
          process.stderr.write(`    inner kind=${o.inner.kind}\n`);
          break;
        }
      }
    }
  });
});
