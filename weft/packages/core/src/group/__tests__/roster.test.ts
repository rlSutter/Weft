import { describe, it, expect } from 'vitest';
import { randomBytes } from '@noble/hashes/utils';
import {
  emptyRoster,
  addMember,
  ejectMember,
  isMember,
  isEjected,
  activeSize,
  serializeRoster,
  deserializeRoster,
  encryptRoster,
  decryptRoster,
} from '../roster';
import { generateGroupKey, sealWithGroupKey, openWithGroupKey } from '../group-crypto';

const nym = (fill = 0): Uint8Array => new Uint8Array(32).fill(fill);

describe('roster / basic membership operations', () => {
  it('starts empty', () => {
    const r = emptyRoster();
    expect(activeSize(r)).toBe(0);
    expect(isMember(r, nym(1))).toBe(false);
    expect(isEjected(r, nym(1))).toBe(false);
  });

  it('adds a member and tracks it in active', () => {
    const r0 = emptyRoster();
    const r1 = addMember(r0, nym(0xa));
    expect(activeSize(r1)).toBe(1);
    expect(isMember(r1, nym(0xa))).toBe(true);
    // Original is unmutated (immutable operation).
    expect(activeSize(r0)).toBe(0);
  });

  it('rejects a scope_nym that is already active', () => {
    const r = addMember(emptyRoster(), nym(0xa));
    expect(() => addMember(r, nym(0xa))).toThrow(/already active/);
  });

  it('ejects an active member into the ejected set', () => {
    const r0 = addMember(emptyRoster(), nym(0xb));
    const r1 = ejectMember(r0, nym(0xb));
    expect(isMember(r1, nym(0xb))).toBe(false);
    expect(isEjected(r1, nym(0xb))).toBe(true);
    expect(activeSize(r1)).toBe(0);
  });

  it('rejects re-adding an ejected scope_nym (this is the ejection-sticks property)', () => {
    let r = addMember(emptyRoster(), nym(0xc));
    r = ejectMember(r, nym(0xc));
    expect(() => addMember(r, nym(0xc))).toThrow(/previously ejected/);
  });

  it('rejects ejecting a scope_nym that was never a member', () => {
    const r = emptyRoster();
    expect(() => ejectMember(r, nym(0xd))).toThrow(/not active/);
  });
});

describe('roster / serialization roundtrip', () => {
  it('serialize → deserialize preserves active + ejected sets', () => {
    let r = emptyRoster();
    r = addMember(r, nym(1));
    r = addMember(r, nym(2));
    r = addMember(r, nym(3));
    r = ejectMember(r, nym(2));
    const bytes = serializeRoster(r);
    const restored = deserializeRoster(bytes);
    expect(restored).not.toBeNull();
    expect(isMember(restored!, nym(1))).toBe(true);
    expect(isMember(restored!, nym(3))).toBe(true);
    expect(isEjected(restored!, nym(2))).toBe(true);
    expect(activeSize(restored!)).toBe(2);
  });

  it('serialization is deterministic across insertion orders', () => {
    let a = emptyRoster();
    a = addMember(a, nym(3));
    a = addMember(a, nym(1));
    a = addMember(a, nym(2));

    let b = emptyRoster();
    b = addMember(b, nym(1));
    b = addMember(b, nym(2));
    b = addMember(b, nym(3));

    expect(Array.from(serializeRoster(a))).toEqual(Array.from(serializeRoster(b)));
  });

  it('deserializeRoster returns null on malformed input', () => {
    expect(deserializeRoster(new TextEncoder().encode('not json'))).toBeNull();
    expect(deserializeRoster(new TextEncoder().encode(JSON.stringify({ v: 999, active: [], ejected: [] })))).toBeNull();
  });
});

describe('roster / group-key encryption', () => {
  it('encrypt → decrypt roundtrip', () => {
    const groupKey = generateGroupKey();
    let r = emptyRoster();
    r = addMember(r, nym(0x11));
    r = addMember(r, nym(0x22));
    const envelope = encryptRoster(r, groupKey);
    const restored = decryptRoster(envelope, groupKey);
    expect(restored).not.toBeNull();
    expect(activeSize(restored!)).toBe(2);
  });

  it('wrong group key returns null', () => {
    const goodKey = generateGroupKey();
    const badKey = generateGroupKey();
    const r = addMember(emptyRoster(), nym(0x33));
    const envelope = encryptRoster(r, goodKey);
    expect(decryptRoster(envelope, badKey)).toBeNull();
  });

  it('tampered envelope returns null', () => {
    const groupKey = generateGroupKey();
    const r = addMember(emptyRoster(), nym(0x44));
    const envelope = encryptRoster(r, groupKey);
    const tampered = new Uint8Array(envelope);
    tampered[tampered.length - 1] ^= 0x01;
    expect(decryptRoster(tampered, groupKey)).toBeNull();
  });

  it('two encryptions of the same roster produce different envelopes (fresh nonce)', () => {
    const groupKey = generateGroupKey();
    const r = addMember(emptyRoster(), nym(0x55));
    const e1 = encryptRoster(r, groupKey);
    const e2 = encryptRoster(r, groupKey);
    expect(Array.from(e1)).not.toEqual(Array.from(e2));
  });
});

describe('group-crypto / sealWithGroupKey / openWithGroupKey', () => {
  it('roundtrips arbitrary bytes', () => {
    const key = generateGroupKey();
    const pt = randomBytes(200);
    const env = sealWithGroupKey(key, pt);
    const out = openWithGroupKey(key, env);
    expect(out).not.toBeNull();
    expect(Array.from(out!)).toEqual(Array.from(pt));
  });

  it('rejects wrong-length group keys', () => {
    expect(() => sealWithGroupKey(new Uint8Array(31), new Uint8Array(10))).toThrow(/must be exactly 32/);
  });
});
