import { describe, it, expect } from 'vitest';
import { MiniLMEmbedder } from '../minilm-embedder';

describe('MiniLMEmbedder — interface conformance', () => {
  it('declares the 384-dim shape and matches the Embedder interface', () => {
    const e = new MiniLMEmbedder();
    expect(e.dim).toBe(384);
    // We do not actually call e.embed() here — that would download ~25 MB
    // of quantized weights on first run and require network in CI. Manual
    // testing verifies real embedding output (see docs/manual-tests.md).
    expect(typeof e.embed).toBe('function');
  });
});
