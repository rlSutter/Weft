import { describe, it, expect } from 'vitest';
import { StubEmbedder, cosine, EMBEDDING_DIM } from '../embedder';

describe('StubEmbedder — build-list M5-T1 acceptance', () => {
  const e = new StubEmbedder();

  it('produces a 384-dim vector', async () => {
    expect((await e.embed('koji fermentation')).length).toBe(EMBEDDING_DIM);
  });

  it('is deterministic (same input → same vector)', async () => {
    const a = await e.embed('koji fermentation');
    const b = await e.embed('koji fermentation');
    expect(a).toEqual(b);
  });

  it('similar texts overlap: cosine > 0.8', async () => {
    const a = await e.embed('koji fermentation');
    const b = await e.embed('fermentation with koji');
    expect(cosine(a, b)).toBeGreaterThan(0.8);
  });

  it('different texts diverge: cosine < 0.3', async () => {
    const a = await e.embed('koji fermentation');
    const b = await e.embed('mountain biking');
    expect(cosine(a, b)).toBeLessThan(0.3);
  });

  it('L2-normalized: cosine(v, v) == 1', async () => {
    const v = await e.embed('any text at all');
    expect(cosine(v, v)).toBeCloseTo(1, 5);
  });

  it('empty text returns zero vector', async () => {
    const v = await e.embed('');
    expect(cosine(v, v)).toBeCloseTo(0, 5);
  });
});
