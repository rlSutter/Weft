# Weft v0 — fixes to apply (for Claude Code)

Fable evaluated the codebase: **145/145 tests pass, lint is clean, all four release gates are real, `core/` is pure, crypto is disciplined.** There is **one blocker** stopping `pnpm -r build` from exiting 0, plus two minor items. Apply these in order, then confirm the green-build command at the bottom. Every fix below has been tested against the actual code — the shim in Fix 1 was verified to produce a fully green `pnpm -r build` with zero residual type errors.

Do not change any behavior, any wire format, any test assertion, or any of the four release gates. These are build-configuration and packaging fixes only.

---

## Fix 1 — BLOCKER: `@weft/core` fails `tsc` on runtime-universal globals

### Symptom
`pnpm -r build` fails in `@weft/core` with errors like:
```
src/wrap/nip44.ts(20,25): error TS2304: Cannot find name 'TextDecoder'.
src/wrap/nip44.ts(32,14): error TS2304: Cannot find name 'TextEncoder'.
src/invite/engine.ts(313,...): error TS2304: Cannot find name 'TextEncoder'.
src/keys/__tests__/keys.test.ts(166,38): error TS2304: Cannot find name 'setTimeout'.
src/wrap/__tests__/wrap.test.ts: Cannot find name 'TextEncoder' / 'TextDecoder' / 'require'.
```
(Tests still pass because vitest's bundler provides these globals at runtime; only the standalone `tsc --noEmit` type-check trips. But M0-T1's acceptance is `pnpm -r build` exits 0, so this must be fixed.)

### Root cause — and what NOT to do
`packages/core/tsconfig.json` sets `lib: ["ES2022"]` and `types: []`. **That is correct and must stay** — it is the DD §32.4 purity rule that keeps DOM and Node types out of `core/`. The problem is only that `TextEncoder`, `TextDecoder`, and `setTimeout`/`clearTimeout` — though present in every JS runtime (browser, Node, Web Worker) — are *typed* only inside TypeScript's DOM and Node lib files. Under a pure ES2022 lib they have no type.

**Do NOT** fix this by adding `"DOM"` or `"node"` to `lib`/`types`, importing `@types/node`, or using `any`. That would breach `core/` purity and defeat the whole point of the failing build. The honorable fix is a tiny ambient declaration of just these runtime-universal globals.

### The fix (verified to produce a green build)
Create **`packages/core/src/globals.d.ts`** with exactly this content:

```typescript
// Runtime-universal globals present in browsers, Node, and Web Workers but
// typed only in TypeScript's DOM/Node libs. Declared here so @weft/core can
// keep `lib: ["ES2022"]` + `types: []` (DD §32.4 purity — no DOM, no Node)
// and still type-check under a standalone `tsc --noEmit`.
//
// Keep this list MINIMAL: only globals that (a) exist in every JS runtime and
// (b) core actually uses. Do not add DOM or Node surface here — if a symbol is
// not universal, core should not depend on it.

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
```

That single file resolves **all** the errors above (production and test files alike — the `require('nostr-tools/pure')` in `wrap.test.ts` also resolves once ambient globals load correctly). No other file needs to change for this fix. Verified: with this file present, `pnpm -r build` exits 0 with zero type errors across all four packages.

### Guard against regression
Add a one-line comment at the top of `packages/core/tsconfig.json`'s neighboring README or in the file's context noting *why* `lib: ["ES2022"]` + `types: []` + `globals.d.ts` are a matched set, so a future edit doesn't "helpfully" add `@types/node` and think it's fixing something.

---

## Fix 2 — MINOR: confirm the root LICENSE files exist (packaging check)

### Symptom
`node scripts/check-licenses.mjs` prints "License check FAILED — missing license file: LICENSE / LICENSE-APACHE-2.0 / LICENSE-AGPL-3.0 (expected at repo root)" and exits 1.

### Diagnosis
This is almost certainly a **packaging artifact, not a code defect.** The per-package `license` fields are already correct (verified: `core` and `sim` = `Apache-2.0`; `pwa` and `porch` = `AGPL-3.0-only`), which matches the M0-T0 dual-track split exactly. The script looks for the three LICENSE files at the **repository root** (one level above `weft/`), and they were simply outside the evaluated archive.

### Action
- Confirm `LICENSE`, `LICENSE-APACHE-2.0`, and `LICENSE-AGPL-3.0` exist at the actual repo root (the directory that contains `weft/`, `weft-design.md`, etc. — per README's repo map and DD §26.3). If they exist, no code change is needed and the check will pass in the real tree.
- If they are genuinely missing, create them per DD §26.3: `LICENSE` = the plain-language dual-track explainer; `LICENSE-APACHE-2.0` and `LICENSE-AGPL-3.0` = the canonical upstream texts. Do **not** change the per-package `license` fields — they are already right.
- Optional robustness: have `check-licenses.mjs` resolve the repo root relative to its own location (`scripts/` → parent) rather than the current working directory, so it behaves identically whether run from the repo root or the `weft/` workspace.

---

## Fix 3 — MINOR: keep the test-file globals covered

Already handled by Fix 1 (the `globals.d.ts` covers `setTimeout` and the `TextEncoder`/`TextDecoder` uses in `keys.test.ts` and `wrap.test.ts`, and the `require` line resolves). **No separate action needed** — just verify after Fix 1 that `pnpm --filter @weft/core exec tsc --noEmit` reports zero errors including in `__tests__`.

If you later prefer to isolate test typings instead, the alternative is a `tsconfig.test.json` in `core` that adds test-only lib support — but that is optional and Fix 1 already makes the whole package green, so prefer the smaller change.

---

## Do NOT do (scope guard)

- Do not add `DOM`, `DOM.Iterable`, or `node` to `packages/core`'s `lib` or `types`. Purity (§32.4) is the point.
- Do not import `@types/node` anywhere in `core`.
- Do not modify any of the four release-gate tests (`query-engine.test.ts` Gates 1 & 4, `handshake.test.ts` Gate 2, `invite-engine.test.ts` Gate 3). They are correct and were read line-by-line; they must remain unwaivable.
- Do not touch wire formats, the invite-token fixture (`__fixtures__/token-v1.hex`), kind numbers, or any behavior. These fixes are build-config and packaging only.

---

## Confirm green (run these; all must succeed)

```
pnpm -r build     # must exit 0 (Fix 1 makes core type-check pass)
pnpm -r test      # must stay 145/145 green
pnpm -r lint      # must stay clean
node scripts/check-licenses.mjs   # must exit 0 in the real repo tree (Fix 2)
```

When all four are green, v0's definition of done (`weft-build-list.md` §14) is met — including the four soul-gates — and the phase is ready for Fable's sign-off.

## Still owed by a human (not code fixes)

The **Layer-5 manual test** (TESTING.md): two browser profiles + one porch node + 2–3 public Nostr relays, running the M7-T1 three-node scenario and confirming Pass emits zero events on the wire end-to-end. The sim gates stand in for this, but the on-public-infrastructure gate needs a person and live relays before release. Record the result in `CHANGELOG.md` per the phase model.
