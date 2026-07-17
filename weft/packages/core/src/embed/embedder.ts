// Embedder interface + StubEmbedder — build-list M5-T1.
//
// The Embedder produces 384-dim vectors. Weft's routing and matching are
// pure functions of these vectors (§DD 3), so as long as the interface is
// stable, we can swap StubEmbedder for MiniLM at M8 without touching M5.
//
// The Stub is intentionally simple: tokenize to lowercase words, hash each
// to a bucket, count, L2-normalize. Similar texts overlap. Good enough for
// end-to-end routing tests; useless for real semantic matching (that's M8).

export interface Embedder {
  embed(text: string): Promise<Float32Array>;
  readonly dim: number;
}

export const EMBEDDING_DIM = 384;

/** Cosine similarity for L2-normalized vectors — equivalent to dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) {
    throw new Error(`cosine: dim mismatch ${a.length} vs ${b.length}`);
  }
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i];
  return sum;
}

/**
 * Deterministic bag-of-words embedder for tests. Same input → same vector.
 * Similar texts overlap; different texts do not. Not semantically meaningful.
 */
export class StubEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;

  async embed(text: string): Promise<Float32Array> {
    const v = new Float32Array(this.dim);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 0);
    for (const t of tokens) {
      const bucket = hashToBucket(t, this.dim);
      v[bucket] += 1;
    }
    // L2 normalize.
    let sq = 0;
    for (let i = 0; i < v.length; i++) sq += v[i] * v[i];
    if (sq > 0) {
      const norm = Math.sqrt(sq);
      for (let i = 0; i < v.length; i++) v[i] /= norm;
    }
    return v;
  }
}

/** FNV-1a to a bucket in [0, dim). Fast, deterministic, adequate for the stub. */
function hashToBucket(s: string, dim: number): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return Math.abs(h) % dim;
}
