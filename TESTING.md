# Testing Weft

How to prove the code does what the design and UX spec say it does. Every task in `weft-build-list.md` has an acceptance test; this document explains the layers those tests live in, the tools that run them, the two **release-gate** tests that encode the design's soul, and the manual protocols that require a human. It is prescriptive: the shape of testing is fixed early because retrofitting test discipline into a running protocol is how subtle privacy bugs get shipped.

Testing is co-owned with **Fable**, who reviews test coverage and can require additional tests before a phase is released.

---

## The five layers

Every behavior is proven at one or more of these layers. Which layer(s) a task uses is stated in that task's acceptance criteria.

| # | Layer | Runs on | Speed | Purpose |
|---|---|---|---|---|
| 1 | **Unit** | `vitest` in each package | ms | Pure functions, wire-format fixtures, single-module logic |
| 2 | **Sim integration** | `vitest` + `@weft/sim` (MockRelay + fake clock) | ms–s | Multi-node protocol scenarios end-to-end with no network |
| 3 | **Type-shape / lint** | `tsc --noEmit`, ESLint, custom lints (banned-copy grep, §UX 3) | ms–s | Strict-mode compile, banned words in UI copy, invariant checks |
| 4 | **Manual, local relay** | Two browser profiles + a local mock relay | minutes | UX flows, PWA install, keys export/import |
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

Two tests encode invariants the design cannot be shipped without. They live in `core/routing` and `core/handshake` respectively and are called out here so nobody removes them without reading this file.

### Gate 1 — Byte-identical authored/forwarded query
**Location:** `core/routing/__tests__/query.shape.test.ts` (per M5-T3 acceptance).
**Assertion:** For any query, the wire-shape of a 4910 event *authored* by node A is byte-identical to a 4910 event *forwarded* by node C after passing through B. No field, tag, or ordering distinguishes author from forwarder. This is DD invariant 4 in code: *attribute nothing by default*.
**Why:** if this test ever fails, the first-hop contact can tell whether an ask is their friend's or a friend-of-a-friend's — collapsing origin ambiguity (DD §17.2). Never patch the test to make it pass; fix the drift.

### Gate 2 — Zero events on decline
**Location:** `core/handshake/__tests__/decline.silent.test.ts` (per M5-T4 acceptance).
**Assertion:** In a scenario where B receives A's intent ping and B "declines" (i.e., B's user taps Pass or B's device stalls), B's node emits **zero** events of any kind, in any direction. Not a NACK, not a decline enum, not a receipt.
**Why:** the protocol has no message for "no" *by design* (DD §5 stage 2, UX §12). If a decline emits anything, rejection can be turned into a hook — the harassment vector every dating app has and Weft refuses. `assert(relay.eventLog.filter(fromB).length === 0)`.

**Rule:** either gate failing blocks the release regardless of how much else is green. Fable reviews any change that touches routing- or handshake-engine tests specifically to confirm these gates remain intact.

---

## What to test at each layer

### Layer 1 (unit)
- Every pure function in `core/` has round-trip tests where applicable (encode/decode, sign/verify, embed/cosine).
- Wire formats have hex fixtures. Any change to a fixture is reviewed as a wire-format change.
- `core/kinds/registry.ts` has invariant tests: retention class per kind, no duplicate numbers, tag vocabulary matches DD §33.4.
- Crypto: use noble's own test vectors where they exist (M1-T1 requires it). Never write your own crypto vectors.

### Layer 2 (sim integration)
- **Invite engine (M5-T2):** full happy path across two nodes; replay of the same token surfaces `replayAlert`; void path leaves the joiner with zero vouches.
- **Query engine (M5-T3):** 6-node line+branch topology, planted interests, ask reaches a match within a fake-clock budget; queryState reaper kills unanswered queries; a stamp-zero neighbor forwards nothing; **Gate 1** above.
- **Handshake engine (M5-T4):** full A↔B through 2 intermediate hops ends `channelOpen` with verified names; tampered vouch id → `impersonationAlert`; **Gate 2** above.
- **Store reaper (M3-T2):** insert at t, advance the fake clock past expiry, sweep, assert absence of expired records and presence of unexpired.
- **Outbox (M4-T2):** enqueue while relay is "down", assert nothing sent; flip relay up, flush, assert delivery; queue survives store reload.

### Layer 3 (type-shape / lint)
- `tsc --noEmit` must be green across the workspace. No `any` outside test fixtures. No `@ts-ignore`.
- ESLint with the default recommended set + a small local ruleset.
- **Copy lint** (added in M6): grep the built PWA bundle for banned words (UX §3: `request`, `profile`, `post`, `feed`, `followers`, `network`, `user`, `content`). Any hit fails CI. This lint applies only to user-facing strings; internal identifiers may use these words when technically necessary.

### Layer 4 (manual, local relay)
Follows `docs/manual-tests.md` (written in M6-T2). Covers:
- PWA installability (Lighthouse PWA check).
- Offline load after first visit (service-worker precache).
- Key export/import (encrypted, passphrase → scrypt → AES-GCM), lose-and-restore.
- Full onboarding flow (invite landing → charter → name → interests → home).
- Ask → traveling → match → reveal → conversation, in the sim.
- Reduced-motion honored (UX §18): no flip, no ripple, no dot pulse.
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
- Neither Fable nor Claude Code may waive the two release gates. Ever.

---

## What is deliberately not tested

Consistent with build-list §13 (deferred features), v0 has no tests for: personas, group channels, MLS, beacon publishing, push notifications, LSH private matching, anonymous credentials, media/blobs, standing-ask rhythm, escrow. Their absence is not a testing gap; they are not built. When any of these arrives in v2, its tests arrive with it and this document grows a section.
