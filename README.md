# Weft

*A post-platform communications channel.*

> Weft is how you find your people without a platform in the middle. You say what you're looking for — out loud — and your ask travels friend to friend through your real social network, like asking around at a dinner table, without your name attached. When it finds someone who fits, you're both shown what the other is, never who, until you both say yes — and every match comes vouched by real people you can name.

Social connection should be infrastructure, not a destination — a communications channel like email, not a platform. That is what this repository designs, and eventually implements.

---

## Status

**v0.1.0-alpha** — the PWA is a real client and the protocol works end-to-end on public Nostr relays. All four release gates verified. See `CHANGELOG.md` for what's in and what's honestly deferred.

Try the live site (when deployed): https://rlsutter.github.io/Weft/

Local dev:
```
cd weft && pnpm install && pnpm --filter @weft/pwa dev
# → http://localhost:5173/
```

## Scope and safety

**Not designed for minors.** Weft v0 is not built for, tested for, or offered to users under 18. Age assurance conflicts with the no-documents identity architecture — the design work for a safe minors posture (cells and institutions as age-context bearers, charter-level minor-safe modes; DD §35 F13) has not been done. This is a stated gap, not an oversight. Communities that involve minors should not adopt Weft until that work lands in a later phase.

**Not a place to look for help in a crisis.** This is a discovery protocol between adults choosing to meet, not a mental-health, safety, or emergency service. Users in crisis should reach appropriate professional services.

---

## Start here (reading order)

1. **[`weft-manifesto.md`](weft-manifesto.md)** — one page. What Weft is and why.
2. **[`weft-overview.md`](weft-overview.md)** — plain-language introduction, comparison table with existing platforms, honest fine print.
3. **[`weft-design.md`](weft-design.md)** — the full architecture and design document. 36 sections covering discovery, hop routing, the consent handshake, trust and vouching, governance, wire formats, and media, plus two adversarial passes: twelve open problems in §16 (each now with a worked design response) and sixteen further findings in §35 (F1/F2/F5 folded into the spec; the rest open, F13 — minors — being the largest).
4. **[`weft-build-list.md`](weft-build-list.md)** — the v0 execution plan Claude Code will follow: eight milestones (M0–M8), pinned dependency stack, byte-exact wire formats, acceptance tests per task.
5. **[`weft-ux-spec.md`](weft-ux-spec.md)** — the UX specification. Normative for M6: Part IV's per-screen BUILD sections (copy strings, states, acceptance checklists) are binding the way DD §30 and §33 are for wire formats.
6. **[`STRUCTURE.md`](STRUCTURE.md)** — layout of the `weft/` application scaffold and the package boundaries.
7. **[`weft-mockup.html`](weft-mockup.html)** / **[`weft-mockup.jsx`](weft-mockup.jsx)** — UI *visual* reference for the PWA (palette, fonts, card patterns; ignore the v2 features that appear in the mockup but not in v0 — the UX spec is authoritative on scope).

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
  weft-ux-spec.md          UX specification (normative for M6)
  weft-mockup.html/.jsx    UI visual reference
  LICENSE                  dual-track licensing explainer
  LICENSE-APACHE-2.0       full text (core, sim, docs)
  LICENSE-AGPL-3.0         full text (pwa, porch)
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
2. **Persistence is inversely proportional to sensitivity** (vouch attestations are durable but private, held by their subject; handshakes evaporate in hours; relays hold only sealed, expiring envelopes).
3. **Scaling is edge-bounded by construction** (per-query cost fixed by fan-out × TTL, independent of network size).
4. **Attribute nothing by default; identity enters only where a human chooses to reveal it.**
5. **Plurality is bounded, accountability is scoped.**

---

## License

Dual-licensed by path: `weft/packages/core` and `weft/packages/sim` under **Apache-2.0**; the reference client `weft/packages/pwa` and `weft/packages/porch` under **AGPL-3.0**. Documentation under Apache-2.0. Full explanation and reasoning in [`LICENSE`](LICENSE); canonical texts in [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0) and [`LICENSE-AGPL-3.0`](LICENSE-AGPL-3.0). This split follows DD §26.2's separable-trademark posture and DD §11.5's client-plurality defense.

---

## On the name

In weaving, the *warp* threads are the fixed structure, and the *weft* is the thread that travels — carried hand to hand by the shuttle, across the warp, over and under, binding separate strands into cloth. Relationships are the warp; asks are the weft. The name keeps the heritage of "social fabric" while naming the motion instead of the venue: the traveling thread, not the finished sheet.

*The warp is already there. Come be the thread.*
