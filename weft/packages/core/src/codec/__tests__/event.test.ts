import { describe, it, expect } from 'vitest';
import { verifyEvent as nostrVerifyEvent } from 'nostr-tools/pure';
import { generateKeypair } from '../../keys/keys';
import {
  buildEvent,
  buildAndSign,
  getExpiration,
  hashEvent,
  signEvent,
  verifyEvent,
} from '../event';
import { kindByNumber } from '../../kinds/registry';

// ---------------------------------------------------------------------------
// nostr-tools interop — build-list M1-T2 acceptance
// ---------------------------------------------------------------------------

describe('event codec — nostr-tools interop', () => {
  it('an event built here validates with nostr-tools verifyEvent', () => {
    const kp = generateKeypair();
    // Kind 1 = generic note; not in our registry, so no auto-expiration.
    const evt = buildAndSign({ kind: 1, content: 'hello weft' }, kp.secret);
    expect(nostrVerifyEvent(evt)).toBe(true);
    // Our own verifyEvent should agree.
    expect(verifyEvent(evt)).toBe(true);
  });

  it('a tampered event fails verification', () => {
    const kp = generateKeypair();
    const evt = buildAndSign({ kind: 1, content: 'original' }, kp.secret);
    // Construct the tampered event explicitly, without spread — nostr-tools
    // caches verification on an event via a Symbol key, and spread copies
    // Symbol properties. In the wild that's not an issue (cross-process
    // events arrive as JSON with no Symbols), but tests need to be careful.
    const tampered = {
      id: evt.id,
      pubkey: evt.pubkey,
      created_at: evt.created_at,
      kind: evt.kind,
      tags: evt.tags,
      content: 'not original',
      sig: evt.sig,
    };
    expect(verifyEvent(tampered)).toBe(false);
  });

  it('id matches sha256 canonical form (via nostr-tools getEventHash)', () => {
    const kp = generateKeypair();
    const evt = buildAndSign({ kind: 1, content: 'canonical' }, kp.secret);
    const recomputed = hashEvent({
      kind: evt.kind,
      created_at: evt.created_at,
      tags: evt.tags,
      content: evt.content,
      pubkey: evt.pubkey,
    });
    expect(recomputed).toBe(evt.id);
  });
});

// ---------------------------------------------------------------------------
// Auto-expiration from kind registry — build-list M1-T2 acceptance
// ("a kind-4913 event automatically carries an expiration ≈ now+6h")
// ---------------------------------------------------------------------------

describe('event codec — expiration derived from kind registry', () => {
  it('kind 4913 (E, 6h) auto-adds an expiration tag ≈ now+6h', () => {
    const kp = generateKeypair();
    const now = Math.floor(Date.now() / 1000);
    const evt = buildAndSign({ kind: 4913, created_at: now }, kp.secret);
    const exp = getExpiration(evt);
    expect(exp).not.toBeNull();
    expect(exp!).toBe(now + 6 * 60 * 60);
    // Sanity: the kind registry itself agrees.
    expect(kindByNumber(4913)!.expirationSeconds).toBe(6 * 60 * 60);
  });

  it('kind 4910 (D, 5d) auto-adds expiration ≈ now+5d', () => {
    const kp = generateKeypair();
    const now = 1_800_000_000;
    const evt = buildAndSign({ kind: 4910, created_at: now }, kp.secret);
    expect(getExpiration(evt)).toBe(now + 5 * 24 * 60 * 60);
  });

  it('kind 4900 (Charter, P) has NO expiration tag', () => {
    const kp = generateKeypair();
    const evt = buildAndSign({ kind: 4900, content: 'charter body' }, kp.secret);
    expect(getExpiration(evt)).toBeNull();
    expect(evt.tags.some((t) => t[0] === 'expiration')).toBe(false);
  });

  it('kind 1 (unregistered) has no expiration tag', () => {
    const kp = generateKeypair();
    const evt = buildAndSign({ kind: 1, content: 'note' }, kp.secret);
    expect(getExpiration(evt)).toBeNull();
  });

  it('caller-supplied expiration tag is preserved (not overwritten)', () => {
    const kp = generateKeypair();
    const now = 1_800_000_000;
    const explicitExp = now + 60; // shorter than the class default
    const evt = buildAndSign(
      { kind: 4913, created_at: now, tags: [['expiration', String(explicitExp)]] },
      kp.secret,
    );
    expect(getExpiration(evt)).toBe(explicitExp);
    // Only one expiration tag, not two.
    expect(evt.tags.filter((t) => t[0] === 'expiration').length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// v0 emission guards — registryOnly and v2Only kinds cannot be built
// ---------------------------------------------------------------------------

describe('event codec — v0 emission guards', () => {
  it('refuses to build a registryOnly kind (4927)', () => {
    expect(() => buildEvent({ kind: 4927 })).toThrow(/registryOnly/);
  });

  it('refuses to build a v2Only kind (4911 group-interest declaration)', () => {
    expect(() => buildEvent({ kind: 4911 })).toThrow(/v2Only/);
  });

  it('refuses to build v2 credentials (4930)', () => {
    expect(() => buildEvent({ kind: 4930 })).toThrow(/v2Only/);
  });
});

// ---------------------------------------------------------------------------
// signEvent + buildEvent separation
// ---------------------------------------------------------------------------

describe('event codec — signEvent + buildEvent as separate steps', () => {
  it('same result as buildAndSign', () => {
    const kp = generateKeypair();
    const now = 1_800_000_000;
    const template = buildEvent({ kind: 4913, content: 'ping', created_at: now });
    const signed = signEvent(template, kp.secret);
    expect(verifyEvent(signed)).toBe(true);
    // Compare against buildAndSign with the same inputs.
    const combined = buildAndSign(
      { kind: 4913, content: 'ping', created_at: now },
      kp.secret,
    );
    // ids differ only if the tag order or content differs; they should match.
    expect(signed.id).toBe(combined.id);
    expect(signed.pubkey).toBe(combined.pubkey);
  });

  it('preserves caller-provided tags in order', () => {
    const kp = generateKeypair();
    const evt = buildAndSign(
      {
        kind: 4913,
        tags: [
          ['p', 'a'.repeat(64)],
          ['e', 'b'.repeat(64)],
        ],
      },
      kp.secret,
    );
    expect(evt.tags[0]).toEqual(['p', 'a'.repeat(64)]);
    expect(evt.tags[1]).toEqual(['e', 'b'.repeat(64)]);
    // expiration appended after caller tags.
    expect(evt.tags[2][0]).toBe('expiration');
  });
});
