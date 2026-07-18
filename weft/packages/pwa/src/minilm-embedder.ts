// MiniLMEmbedder — @huggingface/transformers, quantized all-MiniLM-L6-v2,
// WASM backend, cached in the browser after first fetch. M8-T1.
//
// StubEmbedder remains the test-suite embedder; MiniLM only ships in the
// actual PWA / porch runtimes.

import type { Embedder } from '@weft/core';

const MODEL_ID = 'Xenova/all-MiniLM-L6-v2';
const EMBEDDING_DIM = 384;

type FeaturePipeline = (
  text: string,
  opts?: { pooling?: 'mean'; normalize?: boolean },
) => Promise<{ data: Float32Array | number[] }>;

export class MiniLMEmbedder implements Embedder {
  readonly dim = EMBEDDING_DIM;
  private pipe: FeaturePipeline | undefined;
  private loading: Promise<FeaturePipeline> | undefined;

  async embed(text: string): Promise<Float32Array> {
    const pipe = await this.load();
    const result = await pipe(text, { pooling: 'mean', normalize: true });
    const arr = result.data instanceof Float32Array ? result.data : new Float32Array(result.data);
    if (arr.length !== this.dim) {
      throw new Error(`MiniLM embedding dim mismatch: got ${arr.length}, expected ${this.dim}`);
    }
    return arr;
  }

  private async load(): Promise<FeaturePipeline> {
    if (this.pipe) return this.pipe;
    if (!this.loading) {
      this.loading = (async () => {
        // Import lazily so bundlers don't pull the entire ONNX runtime into
        // the initial-page bundle.
        const { pipeline } = await import('@huggingface/transformers');
        const p = await pipeline('feature-extraction', MODEL_ID);
        this.pipe = p as unknown as FeaturePipeline;
        return this.pipe;
      })();
    }
    return this.loading;
  }
}
