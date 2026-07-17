import { describe, it, expect } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';

import { generateKeypair } from '../../keys/keys';
import { buildAndSign, verifyEvent } from '../../codec/event';
import { sealTextTo, openTextFrom, sealTo, openFrom } from '../nip44';
import { unwrap, wrap, wrapToMany } from '../gift';

// ---------------------------------------------------------------------------
// NIP-44 seal roundtrip — M2-T1
// ---------------------------------------------------------------------------

describe('NIP-44 pairwise seal', () => {
  it('sealTextTo → openTextFrom roundtrips', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const payload = sealTextTo(bytesToHex(bob.pubkey), 'hello bob', alice.secret);
    const opened = openTextFrom(bytesToHex(alice.pubkey), payload, bob.secret);
    expect(opened).toBe('hello bob');
  });

  it('sealTo → openFrom roundtrips arbitrary bytes', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const original = new TextEncoder().encode('binary-ish payload');
    const payload = sealTo(bytesToHex(bob.pubkey), original, alice.secret);
    const opened = openFrom(bytesToHex(alice.pubkey), payload, bob.secret);
    expect(new TextDecoder().decode(opened)).toBe('binary-ish payload');
  });

  it('a tampered payload fails to decrypt', () => {
    const alice = generateKeypair();
    const bob = generateKeypair();
    const payload = sealTextTo(bytesToHex(bob.pubkey), 'hello', alice.secret);
    const tampered = payload.slice(0, -4) + 'AAAA';
    expect(() => openTextFrom(bytesToHex(alice.pubkey), tampered, bob.secret)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Gift wrap — M2-T2 acceptance
// ---------------------------------------------------------------------------

describe('gift wrap', () => {
  it('wrap → unwrap roundtrip for a 4913 (E class, handshake)', () => {
    const author = generateKeypair();
    const recipient = generateKeypair();
    const inner = buildAndSign({ kind: 4913, content: 'intent-ping' }, author.secret);

    const outer = wrap(inner, bytesToHex(recipient.pubkey));
    expect(outer.kind).toBe(1059);
    // outer's ephemeral pubkey MUST differ from sender's real pubkey (acceptance).
    expect(outer.pubkey).not.toBe(inner.pubkey);
    expect(verifyEvent(outer)).toBe(true);

    const unwrapped = unwrap(outer, recipient.secret);
    expect(unwrapped).not.toBeNull();
    expect(unwrapped!.inner.id).toBe(inner.id);
    expect(unwrapped!.inner.pubkey).toBe(inner.pubkey);
  });

  it('wrap → unwrap roundtrip for a 4910 (D class, query)', () => {
    const author = generateKeypair();
    const recipient = generateKeypair();
    const inner = buildAndSign({ kind: 4910, content: 'query-body' }, author.secret);

    const outer = wrap(inner, bytesToHex(recipient.pubkey));
    const opened = unwrap(outer, recipient.secret);
    expect(opened).not.toBeNull();
    expect(opened!.inner.kind).toBe(4910);
  });

  it('two wraps of the same inner produce different outer bytes', () => {
    const author = generateKeypair();
    const recipient = generateKeypair();
    const inner = buildAndSign({ kind: 4913, content: 'same' }, author.secret);

    const a = wrap(inner, bytesToHex(recipient.pubkey));
    const b = wrap(inner, bytesToHex(recipient.pubkey));
    // Different ephemeral keys → different outer.pubkey and different content.
    expect(a.pubkey).not.toBe(b.pubkey);
    expect(a.id).not.toBe(b.id);
    expect(a.content).not.toBe(b.content);
  });

  it('unwrap rejects an inner event with a bad signature', () => {
    const author = generateKeypair();
    const recipient = generateKeypair();
    const inner = buildAndSign({ kind: 4913, content: 'original' }, author.secret);

    // Tamper the inner event WITHOUT re-signing.
    const tamperedInner = {
      id: inner.id,
      pubkey: inner.pubkey,
      created_at: inner.created_at,
      kind: inner.kind,
      tags: inner.tags,
      content: 'tampered',
      sig: inner.sig,
    };

    // Now wrap the tampered inner using the wrap()-equivalent process
    // (we must call sealTextTo directly since wrap() expects verified inner).
    // Build the outer manually: use a fresh ephemeral, seal the tampered JSON,
    // finalize the outer, then attempt to unwrap.
    const eph = generateKeypair();
    const payload = sealTextTo(
      bytesToHex(recipient.pubkey),
      JSON.stringify(tamperedInner),
      eph.secret,
    );
    // Import finalizeEvent locally to build the outer.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { finalizeEvent } = require('nostr-tools/pure') as {
      finalizeEvent: typeof import('nostr-tools/pure').finalizeEvent;
    };
    const outer = finalizeEvent(
      {
        kind: 1059,
        created_at: Math.floor(Date.now() / 1000) - 100,
        tags: [
          ['p', bytesToHex(recipient.pubkey)],
          ['expiration', String(Math.floor(Date.now() / 1000) + 3600)],
        ],
        content: payload,
      },
      eph.secret,
    );

    const result = unwrap(outer, recipient.secret);
    expect(result).toBeNull();
  });

  it('wrapper carries a p-tag with the recipient', () => {
    const author = generateKeypair();
    const recipient = generateKeypair();
    const inner = buildAndSign({ kind: 4913, content: 'x' }, author.secret);
    const outer = wrap(inner, bytesToHex(recipient.pubkey));
    const pTag = outer.tags.find((t) => t[0] === 'p');
    expect(pTag?.[1]).toBe(bytesToHex(recipient.pubkey));
  });

  it('wrapper carries expiration derived from inner kind retention', () => {
    const author = generateKeypair();
    const recipient = generateKeypair();
    const inner = buildAndSign({ kind: 4913, content: 'x' }, author.secret);
    const now = 1_800_000_000;
    const outer = wrap(inner, bytesToHex(recipient.pubkey), now);
    const expTag = outer.tags.find((t) => t[0] === 'expiration');
    expect(expTag).toBeDefined();
    // Kind 4913 is E-class = 6 hours.
    expect(Number(expTag![1])).toBe(now + 6 * 60 * 60);
  });

  it('wrapper created_at is randomized (DD §35 F3)', () => {
    const author = generateKeypair();
    const recipient = generateKeypair();
    const inner = buildAndSign({ kind: 4913, content: 'x' }, author.secret);
    const now = 1_800_000_000;
    const outer = wrap(inner, bytesToHex(recipient.pubkey), now);
    // created_at is in [now - 48h, now - 1]
    expect(outer.created_at).toBeLessThan(now);
    expect(outer.created_at).toBeGreaterThanOrEqual(now - 48 * 60 * 60);
  });

  it('unwrap returns null for non-1059 outer', () => {
    const kp = generateKeypair();
    const notAWrap = buildAndSign({ kind: 1, content: 'a plain note' }, kp.secret);
    expect(unwrap(notAWrap, kp.secret)).toBeNull();
  });

  it('unwrap returns null for wrong recipient', () => {
    const author = generateKeypair();
    const bob = generateKeypair();
    const eve = generateKeypair();
    const inner = buildAndSign({ kind: 4913 }, author.secret);
    const outer = wrap(inner, bytesToHex(bob.pubkey));
    expect(unwrap(outer, eve.secret)).toBeNull();
  });

  it('wrapToMany produces per-recipient distinct wraps', () => {
    const author = generateKeypair();
    const bob = generateKeypair();
    const alice = generateKeypair();
    const inner = buildAndSign({ kind: 4910 }, author.secret);
    const wraps = wrapToMany(inner, [bytesToHex(bob.pubkey), bytesToHex(alice.pubkey)]);
    expect(wraps).toHaveLength(2);
    expect(wraps[0].id).not.toBe(wraps[1].id);
    expect(unwrap(wraps[0], bob.secret)?.inner.id).toBe(inner.id);
    expect(unwrap(wraps[1], alice.secret)?.inner.id).toBe(inner.id);
  });
});
