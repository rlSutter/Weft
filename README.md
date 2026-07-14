# Weft

*A post-platform communications channel.*

> Weft is how you find your people without a platform in the middle. You say what you're looking for — out loud — and your ask travels friend to friend through your real social network, like asking around at a dinner table, without your name attached. When it finds someone who fits, you're both shown what the other is, never who, until you both say yes — and every match comes vouched by real people you can name.

Social connection should be infrastructure, not a destination — a communications channel like email, not a platform. That is what this repository designs, and eventually implements.

---

## Status

**Pre-implementation.** The design document is a working draft (currently being revised); the build list is stable; **no application code has been written yet**. This repository holds the design, the execution plan, and an empty workspace scaffold ready for coding.

There is nothing to install, nothing to run.

---

## Start here (reading order)

1. **[`weft-manifesto.md`](weft-manifesto.md)** — one page. What Weft is and why.
2. **[`weft-overview.md`](weft-overview.md)** — plain-language introduction, comparison table with existing platforms, honest fine print.
3. **[`weft-design.md`](weft-design.md)** — the full architecture and design document. 34 sections covering discovery, hop routing, the consent handshake, trust and vouching, governance, wire formats, and the twelve open problems the design confronts.
4. **[`weft-build-list.md`](weft-build-list.md)** — the v0 execution plan Claude Code will follow: eight milestones (M0–M8), pinned dependency stack, byte-exact wire formats, acceptance tests per task.
5. **[`STRUCTURE.md`](STRUCTURE.md)** — layout of the `weft/` application scaffold and the package boundaries.
6. **[`weft-mockup.html`](weft-mockup.html)** / **[`weft-mockup.jsx`](weft-mockup.jsx)** — UI reference for the PWA (copy palette, fonts, copy tone; ignore the v2 features that appear in the mockup but not in v0).

---

## Repository map

```
Weft/
  README.md                this file
  STRUCTURE.md             layout & package boundaries for the app scaffold
  weft-manifesto.md        one-page thesis
  weft-overview.md         plain-language introduction
  weft-design.md           full architecture (working draft)
  weft-build-list.md       v0 execution plan
  weft-mockup.html/.jsx    UI reference
  weft/                    application scaffold (empty, waiting on design revisions)
    packages/{core,sim,pwa,porch}/
    docs/
```

---

## What v0 will be

A working demo where 2–10 people (or simulated nodes) can create identities, invite each other with real signed CBOR tokens, form a contact graph, send semantic queries that hop through contacts with TTL and detail-stripping, get match replies, complete the 5-stage consent handshake, and chat over an established pairwise channel. Runs as a PWA and as a headless porch node. Uses public Nostr relays as dumb encrypted mailboxes.

**Explicitly not v0:** voice, personas, groups, anonymous credentials, private matching, MLS, push notifications, media beyond text, telemetry beacons. Each is designed in the DD and deferred to v2 — see `weft-build-list.md` §13.

## Stack (pinned)

TypeScript 5 · Node 22 · pnpm workspaces · Vite + React 18 (PWA) · `@noble/curves` / `@noble/hashes` / `@noble/ciphers` for crypto · `nostr-tools` for NIP-01/NIP-44/NIP-59 · `cbor-x` for the invite token wire format · Vitest · `@huggingface/transformers` (quantized MiniLM) for semantic embeddings in M8.

No backend. No database server. No hand-rolled cryptography. The only network calls anywhere are WebSocket connections to Nostr relays.

---

## The five design invariants

Any future change to the protocol must pass every one of these — they are the constitution the design tests itself against (DD §9.4, §17.6, §18.6):

1. **Encryption is layered by lifetime** (permanent identity → durable pairwise → ephemeral handshake → rotating group).
2. **Persistence is inversely proportional to sensitivity** (vouches live forever; handshakes evaporate in hours).
3. **Scaling is edge-bounded by construction** (per-query cost fixed by fan-out × TTL, independent of network size).
4. **Attribute nothing by default; identity enters only where a human chooses to reveal it.**
5. **Plurality is bounded, accountability is scoped.**

---

## On the name

In weaving, the *warp* threads are the fixed structure, and the *weft* is the thread that travels — carried hand to hand by the shuttle, across the warp, over and under, binding separate strands into cloth. Relationships are the warp; asks are the weft. The name keeps the heritage of "social fabric" while naming the motion instead of the venue: the traveling thread, not the finished sheet.

*The warp is already there. Come be the thread.*
