# Weft — Application Structure

This document describes the layout of the `weft/` application scaffold. It is a map, not a build guide. Implementation follows `weft-build-list.md` milestone by milestone; design intent lives in `weft-design.md` (referenced below as **DD §n**); UI specifications live in `weft-ux-spec.md` (normative for M6 — the **BUILD** sections there are byte-for-byte binding, the way DD §30 and §33 are for wire formats).

---

## Repository layout (from this folder down)

```
Weft/                       (this folder)
  weft-design.md            design document (Fable is revising)
  weft-build-list.md        execution plan for v0
  weft-ux-spec.md           UX specification (normative for M6)
  weft-manifesto.md
  weft-overview.md
  weft-mockup.html          UI visual reference
  weft-mockup.jsx           UI visual reference (React)
  STRUCTURE.md              this file

  weft/                     application scaffold
    package.json              pnpm workspace root
    pnpm-workspace.yaml       declares packages/* as workspace members
    tsconfig.base.json        shared TypeScript strict-mode config
    .npmrc                    pnpm settings
    .gitignore

    packages/
      core/                   pure-TS protocol engine
      sim/                    in-memory network harness for tests
      pwa/                    Vite + React browser client
      porch/                  headless Node runner

    docs/                     project documentation (design doc copied here in M0)
```

The monorepo uses **pnpm workspaces** so `packages/*` can depend on each other via `workspace:*` without publishing. TypeScript is set to strict mode globally through `tsconfig.base.json`; every package extends it.

---

## Package boundaries (the non-negotiable one)

The build list (§3) draws one hard line: **`core/` must compile with zero DOM APIs and zero Node built-ins.** Every browser/runtime concern lives in a platform adapter (`pwa/`, `porch/`). This separation is what lets the same protocol engine run identically in a service worker, a headless Node process, or a future Tauri desktop shell. It is DD §32.4 and treated as architectural law.

Concretely:

| Package | May import | May NOT import |
|---|---|---|
| `@weft/core` | `@noble/*`, `nostr-tools`, `cbor-x` | anything DOM (`window`, `document`), anything Node (`fs`, `crypto`, `net`) |
| `@weft/sim` | `@weft/core` | DOM, Node built-ins (stays portable) |
| `@weft/pwa` | `@weft/core`, DOM APIs, browser libs (`idb`, `qrcode`, `@zxing/browser`, React) | Node built-ins |
| `@weft/porch` | `@weft/core`, Node built-ins | DOM |

---

## `weft/packages/core/` — the protocol engine

Pure TypeScript. Zero platform coupling. This is where the byte-for-byte wire formats (DD §30 invite token, DD §33 event kinds) and the routing/handshake state machines live. Sub-folders correspond to build-list modules:

```
core/src/
  keys/            secp256k1 keypairs, BIP-340 sign/verify, ephemeral-key helper       [M1-T1]
  codec/           NIP-01 event build/serialize/hash/sign/verify                       [M1-T2]
  kinds/           kind-number registry with retention classes and tag vocabulary      [M0-T2, DD §33]
  invite/          invite-token wire format + redemption engine                        [M1-T3, M5-T2, DD §30]
  wrap/            NIP-44 pairwise seal + NIP-59 gift-wrap                             [M2, DD §33.1]
  store/           WeftStore interface + MemoryStore + expiry reaper                   [M3, DD §9.2]
  relay/           transport-agnostic relay interface (adapters in pwa/porch;
                   MockRelay in sim)                                                    [M4-T1]
  routing/         query engine — ask/forward/reply, private routing sketch            [M5-T3, DD §3, §17.2]
  handshake/       5-stage consent handshake state machine (kinds 4913–4917)           [M5-T4, DD §5]
  embed/           Embedder interface + StubEmbedder (deterministic, test-only)        [M5-T1, DD §19]
  health.ts        local-only counters, never published                                [M5-T5, DD §10.1]
  index.ts         package barrel
```

Each folder currently holds only a `.gitkeep`; implementation starts when the design revisions settle.

---

## `weft/packages/sim/` — network harness

In-memory `MockRelay` that satisfies the same relay interface `core/` uses, plus a fake clock. Lets the protocol engine (especially the M5 routing and handshake tests) run in-process without any WebSocket dependency — the sim scenarios in build-list M5-T3 and M5-T4 (multi-node topologies, byte-identical authored-vs-forwarded query test, zero-events-on-decline test) all use it.

---

## `weft/packages/pwa/` — browser client

Vite + React 18 with `vite-plugin-pwa`. Provides the DOM adapters `core/` deliberately can't have:

- **`IdbStore`** — IndexedDB implementation of `WeftStore` (runs the same conformance test suite as `MemoryStore`).
- **Relay pool** — WebSocket transport via `nostr-tools` SimplePool.
- **UI** — onboarding, ask flow, match cards, reveal, message thread. The authoritative spec is `weft-ux-spec.md` (Part IV per-screen BUILD sections are normative — copy strings, states, acceptance checklists); `weft-mockup.html` / `weft-mockup.jsx` are the visual language reference (palette, type, card patterns). The mockup contains some v2 surfaces (personas, travel modes, escrow) that must NOT be wired up in v0 — the UX spec's scope filter is the source of truth.
- **`MiniLMEmbedder`** — quantized `all-MiniLM-L6-v2` via `@huggingface/transformers`, WASM backend, cached to browser storage (M8; `StubEmbedder` remains the test-suite embedder).

Persistent state uses `idb` (async IndexedDB wrapper). Signing uses noble because WebCrypto lacks secp256k1; key-wrapping also uses noble (`scrypt` for the passphrase KDF + AES-GCM from `@noble/ciphers`) to keep one audited crypto surface rather than two. WebCrypto's AES-GCM would be legitimate for wrapping in isolation, but mixing crypto libraries within a single privacy-critical flow is a well-known source of subtle bugs — the discipline is *one library or the other*, and noble is the one that covers everything.

---

## `weft/packages/porch/` — headless node

Node 22 CLI. Loads a key + config JSON, subscribes to relays, runs `onQuery` / reply-relay / handshake-forwarding forever, prints local counters. It is architecturally still an edge node — a member's device with a member's keys, subject to postage and every protocol rule — but operationally the cell's always-on workhorse while phones sleep (DD §28.5, "porch nodes").

Shares the same `@weft/core` engine as the PWA; the only difference is the platform adapter (Node WebSocket + filesystem instead of browser WebSocket + IndexedDB).

---

## `weft/docs/`

Empty for now. Per build-list M0 the design document will be copied here once Claude Fable's revisions land, so the application repo is self-contained.

---

## Dependency policy

- **Pinned stack only** (build list §2). New dependencies require explicit approval — the crypto and Nostr layers are deliberately narrow.
- **Never hand-roll cryptography.** Only `@noble/curves` (secp256k1 + BIP-340 Schnorr), `@noble/hashes`, `@noble/ciphers`, and `nostr-tools`' NIP-44 helpers.
- **No backend code, ever.** The only network calls anywhere are WebSocket connections to Nostr relays. There is no HTTP API to build, no database server to run, no auth service — if a task appears to need one, it has been misread.
- **npm scope:** packages publish under `@weft/*` (verified 2026-07-13: `@weft/core`, `@weft/sim`, `@weft/pwa`, `@weft/porch` all return 404 on the registry, i.e., available). The `weft` npm org itself will be reserved by the human designer before M0-T1 publishes any package. If the org proves unavailable at publish time, the fallback is `@weft-protocol/*` and this document + every import gets renamed in one commit. Unscoped `weft` on npm is taken (Google Web Fonts wrapper); on PyPI it is also taken. Both are unrelated projects, but they close off the unscoped names.

---

## What is deliberately NOT here (v0 scope)

Absent from this scaffold because they are deferred to v2 (build-list §13): voice/STT, travel modes beyond "through friends", LSH-bucketed private matching (DD §17.3–17.5), personas & anonymous credentials (DD §18), rendezvous nodes, group channels & MLS, telemetry beacons, push notifications, escrow, standing asks, model registry, cover traffic, media/blob layer (DD §34), SQLite-WASM. Each has a home in the design doc; none has a folder here yet. The design's own rule applies — every future addition must justify itself against the five invariants (DD §9.4, §17.6, §18.6).

---

## Build-list milestone map (short form)

| Milestone | Adds to | Deliverable |
|---|---|---|
| **M0** | root, all packages | scaffold + kind registry (this scaffold covers the layout half; M0-T2 fills `kinds/registry.ts`) |
| **M1** | `core/{keys,codec,invite}` | secp256k1, NIP-01 events, byte-exact invite token with committed fixture |
| **M2** | `core/wrap` | NIP-44 pairwise seal, NIP-59 gift wrap |
| **M3** | `core/store`, `pwa/` | `WeftStore` interface, `MemoryStore`, `IdbStore`, expiry reaper |
| **M4** | `core/relay`, `sim/` | relay pool, offline outbox, `MockRelay` |
| **M5** | `core/{embed,invite,routing,handshake}` | the heart — StubEmbedder, invite/query/handshake engines, local counters |
| **M6** | `pwa/` | PWA shell, onboarding, ask/matches, honest surfaces — implements `weft-ux-spec.md` Part IV |
| **M7** | `porch/` | headless runner |
| **M8** | `pwa/`, `porch/` | real MiniLM embeddings |

`STRUCTURE.md` will be updated as folders acquire content or the design settles differently. It is a live document, not a spec.
