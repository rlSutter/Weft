# Testing Weft

How to prove the code does what the design and UX spec say it does. Every task in `weft-build-list.md` has an acceptance test; this document explains the layers those tests live in, the tools that run them, the four **release-gate** tests that encode the design's soul, and the manual protocols that require a human. It is prescriptive: the shape of testing is fixed early because retrofitting test discipline into a running protocol is how subtle privacy bugs get shipped.

Testing is co-owned with **Fable**, who reviews test coverage and can require additional tests before a phase is released.

> **Revision note (2026-07-13).** Updated for DD §35. Material changes: **four** release gates, not two (Gate 3 — no plaintext vouches on relays, F1; Gate 4 — route paths cannot be correlated, F2); Layer 3.5 for component tests of safety-critical UI invariants (M9); copy lint operates on source, not the built bundle (H5); Layer 1 gains store-migration tests (L14); Layer 4 gains explicit accessibility items (L15); project-review authority is distinguished from protocol governance (L13).

---

## The five layers

Every behavior is proven at one or more of these layers. Which layer(s) a task uses is stated in that task's acceptance criteria.

| # | Layer | Runs on | Speed | Purpose |
|---|---|---|---|---|
| 1 | **Unit** | `vitest` in each package | ms | Pure functions, wire-format fixtures, single-module logic, store-schema migrations |
| 2 | **Sim integration** | `vitest` + `@weft/sim` (MockRelay + fake clock) | ms–s | Multi-node protocol scenarios end-to-end with no network |
| 3 | **Type-shape / lint** | `tsc --noEmit`, ESLint, custom lints (banned-copy source lint, accessibility lints) | ms–s | Strict-mode compile, banned words in UI copy, invariant checks, axe-core rules |
| **3.5** | **Component tests** | `vitest` + `@testing-library/react` (jsdom) | s | Safety-critical UI invariants (consent-before-key, invisible Pass at the UI, impersonation never mounts a name) |
| 4 | **Manual, local relay** | Two browser profiles + a local mock relay | minutes | UX flows, PWA install, keys export/import, accessibility checks (reduced-motion, text-only path, screen-reader order) |
| 5 | **Manual, public relay** | Two profiles + a porch node + 2–3 public Nostr relays | minutes | End-to-end on real infrastructure — the release gate |

Layers 1–3 run in CI on every commit; layers 4–5 run at phase boundaries before release, following the script in `docs/manual-tests.md` (created in M6-T2).

---

## Tools

- **`vitest`** — the only test runner. Every package has a `test` script; `pnpm -r test` runs the whole workspace.
- **`@weft/sim`** — in-memory `MockRelay` with a fake clock and multi-node topologies. Every protocol test in M5 lives here. If a scenario needs a real WebSocket to exercise, it belongs in layer 4 or 5, not sim.
- **Coverage** — `vitest --coverage` (v8 provider). Coverage floors (per build-list §14): **≥80% on `core/invite`, `core/routing`, `core/handshake`, `core/wrap`**. These four are the wire-critical and privacy-critical modules; other modules follow best-effort until they inherit similar constraints.
- **Fixtures** — committed under each module's `__fixtures__/`. The invite-token hex fixture (M1-T3) is a *forever* compatibility test: if it ever needs to change, that is a wire-format change requiring a version bump.

---

## Release-gate tests (do not weaken these, ever)

Four tests encode invariants the design cannot be shipped without. They live under `core/` and are called out here so nobody removes or weakens them without reading this file.

### Gate 1 — Byte-identical authored/forwarded query
**Location:** `core/routing/__tests__/query.shape.test.ts` (per M5-T3 acceptance).
**Assertion:** For any query, the wire-shape of a 4910 event *authored* by node A is byte-identical to a 4910 event *forwarded* by node C after passing through B. No field, tag, or ordering distinguishes author from forwarder. This is DD invariant 4 in code: *attribute nothing by default*.
**Why:** if this test ever fails, the first-hop contact can tell whether an ask is their friend's or a friend-of-a-friend's — collapsing origin ambiguity (DD §17.2). Never patch the test to make it pass; fix the drift.

### Gate 2 — Zero events on decline
**Location:** `core/handshake/__tests__/decline.silent.test.ts` (per M5-T4 acceptance).
**Assertion:** In a scenario where B receives A's intent ping and B "declines" (i.e., B's user taps Pass or B's device stalls), B's node emits **zero** events of any kind, in any direction. Not a NACK, not a decline enum, not a receipt.
**Why:** the protocol has no message for "no" *by design* (DD §5 stage 2, UX §12). If a decline emits anything, rejection can be turned into a hook — the harassment vector every dating app has and Weft refuses. `assert(relay.eventLog.filter(fromB).length === 0)`.

### Gate 3 — No plaintext vouch reaches a relay
**Location:** `core/invite/__tests__/vouch.private.test.ts` (per M5-T2 acceptance).
**Assertion:** After a full invite → redeem → confirm cycle across two sim nodes, scanning MockRelay storage yields **zero** plaintext 4902 events. B holds A's signed attestation locally (cached in `vouches`); vouches are presented inside match tokens and reveal payloads, never as public relay events. Only a hash-referencing 4903 void may ever appear publicly.
**Why:** the trust graph *is* the social graph — publishing vouches publishes the warp while §17 protects only the weft (DD §35 F1). Vouches are protected asset #1 in `SECURITY.md`. It also makes the manifesto's "empty shelves" claim true. If this gate fails, the design's foundational asymmetry (warp private, weft ambiguous) collapses.

### Gate 4 — Reply paths cannot be correlated
**Location:** `core/routing/__tests__/route.blinding.test.ts` (per M5-T3 acceptance).
**Assertion:** In a sim scenario, two non-adjacent nodes on a query's path record every wrapper field they observe for the query and its reply. The intersection of identifying values across the two recorders is **empty**: per-edge route tokens (`rt`) differ at every hop; no queryId ever appears in wrapper plaintext; no ephemeral pubkey re-uses across hops.
**Why:** a plaintext queryId visible at every hop lets colluding non-adjacent nodes trace the full path, partially defeating origin ambiguity (DD §35 F2). Adversary A2′ in `SECURITY.md`. Route-token blinding is the fix; this gate proves it.

**Rule:** **any** of the four gates failing blocks the release, regardless of how much else is green. (The v2 group/persona layers add **gates 5 and 6** — *plurality is bounded* and *accountability is scoped* — specified in build-list M13-T1; they become unwaivable for any release containing those layers. They do not exist in v0 because the layers don't.) Fable reviews any change to `core/routing`, `core/handshake`, or `core/invite` specifically to confirm the gates remain intact — and reviews any modification to these test files as a security-relevant change (`SECURITY.md` § *Review*).

---

## What to test at each layer

### Layer 1 (unit)
- Every pure function in `core/` has round-trip tests where applicable (encode/decode, sign/verify, embed/cosine).
- Wire formats have hex fixtures. Any change to a fixture is reviewed as a wire-format change.
- `core/kinds/registry.ts` has invariant tests: retention class per kind, no duplicate numbers, tag vocabulary matches DD §33.4.
- Crypto: use noble's own test vectors where they exist (M1-T1 requires it). Never write your own crypto vectors.
- **Store migrations** (L14, per M3-T1): the store carries a `schema_version` integer. For every migration, a test opens a committed fixture DB at version N−1, runs the migration, and asserts data integrity + new-schema conformance. Local-first apps die of schema drift; the fixture DB is checked in as `core/store/__fixtures__/schema_vN.json`.

### Layer 2 (sim integration)
- **Invite engine (M5-T2):** full happy path across two nodes; replay of the same token surfaces `replayAlert`; void path leaves the joiner with zero vouches; **Gate 3** above (no plaintext vouches ever land on MockRelay).
- **Query engine (M5-T3):** 6-node line+branch topology, planted interests, ask reaches a match within a fake-clock budget; queryState reaper kills unanswered queries; a stamp-zero neighbor forwards nothing; **Gate 1** above (byte-identical authored/forwarded); **Gate 4** above (non-adjacent nodes cannot correlate route tokens).
- **Handshake engine (M5-T4):** full A↔B through 2 intermediate hops ends `channelOpen` with verified names; tampered vouch id → `impersonationAlert`; **Gate 2** above (silent decline).
- **Store reaper (M3-T2):** insert at t, advance the fake clock past expiry, sweep, assert absence of expired records and presence of unexpired.
- **Outbox (M4-T2):** enqueue while relay is "down", assert nothing sent; flip relay up, flush, assert delivery; queue survives store reload.

### Layer 3 (type-shape / lint)
- `tsc --noEmit` must be green across the workspace. No `any` outside test fixtures. No `@ts-ignore`.
- ESLint with the default recommended set + a small local ruleset.
- **Copy lint** (added in M6, source-only): all user-facing strings live in `pwa/src/copy/*.ts` (per UX §14 — centralizing copy also makes it reviewable and later translatable). The lint parses those modules' exported string literals only and matches **whole words, case-insensitive**, with an allowlist for legitimate compounds (`postage`, `posted` when a cell writes it into charter text). Banned list per UX §3 and §17: `request`, `profile`, `post`, `feed`, `followers`, `network`, `user`, `content`. Any hit fails CI. **Never grep the built bundle** — React internals, `postMessage`, CSS `content:`, minified identifiers, and every dependency produce thousands of false positives, and the lint gets disabled within a week. Source-only, whole-word, string-literal-only is the shape that actually works.
- **Accessibility lints** (L15, part of M6): axe-core rules enforced against rendered component tests (Layer 3.5) — contrast ≥4.5:1 body-on-surface, all interactive elements ≥44×44px, every control labeled, screen-reader order matches visual order. Failures block CI.

### Layer 3.5 (component tests, safety-critical UI invariants)

Three UI-level invariants are safety-critical and *will* silently regress if left to manual review. Each is asserted with `@testing-library/react` in a jsdom `vitest` environment, run in CI.

- **Consent precedes existence** (UX §9). Render the onboarding flow through steps 1–2 (invite landing, charter consent) with a scripted charter fetch. Assert `identity.hasKey === false` across every render frame. Simulate the "Not now" abort at charter step; assert no key exists and no stored state persists. This is the security-critical path: no keypair may exist before the user has agreed to the charter.
- **Pass emits zero events at the UI layer** (UX §12). Mount the match card, tap Pass, assert the outbox contains zero enqueued events attributable to this UI action. (Gate 2 in the engine layer; this test confirms the UI cannot accidentally route around the engine.)
- **Impersonation never reveals a name** (UX §12). Feed the handshake engine a tampered vouch reference; assert the reveal component never mounts with a name (no DOM node containing the counterpart's `displayName` is ever rendered) and the danger card renders instead. Manual review still confirms *feel*; CI confirms the *invariant*.

Component tests are shallow — they mount UI against a stubbed engine, not against sim topologies. Layer 2 covers protocol correctness end-to-end; Layer 3.5 covers "the UI cannot betray the engine."

### Layer 4 (manual, local relay)
Follows `docs/manual-tests.md` (written in M6-T2). Covers:
- PWA installability (Lighthouse PWA check).
- Offline load after first visit (service-worker precache).
- Key export/import (encrypted, passphrase → scrypt → AES-GCM), lose-and-restore.
- Full onboarding flow (invite landing → charter → name → interests → home).
- Ask → traveling → match → reveal → conversation, in the sim.
- **Reduced-motion honored** (UX §18): no flip, no ripple, no dot pulse.
- **Text-only completion of every flow** (UX §19): with the mic disabled, every onboarding, ask, and consent flow must complete via typing alone. Accessibility floor per DD §16.8.
- **Contrast and target size** — automated via axe-core in Layer 3, spot-checked in real browsers here.
- **Screen-reader walk-through** — VoiceOver (Safari) and NVDA (Firefox) both walk through the ask flow, confirm-card, and reveal in a sensible order; the reveal announces the revealed identity via ARIA live region.
- Every acceptance checkbox in UX §§9–15 checked by a human against a running build.

### Layer 5 (manual, public relay)
The **release gate**. Two browser profiles + one porch node + 2–3 well-known public Nostr relays (e.g., Damus, nos.lol, primal). Runs the three-node scenario from M7-T1: routing survives across real infrastructure with the two profiles sharing only the porch node as a contact. Also runs the Pass test from M6-T3: assert via relay log that Pass emits zero events on the wire (i.e., Gate 2 holds end-to-end, not just in sim).

---

## Test data and privacy

- Test users get **fake keypairs generated per test** — never a checked-in secret key, ever. `.gitignore` blocks `*.key`, `.env`, and everything under a `secrets/` folder.
- Manual-test scripts use throwaway keys documented as such in `docs/manual-tests.md`. If a real user's key ever appears in a diff, the commit must be reverted and the key rotated. (Fable is asked to spot-check for this at each phase review.)
- No test may write plaintext embeddings, plaintext handshake payloads, or plaintext identity payloads to disk beyond the temp files vitest manages — the reaper (M3-T2) covers ephemeral state; tests should not out-live it.

---

## Running tests

Once M0-T1 is complete:

```
pnpm -r build      # workspace type-check + build
pnpm -r test       # all unit + sim tests
pnpm -r lint       # ESLint + copy lint (M6+)
pnpm --filter @weft/core test -- --coverage    # coverage on the wire-critical modules
```

Manual tests: follow `docs/manual-tests.md`.

---

## Review authority

- **Fable** may block a phase from release if test coverage on wire-critical modules drops below the §14 floors, if a release gate is weakened or removed, or if a manual test protocol is skipped without justification.
- The human designer may waive manual-test items for a phase, but the waiver is recorded in the corresponding CHANGELOG entry with the reason.
- Neither Fable nor Claude Code may waive the **four** release gates. Ever.

**Scope of this authority** (L13). The review powers described here are *project rules* for this pre-v1 repository — they govern what gets merged and what a phase release requires. They are **not** the protocol governance described in DD §26 (rough consensus over RFCs, the five invariants as constitution, adoption as ratification, forking as the check). When outside contributors and other client implementations arrive, the DD §26 process is the authority over the *protocol*, and Fable / Claude / any single reviewer holds no more standing there than any other participant. The distinction matters: this document can raise the bar for what this repo ships; only DD §26 can raise the bar for what Weft *is*.

---

## What is deliberately not tested

Consistent with build-list §13 (deferred features), v0 has no tests for: personas, group channels, MLS, beacon publishing, push notifications, LSH private matching, anonymous credentials, media/blobs, standing-ask rhythm, escrow. Their absence is not a testing gap; they are not built.

The **group and persona layers are now fully specified** (DD §36) with their own build appendix (build-list §16, M9–M13) and their own acceptance tests defined there — including v2 release gates 5 and 6. Those tests arrive with the code when the layers are built; until then this document's v0 scope stands, and the v2 test sections will be expanded here at that time.
