import { describe, it, expect } from 'vitest';
import {
  KINDS,
  RETENTION_SECONDS,
  TERMS_PREDICATES,
  isKnownPredicate,
  kindByName,
  kindByNumber,
  type KindDef,
} from '../registry';
import { Tags, KNOWN_TAGS, isKnownTag, type TagName } from '../tags';
import {
  RANDOMIZED_CREATED_AT_WINDOW_SECONDS,
  randomizedCreatedAt,
} from '../timestamp';

// ---------------------------------------------------------------------------
// Retention class assertions — build-list M0-T2 acceptance
// ---------------------------------------------------------------------------

describe('kind registry — retention classes', () => {
  it('kind 4910 (Query) is class D', () => {
    const k = kindByNumber(4910);
    expect(k).toBeDefined();
    expect(k!.retentionClass).toBe('D');
    expect(k!.expirationSeconds).toBe(5 * 24 * 60 * 60);
  });

  it('kinds 4913–4916 (handshake state) are class E', () => {
    for (const n of [4913, 4914, 4915, 4916]) {
      const k = kindByNumber(n);
      expect(k, `kind ${n}`).toBeDefined();
      expect(k!.retentionClass, `kind ${n}`).toBe('E');
      expect(k!.expirationSeconds, `kind ${n}`).toBe(6 * 60 * 60);
    }
  });

  it('kind 4900 (Charter) is class P', () => {
    const k = kindByNumber(4900);
    expect(k).toBeDefined();
    expect(k!.retentionClass).toBe('P');
    expect(k!.expirationSeconds).toBeNull();
  });

  it('every kind carries expirationSeconds derived from its retention class', () => {
    for (const k of KINDS) {
      if (k.retentionClass === null) {
        // registry-only reservation (e.g. 4927)
        expect(k.expirationSeconds).toBeNull();
      } else {
        expect(k.expirationSeconds).toBe(RETENTION_SECONDS[k.retentionClass]);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Privacy / v2 / registry-only flags — build-list M0-T2 + DD §35
// ---------------------------------------------------------------------------

describe('kind registry — privacy and scope flags', () => {
  it('kind 4902 (Vouch) is privateOnly (DD §35 F1)', () => {
    const k = kindByNumber(4902);
    expect(k).toBeDefined();
    expect(k!.privateOnly).toBe(true);
  });

  it('kind 4911 (GroupInterestDeclaration) is v2Only', () => {
    const k = kindByNumber(4911);
    expect(k).toBeDefined();
    expect(k!.v2Only).toBe(true);
  });

  it('kind 4927 (TermsVocabulary) is registryOnly and not an event', () => {
    const k = kindByNumber(4927);
    expect(k).toBeDefined();
    expect(k!.registryOnly).toBe(true);
    expect(k!.retentionClass).toBeNull();
    expect(k!.expirationSeconds).toBeNull();
  });

  it('exactly one privateOnly kind in v0 (4902 vouch)', () => {
    const privates = KINDS.filter((k) => k.privateOnly);
    expect(privates.map((k) => k.number)).toEqual([4902]);
  });

  it('v2Only kinds cover the deferred-behavior set from build-list §13', () => {
    const v2Numbers = KINDS.filter((k) => k.v2Only).map((k) => k.number);
    // Group behavior (4911, 4920, 4921, 4922, 4904), tombstone (4923), escrow (4924),
    // beacon (4905), relay ops (4906), model registry (4907), and the v2 credential/
    // group kinds (4930–4933).
    expect(new Set(v2Numbers)).toEqual(
      new Set([4904, 4905, 4906, 4907, 4911, 4920, 4921, 4922, 4923, 4924, 4930, 4931, 4932, 4933]),
    );
  });
});

// ---------------------------------------------------------------------------
// Structural invariants
// ---------------------------------------------------------------------------

describe('kind registry — structural invariants', () => {
  it('no duplicate kind numbers', () => {
    const numbers = KINDS.map((k) => k.number);
    const unique = new Set(numbers);
    expect(unique.size).toBe(numbers.length);
  });

  it('no duplicate kind names', () => {
    const names = KINDS.map((k) => k.name);
    const unique = new Set(names);
    expect(unique.size).toBe(names.length);
  });

  it('kindByNumber and kindByName agree', () => {
    for (const k of KINDS) {
      expect(kindByNumber(k.number)).toBe(k);
      expect(kindByName(k.name)).toBe(k);
    }
  });

  it('kindByNumber returns undefined for unregistered numbers', () => {
    // Kinds 4908, 4925, 4926 aren't in v0 yet (4926 is media, DD §34 v2).
    expect(kindByNumber(4908)).toBeUndefined();
    expect(kindByNumber(4925)).toBeUndefined();
    expect(kindByNumber(9999)).toBeUndefined();
  });

  it('gift wrap (1059) is registered so retention lookups are total', () => {
    const wrap = kindByNumber(1059);
    expect(wrap).toBeDefined();
    expect(wrap!.name).toBe('GiftWrap');
  });

  it('every KindDef cites at least one DD section under implements', () => {
    for (const k of KINDS) {
      expect(k.implements, `kind ${k.number}`).toMatch(/DD §|NIP-/);
    }
  });

  it('KINDS is frozen (immutability against accidental mutation)', () => {
    expect(Object.isFrozen(KINDS)).toBe(true);
    expect(() => {
      (KINDS as unknown as KindDef[]).push({} as KindDef);
    }).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Tag vocabulary — DD §33.4
// ---------------------------------------------------------------------------

describe('normative tag vocabulary — DD §33.4', () => {
  it('contains grp (F9) and rt (F2)', () => {
    expect(Tags.GRP).toBe('grp');
    expect(Tags.RT).toBe('rt');
    expect(KNOWN_TAGS.has('grp')).toBe(true);
    expect(KNOWN_TAGS.has('rt')).toBe(true);
  });

  it('contains the full DD §33.4 set and only that set', () => {
    const expected: readonly TagName[] = [
      'p',
      'e',
      'prev',
      'expiration',
      'tier',
      'ctx',
      'h',
      'grp',
      'ver',
      'mdl',
      'rt',
    ];
    expect(new Set(KNOWN_TAGS)).toEqual(new Set(expected));
  });

  it('isKnownTag rejects unknown tag names', () => {
    expect(isKnownTag('p')).toBe(true);
    expect(isKnownTag('grp')).toBe(true);
    // Not in the vocabulary — clients ignore these (forward compat), but the
    // predicate says so honestly.
    expect(isKnownTag('nip05')).toBe(false);
    expect(isKnownTag('')).toBe(false);
    expect(isKnownTag('P')).toBe(false); // case-sensitive
  });
});

// ---------------------------------------------------------------------------
// Terms predicates — DD §33.3 kind 4927, F11
// ---------------------------------------------------------------------------

describe('terms predicates — DD §33.3 kind 4927 (F11)', () => {
  it('exposes the initial predicate set', () => {
    expect(TERMS_PREDICATES).toContain('reveal.name');
    expect(TERMS_PREDICATES).toContain('reveal.vouches');
    expect(TERMS_PREDICATES).toContain('reveal.city');
    expect(TERMS_PREDICATES).toContain('reveal.after=1msg');
    expect(TERMS_PREDICATES).toContain('stay.pseudonymous.until=sponsor');
  });

  it('isKnownPredicate rejects free text', () => {
    expect(isKnownPredicate('reveal.name')).toBe(true);
    // Free-text terms would be a consent bug across languages (DD §35 F11).
    // Anything unknown must be rejected, not guessed.
    expect(isKnownPredicate('reveal my name please')).toBe(false);
    expect(isKnownPredicate('')).toBe(false);
  });

  it('predicate list is frozen', () => {
    expect(Object.isFrozen(TERMS_PREDICATES)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Randomized created_at — DD §35 F3
// ---------------------------------------------------------------------------

describe('randomizedCreatedAt — DD §35 F3', () => {
  const NOW = 1_800_000_000; // arbitrary fixed test epoch

  it('returns a time within the past 48 hours', () => {
    const rng = mulberry32(0xDEADBEEF);
    for (let i = 0; i < 1000; i++) {
      const t = randomizedCreatedAt(NOW, rng);
      expect(t).toBeGreaterThanOrEqual(NOW - RANDOMIZED_CREATED_AT_WINDOW_SECONDS);
      expect(t).toBeLessThan(NOW); // strictly less — never equals send time
    }
  });

  it('never equals the true send-second, even when rng returns 0', () => {
    const alwaysZero = () => 0;
    // Even the smallest possible offset (1 sec) means t < now.
    expect(randomizedCreatedAt(NOW, alwaysZero)).toBe(NOW - 1);
  });

  it('reaches the far edge of the window when rng returns near 1', () => {
    const nearOne = () => 0.9999999;
    const t = randomizedCreatedAt(NOW, nearOne);
    // With rng = 0.9999999, offset ≈ WINDOW_SECONDS.
    expect(t).toBeLessThanOrEqual(NOW - RANDOMIZED_CREATED_AT_WINDOW_SECONDS + 1);
    expect(t).toBeGreaterThanOrEqual(NOW - RANDOMIZED_CREATED_AT_WINDOW_SECONDS);
  });

  it('produces a broad distribution across the window (statistical smoke test)', () => {
    const rng = mulberry32(42);
    const buckets = new Array<number>(48).fill(0); // one bucket per hour
    for (let i = 0; i < 4800; i++) {
      const t = randomizedCreatedAt(NOW, rng);
      const hoursAgo = Math.floor((NOW - t) / 3600);
      // hoursAgo is in [0, 47] (offset in [1, 48h] → t in [NOW-48h, NOW-1]).
      if (hoursAgo >= 0 && hoursAgo < 48) buckets[hoursAgo]++;
    }
    // Every hour-bucket should get at least a few samples with 4800 draws.
    for (let h = 0; h < 48; h++) {
      expect(buckets[h], `hour bucket ${h} was empty`).toBeGreaterThan(20);
    }
  });
});

// Deterministic PRNG for reproducible statistical tests. Not for production use.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
