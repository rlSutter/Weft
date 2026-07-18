// Runtime-universal globals present in browsers, Node, and Web Workers but
// typed only in TypeScript's DOM/Node libs. Declared here so @weft/core can
// keep `lib: ["ES2022"]` + `types: []` (DD §32.4 purity — no DOM, no Node)
// and still type-check under a standalone `tsc --noEmit`.
//
// Keep this list MINIMAL: only globals that (a) exist in every JS runtime and
// (b) core actually uses. Do not add DOM or Node surface here — if a symbol is
// not universal, core should not depend on it.
//
// The paired invariant lives in packages/core/tsconfig.json (`types: []`) and
// tsconfig.base.json (`lib: ["ES2022"]`). Together with this file they form a
// matched set — do NOT "helpfully" replace this by adding `@types/node` or
// `DOM` to `lib`; that would defeat DD §32.4 and Fable's Fix 1 in
// weft-fixes-for-claude-code.md.

declare class TextEncoder {
  encode(input?: string): Uint8Array;
}

declare class TextDecoder {
  constructor(label?: string, options?: { fatal?: boolean; ignoreBOM?: boolean });
  decode(
    input?: ArrayBufferView | ArrayBuffer,
    options?: { stream?: boolean }
  ): string;
}

declare function setTimeout(
  handler: (...args: unknown[]) => void,
  timeout?: number
): number;
declare function clearTimeout(id: number): void;
