# Weft: A Post-Platform Communications Channel
## Architecture & Design Document — v0.2 (Working Draft)

---

## 0. Executive Summary

**On the name.** In weaving, the *warp* threads are the fixed structure, and the *weft* is the thread that travels — carried hand to hand by the shuttle, across the warp, over and under, binding separate strands into cloth. Here, relationships are the warp; asks are the weft. The name keeps the heritage of "social fabric" while naming the motion instead of the venue: the traveling thread, not the finished sheet.

**Thesis.** Social connection should be infrastructure, not a destination — a communications channel like email, not a platform. This document designs that channel: people discover affinity by *asking their own social graph*, voice-first, with no company, feed, or algorithm mediating.

**The stack in one pass.** A spoken interest becomes, on-device, a semantic embedding plus a few clarifying answers (§2). The resulting query hops through the user's real contacts — small-world style, TTL-bounded, shedding identifying detail per hop, guided by each device's private sketch of what its contacts care about (§3). Matches return masked; connection requires a staged, mutually-consented handshake in which identities unlock simultaneously or not at all, verified against a web-of-trust vouch chain (§4–5). Abuse is priced in social capital — postage budgets with one's own contacts, vouches that stake the voucher's standing — rather than policed by a moderator (§6). Governance scopes to consented groups with cryptographic charters, key-rotation ejection, and opt-in moderation feeds; mediators, where they re-emerge, are chosen, plural, and fireable (§7). V1 runs on Nostr as a dumb encrypted mailbox layer, with all intelligence at the edges (§8–9). Observability measures flows, never people (§10); relays are cheap enough that running one is a gesture (§11); growth is density-first along real social edges, where invitation *is* vouching (§12, §15). The UX metaphor carrying all of it: *leaving a note with a trusted friend* (§14).

**The design invariants (the test any change must pass):**
1. Encryption is layered by lifetime (§9.4).
2. Persistence is inversely proportional to sensitivity (§9.4).
3. Scaling is edge-bounded by construction (§9.4).
4. Attribute nothing by default; identity enters only where a human chooses to reveal it (§17.6).
5. Plurality is bounded, accountability is scoped (§18.6).

**Where the design is honest about tension.** §16 catalogs twelve open problems, all of which now carry worked design responses: the sensitive-interest paradox via origin-ambiguous routing, private matching, and anonymously-vouched rendezvous (§17); plural personas via unlinkable, k-bounded, scope-accountable selves (§18); the embedding model's hidden centralization via named, community-chosen, fireable semantic spaces (§19); the equity gap via institutional vouching and earnable ladders (§20); vouch economics via graduated, liability-bounded, invisible vouching (§21); OS dependency via content-free pokes and client plurality (§22); legal exposure via minimal attested payloads and duty-mapping (§23); meetup safety via group-first introductions and peer escrow (§24); standing queries as rhythm rather than registry (§25); protocol governance via a constitutional invariant test and designed-in fork rights (§26); and match quality via re-ask rates and sentinel calibration (§27). Every section names its residual risks; none claims to have eliminated its tradeoff.

**Status.** Working draft: thresholds are guesses, protocol sketches await adversarial review, and the recurring pattern worth trusting is that single mechanisms keep paying multiple bills (postage=battery, sentinels=chaff, chaff=deniability, persona credentials=anonymous rendezvous). The v0 slice is specified to build-ready depth (§§30, 33; the build list); the **v2 group and persona layers are now specified concretely in §36** (BBS+ credential engine, group key management and MLS transition, membership and ejection flows, persona lifecycle) — registry-complete and flow-complete, though built only after v0 ships.

---

## 1. Vision & Design Principles

**Thesis:** Social connection should be infrastructure, not a destination. The way email is a protocol rather than a place, discovery and communication between people should be a communications channel — with no application, company, or algorithm mediating between people and their devices.

**Core principles (design invariants):**

1. **The network is just a channel; everything that matters lives at the ends.** All intelligence — matching, routing decisions, trust evaluation — runs on user devices. Infrastructure (relays) is dumb, amnesiac, and replaceable.
2. **Trust is pairwise and earned.** No global reputation scores. Reputation is local, contextual, and private — routing hints, not public numbers. History shows visible scores get gamed (karma farming, follower counts, feedback extortion); private routing hints do not.
3. **Consent gates every escalation.** Nobody learns your identity, location, or interests except by your explicit, staged consent. Neither side of a match unmasks before both agree.
4. **Abuse is made expensive in social capital.** Spam and manipulation cost real relationships (postage, vouches, burned identities), not free pseudonyms.
5. **Forgetting is the default; remembering is a deliberate act.** Ephemeral state evaporates on schedule. Durable artifacts require explicit stewardship.
6. **Mediators, where they re-emerge, must be chosen, plural, and fireable.** Moderation feeds, rendezvous points, and relays are all opt-in, substitutable, and competitive.

**What platforms bundle that this design separates:** identity (self-owned keys), transport (dumb relays), and discovery (peer-hop semantic search). Discovery is the genuinely unsolved piece and the heart of this design.

---

## 2. Discovery: Voice → Structured Query

The user states interests verbally. The pipeline, entirely on-device:

1. **Speech-to-text** (Whisper-small class model).
2. **Semantic embedding** (~384-dim sentence embedding, ~80MB model) — meaning-based matching, so "koji experiments" matches "growing aspergillus on rice" with zero shared keywords.
3. **Clarifying dialogue** — a local agent fills the minimum slots needed to route well:

> **You:** I want to find people experimenting with koji.
> **Agent:** Are you looking to learn, swap techniques as a peer, or trade cultures and materials?
> **You:** Swap techniques, I've been at it about a year.
> **Agent:** Does location matter — meetups, shipping starters — or is anywhere fine?
> **You:** Anywhere, but bonus if nearby.
> **Agent:** A few one-on-one connections, or an ongoing group?
> **You:** A small group would be ideal.

Output: `{topic: embedding(koji, fermentation), mode: peer-exchange, skill: intermediate, geo: soft-preference, format: small-group}`.

**Dialogue rules:** Clarification is *lazy* — triggered only by genuine ambiguity; slots already answered in the utterance are never re-asked. Voice prosody and phrasing carry intent typed tags don't ("lurk and learn" vs. "trade starters" are different discovery requests routed to different match types). The agent works for the user, on the user's device — interests are *declared on the user's terms*, not inferred by surveillance.

V1 implements the dialogue as scripted slot-filling (a decision tree over {mode, geo, format, skill}) — deterministic and testable. A local LLM can replace it in v2 once good dialogue shapes are known.

---

## 3. Routing: Seven Degrees, Semantic Hops

Queries travel the user's real social graph, hop by hop, small-world style (Milgram: most humans connect in ~6 hops). Each hop makes three decisions:

**Who to forward to.** Not everyone — flooding is spam. Each device keeps a private *routing sketch*: a rough map of what its own contacts care about (per-contact interest centroid, learned passively, never uploaded). The koji query goes to the foodie friend, not the cycling club. This is semantic routing — the query follows the scent of relevant interest, which is how Milgram's letters actually found their targets.

**Whether to answer.** The receiving device compares the query embedding to its owner's declared interests locally (cosine similarity, v1 threshold ~0.75). Match → reply "possible match at N hops" without revealing identity. No match → forward or drop.

**Whether to keep going.** Each hop decrements TTL (start: 4–6) and strips a layer of detail: name and exact phrasing drop after hop 1–2; geo blurs from neighborhood → region. The query carries *postage*: forwarding spends stamp budget with your own contacts, so relaying junk costs you personally.

**Match ranking:** returned matches are ranked by hop distance and vouch strength as well as semantic score. "2 hops via Maya — peer group, 5 people" outranks "5 hops — anonymous individual" on trust even at lower semantic similarity. Hop distance *is* trust metadata.

**Load math:** fan-out 3, TTL 4 → ≤120 devices touched per query; each does a microseconds dot product and maybe a milliseconds re-encrypt-forward. Total per-query work is bounded by fan-out × TTL, **independent of network size**. A bigger network makes queries more likely to succeed within the same budget — the inverse of a central index.

**Known failure mode:** sparse graphs — queries die quietly if no path exists. Fallback tiers: the agent can offer a public rendezvous point for the topic, always labeling *which trust regime* a match came from.

---

## 4. Trust & Vouching: Compose Existing Primitives

| Function | Reuse | Notes |
|---|---|---|
| Identity | DIDs (W3C) / Nostr keypairs in v1 | Self-owned; key management is solved elsewhere — never DIY |
| Vouching | Verifiable Credentials pattern; PGP web-of-trust lineage; Nostr NIP-32/58 | Signed attestation: "known to me since 2024," with expiry |
| Reputation | Local only (Freenet-style routing feedback) | EigenTrust exists but global scores curdle into gameable metrics |
| Spam cost | Pairwise stamp/postage budgets | No blockchain; local bookkeeping between pairs of devices |
| Transport crypto | NIP-44 / Matrix / double ratchet | Boring, audited primitives only |

**Novel layer (the actual new work):** hop-aware trust semantics — the query envelope format, TTL and detail-stripping rules, masked vouch chains, and the mutual-reveal handshake. A thin protocol over robust foundations.

**Vouch mechanics:** vouches expire and require renewal (limits stolen-key damage). Revocations propagate; devices re-check cached chains. Voucher quality is tracked locally — if Maya's vouches keep producing bad matches, her vouches quietly lose ranking weight *with you*, independent of your friendship.

---

## 5. The Consent Handshake Protocol

Goal: neither side learns who the other is until both say yes; every step deniable before final reveal.

**Stage 0 — Match token.** A match reply carries: fresh ephemeral public key (unlinkable to the responder's identity), match score, hop count, masked vouch chain ("2 attestations from parties along the path").

**Stage 1 — Intent ping.** Sent back along the relay path (no direct connection; no IPs exchanged). Signed under the asker's ephemeral key: "endpoint A wants to connect re: query Q; terms offered: reveal name + vouch chain, not location." Commits to nothing identifying.

**Stage 2 — Terms matching.** The responder sees the offer and can accept, counter ("name only after first message exchange"), or **decline silently** — no rejection notice, no read receipt. A decline is indistinguishable from a dead query. This kills harassment dynamics where rejection becomes a hook, and denies spammers targeting signal.

**Stage 3 — Simultaneous reveal (commit-then-reveal).** Each device encrypts its identity payload (DID, display name, unmasked vouch chain) and sends the ciphertext. Only when both ciphertexts have arrived do devices exchange decryption keys. Abort before key exchange → nobody learned anything. Fair by construction.

**Stage 4 — Vouch verification.** Signatures checked locally against the *revealed* identity. Mismatch between the chain and the revealed DID → impersonation red flag, surfaced loudly before any substantive exchange.

**Stage 5 — Channel establishment.** Devices negotiate a direct encrypted channel (Matrix room / double-ratchet session); the relay path is dropped. Relays saw only ciphertext and routing hints throughout, and are now out of the loop.

**Protocol properties:** Asymmetric terms are legal ("you reveal; we stay pseudonymous until a member sponsors you" — sensible for support groups). All pre-reveal state carries TTLs of hours–days and evaporates on stall — no archive of who almost-connected. The *terms language* — a small vocabulary for "what I'll reveal, when, contingent on what" — is as much a UI problem as a crypto one: humans must read and set terms in two taps.

---

## 6. Threat Model & Abuse Absorption

**Hostile relay (passive):** sees ciphertext, stripped metadata, routing hints. Residual risk is traffic analysis (koji-shaped embeddings from one direction). Mitigations: pad to uniform size, batch/delay forwarding, cover traffic (v2).

**Hostile relay (active):** *Selective drop* → absorbed by 2–3 disjoint-path redundancy + local reputation noticing paths through a contact underperform. *Tampering* → signatures fail at next honest hop; query dies. *Replay* → nonces + short TTLs; replayed pings reference expired tokens.

**Man-in-the-middle match** (relay answers the query itself to unmask the asker): absorbed at Stage 4 — the impostor has no vouch chain verifiable against the asker's graph; renders as "0 verifiable vouches," a shrieking red flag. Simultaneous reveal means the impostor burns an identity to see one.

**Fake vouch chains:** *Forged signatures* fail flat — that's math. *Sybil rings* (50 sock puppets vouching for each other) form an island with no edges into the target's graph → "6 vouches, none within N hops of you" = worthless. This is the deep reason to prefer web-of-trust over global scores: Sybils inflate numbers but cannot manufacture a path through your friends without compromising a real person. *Compromised/careless vouchers*: no crypto fix for misplaced trust — absorbed by vouch expiry, revocation propagation, and local voucher-quality tracking.

**Intent-ping spam:** three stacked costs. (1) *Reachability* — no global directory of match tokens; audience bounded by graph position. (2) *Postage* — the spammer's first hop always knows them personally and throttles; the spammer strangles their own connectivity first (the elegant inversion of email, where sending is free and victims pay in attention). (3) *Silent decline* — zero feedback, nothing to optimize against. Residual: patient insider spammer → per-sender rate caps at the recipient + unmasking-to-spam burns a real vouched identity.

**Non-attack failure cases:** *Griefing by shadow-ignore* — capped at a dead query (normal background noise; the ignorer learns nothing either). *Stalking-shaped queries* (hyper-specific triangulation) — blunted by per-hop detail stripping; deep defense is that answering is voluntary and local, with client-side warnings for over-narrow queries ("matches would be identifying"), tunable by the person it protects.

**Pattern:** every defense is cryptographic, economic, or local-relational. None requires a moderator — because there isn't one. **Honest gap:** none of this handles content abuse *after* Stage 5. That is governance (§7), and it is where "no mediator" stops being purely a feature.

---

## 7. Community Self-Governance Without a Platform

Platform moderation performs five functions: rule-setting, detection, adjudication, sanctions, appeals. Without a platform, all five land on communities, with tooling to make that bearable.

**The unit of governance is the group, not the network.** There is no global space — no trending page, no public square anyone owns. Only channels people consented into. Governance scopes to "this koji group of 40," where context and intent are legible. This matches Ostrom's commons findings: small groups with clear boundaries, locally made rules, graduated sanctions, and cheap exit self-govern well. The consent handshake enforces her success conditions by construction.

**Charters are part of the terms language.** A group's rules are presented cryptographically at joining: "commercial posts removed; three strikes; appeals to rotating member juries; sponsors of removed members lose vouching weight here." Short, local, and literally consented to — versus a 40-page ToS applied by strangers.

**Sanctions = exclusion; exclusion = key rotation.** Ejection rotates the channel key without the ejected member. No content reaches into others' devices; no appeal to an authority, because there is none. Paired with **cheap exit and forking** — badly governed groups hemorrhage members who re-form under better rules. Governance quality faces competition, the discipline platforms never face.

**Three hard cases:**
1. **Cross-group reputation** (the ejected harasser joins the next group fresh). Middle path: groups publish signed *ejection attestations* ("we ejected DID-X for harassment, evidence hash attached") that other groups may subscribe to, weight, or ignore — moderation as opt-in feeds (cf. Bluesky's stackable labelers), not central verdicts. Tension: negative attestations are themselves a harassment vector → weighted by your trust in the issuer, never summed globally.
2. **Admin capture.** Mitigations: multi-signature group keys (no unilateral ejection); charters encoding rule-change procedure ("key rotation requires 3-of-5 stewards"); exit-and-fork as backstop. Bad governance can't be prevented, only made non-sticky.
3. **Content beyond any community's tolerance** (CSAM, credible threats). An encrypted P2P system has no central scanning point — the same property protecting dissidents and support groups. What remains is what remains for Signal/email: client-side evidence-preserving reporting to law enforcement, ejection + attestation, and legal exposure of humans on real devices. **This is a chosen tradeoff, stated plainly: the system refuses to build a surveillance chokepoint and therefore cannot offer platform-style content policing.**

**Prediction:** most people don't want the governance job → template charters ("fork this proven ruleset") and governance-as-a-service (respected moderation collectives whose attestation feeds groups subscribe to). This quietly reintroduces mediators — but *chosen, plural, fireable* ones, which is the point of the whole design.

---

## 8. V1 Prototype Architecture (Nostr Substrate)

**Substrate rationale:** AT Protocol assumes big indexing relays that see everything — the mediator reborn. Matrix has excellent encrypted groups but heavy servers and no fit for ephemeral hop-routing. **Nostr** offers signed JSON events, dumb store-and-forward relays, keypair identity, and permissionless custom event kinds. Key trick: "relays" in the hop-routing sense are **contacts' clients**; Nostr relays are dumb mailboxes passing encrypted notes between devices. All routing intelligence lives at the edges. Nothing locks in: the protocol *is* the client behavior, portable to any dumb transport.

**Layer 1 — Identity & vouching.** Users are Nostr keypairs (secp256k1; DIDs deferred to v2). Vouch = signed event `kind: 30xxx {subject, context, expiry}` on the voucher's relays, cached by contacts. Piggybacks NIP-32/NIP-58 patterns. NIP-02 contact lists bootstrap a *real, live* social graph for testing — the single biggest reason to pick Nostr.

**Layer 2 — Local agent.** Mobile client (React Native / Flutter): Whisper-small STT; ~80MB sentence-embedding model; scripted slot-filling dialogue (decision tree over {mode, geo, format, skill}) — deterministic and testable; LLM in v2. Private routing sketch: SQLite table of contact → interest centroid, learned passively, never synced.

**Layer 3 — Hop routing as encrypted DMs.** Query = NIP-44 encrypted event to a chosen contact subset: `{query_embedding, ttl: 4, terms_offered, ephemeral_reply_key, stamp}`. Receiving clients: match locally (cosine ≥ ~0.75) → reply to ephemeral key; else consult sketch, re-encrypt-forward to best 2–3 contacts with ttl−1 and detail stripped; decrement sender's stamp balance. **Engineering risk (named):** mobile background throttling stalls forwarding → push-notification wakeups + accept hours-scale latency. Discovery of humans is not real-time; "your query travels as your friends come online" is arguably a feature.

**Layer 4 — Handshake.** Four custom event kinds: `intent_ping`, `terms_response`, `commit`, `reveal`. All encrypted to ephemeral keys, nonced, short-expiry. Commit-reveal ≈ 200 lines over libsodium — boring on purpose.

**Layer 5 — Channel handoff.** On reveal: create a Matrix room (or exchange Signal links); invite posted in the final encrypted exchange. NIP-29 group chat is immature — don't block on it. Charters ride as a pinned signed event (human-readable rules + hash) so ejection attestations can cite "charter X, clause 3." Multi-sig keys, juries, moderation feeds: v2.

**V1 deliberately cuts (known IOUs, not design changes):** cover traffic & padding; full postage economy (simple per-contact rate limits instead); vouch revocation (expiry-only); disjoint-path redundancy (single fan-out).

**What v1 proves or falsifies:** Does hop-routed semantic search find real matches in a real graph before queries die? Honest latency? Is the terms UI usable in two taps? Cold-start: seed one existing community of 50–150 (below that, the graph is too sparse to learn anything). Team: ~3–4 people for a summer — client/agent, routing/handshake kinds, dialogue & terms UX.

---

## 9. Software Architecture: Encryption, Persistence, Scaling

### 9.1 Encryption — a key hierarchy layered by lifetime

| Key class | Lifetime | Role | Notes |
|---|---|---|---|
| Root identity key | Permanent | Signs vouches, charters | secp256k1; platform keystore (Secure Enclave / StrongBox); touches network rarely; everything else derived from it |
| Pairwise contact keys | Durable | Query forwarding | ECDH shared secret + symmetric ratchet; NIP-44 envelope in v1. **Not forward-secret** — tolerable for expiring queries; v2 wraps in double ratchet |
| Ephemeral handshake keys | Hours–days | Unlinkable match tokens | Fresh per query; generate, use, shred; never touch disk unencrypted — a lingering ephemeral key is a slow identity leak |
| Group channel keys | Rotates on ejection | Group content | Naive rotation O(n) fine ≤150 members; **MLS (RFC 9420)** with O(log n) tree keying beyond — conveniently matching the governance argument that groups stay small |

**Cross-cutting rules:** *Sign inside, encrypt outside* — relays authenticate nothing, see nothing; tampering detected at endpoints. **Embeddings are plaintext-equivalent**: a good embedding decodes to approximate meaning via nearest-neighbor lookup, so embeddings get full encryption discipline in transit and at rest.

### 9.2 Persistence — three stores, opposite requirements

**Client store (the real database):** SQLite + SQLCipher. Tables: contact graph & cached vouches; routing sketch; active query state; stamp ledger; group state (charters, membership, key history for own archive). Two special disciplines:
- Query state **must** die on expiry — a background reaper, not lazy deletion; lingering handshake state is the recurring privacy leak.
- The routing sketch is **lossy by design** — an exponentially decayed centroid per contact, not a log of their answered queries. The device should know "Sam ≈ food-adjacent," never "Sam answered these eleven queries" — the latter is surveillance sitting on your own phone waiting to be stolen or subpoenaed.

**Relay store (deliberately amnesiac):** a mailbox, not an archive. Per-kind retention: queries/pings expire in days; commit/reveal in hours; vouches persist (meant to be public-ish). Nostr supports per-kind retention as configuration. A seized relay yields ciphertext, routing metadata, and nothing older than the window: **the honeypot is designed to be empty.**

**Group archives (the tension point):** messages live on members' devices; history is as durable as their phones; new members see nothing pre-join (key rotation enforces this anyway). V1 embraces it: groups are conversations, not archives. Durable artifacts (the koji wiki) are explicit, separately encrypted blobs a steward maintains on any dumb storage (relay, IPFS, a Raspberry Pi). Forgetting default, remembering deliberate — correct posture, and cheaper.

**Backup & recovery (the unglamorous killer):** lose the root key → lose identity and every vouch received. V1 minimum: encrypted export (root key + SQLite snapshot under a passphrase). V2: **social recovery** — Shamir 3-of-5 across trusted contacts. Your friends are already your infrastructure.

### 9.3 Scaling — the load lives at the edges

- **Per-query cost is fixed** by fan-out × TTL (≤120 devices; μs dot products, ms re-encrypts), independent of network size. Growth increases success probability, not cost — the opposite of a central index.
- **Per-node inbound load** scales with *your own* graph: a 500-contact node relays hundreds of queries daily — trivial CPU, but battery/radio-relevant. Clients batch (wake on push → drain queue → sleep) and enforce per-contact inbound caps. **The postage economy and the battery budget are the same mechanism.**
- **Relays scale as dumb message queues** (append blob, index by recipient+kind, serve subscriptions, expire on schedule). No global state; users multi-home across 2–3 relays; a $5 VPS suffices. Subtlety: **metadata clustering** — one relay serving a whole community mirrors the social graph in traffic even with opaque payloads → multi-homing now, cover traffic later.
- **Gets genuinely harder with scale:** (1) *Vouch-chain verification* — at 6 hops you can't cache the world's vouches, so chains must travel *with* match tokens, self-contained and offline-verifiable. Decide this format early; painful to retrofit. (2) *Routing-sketch drift* — stale centroids misroute silently → build observability now (§10), because in a system with no center, nobody else can see discovery rot.

### 9.4 The three invariants (write them on the wall)

1. **Encryption is layered by lifetime** (permanent identity → durable pairwise → ephemeral handshake → rotating group).
2. **Persistence is inversely proportional to sensitivity** (vouches live forever; handshakes evaporate in hours).
3. **Scaling is edge-bounded by construction** (per-query cost fixed; per-node cost capped by one's own social graph).

Any v2 feature violating one of these must justify itself explicitly.

---

## 10. Observability Without Surveillance

**The problem:** a decentralized system can rot invisibly — routing sketches drift, queries die in sparse regions, handshakes fail on a UX bug — and there is no ops dashboard because there is no ops. But every conventional observability pattern (central metrics collection, user analytics) is exactly the surveillance this design exists to refuse. The resolution: **measure the system, never the people**, and make every measurement public, noised, and opt-in.

### 10.1 What each client measures locally (always, for its own user)

Every client computes private health counters over rolling windows:

- **Query survival rate** — fraction of outbound queries producing ≥1 match reply before TTL/expiry.
- **Hops-to-match distribution** — are matches arriving at 2 hops or straining at 5? Rising hop counts signal sketch drift or graph sparsening.
- **Dead-query ratio** — the sparse-graph early-warning signal.
- **Handshake funnel** — intent pings sent → terms matched → reveals completed. A falling completion rate is a UX or trust-design problem, not a network problem; the funnel tells you which stage bleeds.
- **Forwarding health** — inbound queries relayed vs. dropped, stamp-throttle events fired, per-path success rates (this last one already exists as the private routing-reputation ledger).
- **Vouch anomalies** — verification failures, chain/identity mismatches (the impersonation signal, worth counting even at n=1).

These stay on-device and are shown to the *user* first: "your queries are dying at hop 2 — your network may be too sparse for this interest; want to try a rendezvous point?" Observability doubles as honest UX.

### 10.2 How aggregate health gets shared (opt-in telemetry beacons)

- Clients that opt in publish a **signed health event** (a custom kind) weekly to public relays: a handful of counters, *bucketed and noised*.
- **Local differential privacy** before publication: randomized response / calibrated noise on each counter, so no individual beacon is reliable about its sender — only the aggregate over many beacons converges to truth.
- **Coarsening rules:** counts in buckets (0, 1–5, 6–20, 20+), time in whole weeks, no topic or embedding information *ever*, no geography finer than continent, and no beacon at all for interest areas where the local match count is below a k-anonymity floor (rare interests are identifying by existence).
- **Anyone can aggregate.** Beacons are public signed events; a researcher, a client developer, or a community steward pulls them from relays and computes network health. No central collector, no privileged view — the same amnesiac relays carry them.
- **The schema is protocol, versioned, and visible.** The client shows exactly what it reports ("6 noised counters, weekly — toggle off"), and any schema addition is red-teamed against one question: *could this metric, alone or joined with others, deanonymize a person or reveal an interest?* If plausibly yes, it doesn't ship.

### 10.3 Active measurement: sentinel pairs

Passive beacons can't measure end-to-end routing quality without exposing real queries — so measure with fake ones. **Consenting volunteer nodes form sentinel pairs**: node A periodically emits a synthetic query with a known target embedding held by node B, several hops away. Whether and how fast it arrives is a clean end-to-end probe of routing health — latency, hop inflation, drop rates — using traffic that contains nothing about anyone. Bonus: sentinel traffic is indistinguishable from real traffic to relays, so **the measurement doubles as cover traffic** — the observability system and the traffic-analysis defense are the same mechanism (a recurring pattern in this design: postage=battery, sentinels=chaff).

### 10.4 Relay-side observability

Relay operators publish their own ops metrics (queue depth, retention config, uptime, event counts by kind) as signed events about *infrastructure*, involving no user data — the relay never had any to leak. Clients use these for multi-homing decisions; the community uses them to spot relay concentration (§11).

### 10.5 Alarm conditions and what they mean

| Signal | Likely cause | Response |
|---|---|---|
| Rising dead-query ratio | Sparse graph region, or seed community losing density | Cold-start intervention (§12); rendezvous fallback promotion |
| Hop inflation (matches arriving farther out) | Routing-sketch drift | Sketch decay-rate tuning; prompt users to refresh declared interests |
| Falling handshake completion at Stage 2 | Terms UI confusion or trust mismatch | UX iteration on the terms language |
| Falling completion at Stage 3–4 | Protocol bug or active attacker probing | Engineering escalation; check vouch-anomaly counters |
| Vouch verification failures clustering | Impersonation campaign | Client warnings; publicize the pattern (not the people) |
| Beacon participation dropping | Trust in telemetry eroding | Governance conversation, not a technical fix |

**The invariant for this section:** every metric describes flows, rates, and failures — never identities, interests, or edges of the social graph. If the observability layer were fully public (it is) and fully subpoenaed (it can be), it should read as a weather report, not a census.

---

## 11. Relay Economics

**Why this is a solvable problem:** relays are dumb, amnesiac mailboxes. The unit costs are tiny and the design *removes* the expensive parts of running a platform — no content moderation staff (nothing readable to moderate), no recommendation infrastructure, no growth team. What remains is commodity storage and bandwidth over short retention windows.

### 11.1 Cost model (order-of-magnitude)

- Events are KB-scale ciphertext blobs with days-scale retention. A user generating a few hundred events/month costs fractions of a cent in storage and pennies in bandwidth.
- A $5–10/month VPS comfortably serves a community of thousands. There is no per-user database of consequence — retention windows bound storage regardless of history length.
- The cost curve is flat and boring, which is the point: **relays should be so cheap that running one is a gesture, not a business.**

### 11.2 Who runs relays, and why (four sustainable models)

1. **Community-run** (the aligned default): a group's steward runs the relay its members multi-home to — the clubhouse-rent model. Dues of $1/member/year over-cover it. Incentives align perfectly: the operator serves people who can fire them by re-homing, and shares their privacy interests.
2. **Patronage / hobbyist**: the Nostr precedent — individuals run public relays because infrastructure-as-gift is a real motivation at $10/month price points. Fragile alone, fine as one strand of a multi-homed set.
3. **Paid relays**: small subscriptions for larger mailboxes, longer retention, higher rate limits, or uptime SLAs. Freemium works here precisely because the free tier is nearly costless to provide.
4. **Institutional**: libraries, universities, co-ops, unions — organizations with public-interest mandates and existing infrastructure, for whom "we run a mailbox that can't read anyone's mail" is an easy commitment.

### 11.3 What the economics deliberately excludes

- **No ad model is possible, by construction.** Relays see ciphertext; there is nothing to target against. The data business is not prohibited — it is *architecturally impossible*, which is sturdier than any policy promise. The empty honeypot (§9.2) is also an empty balance sheet for surveillance capitalism.
- **No token/blockchain layer.** The postage economy is pairwise local bookkeeping; introducing a speculative asset would import volatility, regulation, and gaming incentives into a system whose whole trust model is social. (Nostr's optional sats-for-relay payments are compatible with model 3 without being load-bearing.)

### 11.4 Market discipline and failure modes

- **Multi-homing keeps relays honest.** Switching cost is near zero (repoint the client at another URL), so relays compete on reliability, retention policy, and published ops metrics (§10.4). A relay that misbehaves is fired by config change.
- **Relay concentration** — everyone drifting to two big free relays — is the real risk: it recreates a metadata chokepoint (traffic graphs mirror social graphs even with opaque payloads) and a single point of failure/coercion. Mitigations: client defaults that *spread* users across relays rather than ranking a "best" one; community-run relays as the promoted default; concentration visible in the public relay metrics so it can be named and resisted.
- **Free-rider collapse** — mostly defused by trivial costs, but the community-relay model makes the funding unit match the benefiting unit.
- **Hostile subsidized relays** — an adversary running excellent free relays *for* the traffic analysis. Mitigations: multi-homing (no single relay sees the whole path), sentinel/cover traffic (§10.3), retention limits capping what patience buys, and relay reputation lists — themselves opt-in, plural, and fireable, like every mediator in this design.

### 11.5 Client economics (the other half)

The client is where real costs live: on-device models, battery for relaying, development. The honest funding options are the boring ones — open-source with foundation/grant support, paid apps, or bundled community subscriptions ("your group dues cover the relay and support client development"). What the client must never be is monetized against the user's data — one violating client would poison trust in the whole protocol, so the protocol's answer is substitutability: any client speaking the event kinds interoperates, and a bad client is as fireable as a bad relay.

---

## 12. Cold-Start Playbook

**The brutal fact:** hop-routed discovery works in proportion to graph density. Below a critical mass of connected, active users, every query dies, every user's first experience is a ghost town, and nothing is learned except that empty networks are empty. The playbook is therefore *density-first, breadth-never (yet)*.

### 12.1 Seed selection

- **One pre-existing community, 50–150 people** (Dunbar-scale), with a real social graph *already* — a fermentation Discord, a running club, a maker space. They bring edges, shared context, and native query demand.
- Selection criteria: (a) members largely know each other (density), (b) genuine sub-interest diversity so discovery has something to discover (the fermentation group contains koji people, natto people, cheese people), (c) an energetic steward willing to run the community relay and own the charter, (d) an existing communication channel for coordinating the migration.
- **Below ~50 the graph is too sparse to route anything and the experiment is uninformative. Do not soft-launch broadly** — a thousand unconnected curious sign-ups is worse than useless; it manufactures the ghost-town experience at scale.

### 12.2 Onboarding = graph import = trust bootstrap

- **Invitation is vouching.** Joining requires an existing member's invite, and the invite *is* a signed vouch event. Every new node arrives with ≥1 real edge and ≥1 real attestation — the graph and the trust layer bootstrap in the same gesture. A waitlist gated by vouching is not exclusivity theater; it is a density-preservation mechanism.
- First-run flow: accept invite → keys generated → speak 2–3 interests to the agent (populating the local interest set *and* seeding contacts' routing sketches as early queries flow) → contact list pre-warmed from the inviter's community membership (with consent).

### 12.3 Training wheels: the concierge rendezvous

- V1 ships with **one community rendezvous node** — a public-square fallback for the seed's broad topic — so that early queries *cannot* fail totally while the graph's routing sketches are still cold. Every match is labeled with its trust regime ("via community square" vs. "2 hops via Maya"), preserving the design's honesty.
- **Sunset rule, decided in advance:** when hop-routed matches exceed rendezvous matches for N consecutive weeks (observable via §10 beacons), the rendezvous demotes to explicit-fallback-only. Training wheels that never come off become the platform again.

### 12.4 Generating query flow (a discovery network with no queries is dead)

- **Rituals**: a weekly "ask the network" prompt from the steward; themed weeks; a norm that new members' first act is a spoken query. Query volume is the lifeblood — routing sketches learn from flow, and §10 metrics are meaningless without it.
- Instrument from day one: the seed community is the laboratory, and beacon opt-in should be near-universal there (they're collaborators, not users).

### 12.5 Success gates before community #2

| Gate | Threshold (initial guess — tune) |
|---|---|
| Query survival | >60% of queries matched within 48h |
| Hop routing share | Hop-routed matches > rendezvous matches |
| Handshake completion | >70% of mutually-interested handshakes complete |
| Retention | >50% of onboarded members active (querying or relaying) at week 8 |
| Qualitative | Members report matches they would not have found in their existing channel |

If gates fail, iterate in place — thresholds, dialogue design, terms UX — rather than adding people to a broken loop.

### 12.6 Growth topology: expand along real edges

- **Community #2 is chosen by graph overlap, not by market logic.** Find the *bridge people* — seed members who also belong to another dense community (the fermenter who's also in the pottery guild). They become literal hop-paths between communities; discovery across the bridge is the first real test of >2-hop routing and detail-stripping.
- Each new community repeats the full playbook (steward, relay, charter, rendezvous with sunset rule). Growth is a chain of dense cells linked by bridges — a small-world network built the way small worlds actually form — rather than a thin gas of disconnected users.
- **The metric that matters across cells:** cross-community match rate. When someone in the running club finds a koji group through a bridge at 3 hops, the seven-degrees thesis has its first proof.

### 12.7 What not to do (anti-playbook)

- No press launch, no app-store push, no open registration until several cells and bridges exist — breadth before density is fatal and unrecoverable (first impressions of emptiness don't get a second chance).
- No engagement mechanics to fake liveliness (streaks, notifications-as-growth-hacks) — importing platform pathologies to solve a density problem contradicts the founding thesis.
- No seeding with fake/bot matches, ever. The system's entire value is that a match is a real person reachable through real trust. One discovered fake poisons the well permanently.

---

## 13. Roadmap & Open IOUs

**V1 → V2 debts (each is a known IOU, not a design change):**

| IOU | Trigger to pay it |
|---|---|
| Forward secrecy on pairwise channels (double ratchet) | Before any at-risk-population community joins |
| Cover traffic & padding (partially prepaid by sentinels, §10.3) | When traffic-analysis threat becomes concrete / at public visibility |
| Full postage economy (beyond rate limits) | First observed spam campaign |
| Vouch revocation propagation | First key-compromise incident, or before cell #3 |
| Disjoint-path redundant routing | When single-path drop rates become visible in beacons |
| Self-contained vouch chains traveling with match tokens | **Decide format now** — retrofit is painful (§9.3) |
| MLS group keying (**now specified, §36.2**) | First group >150 members |
| DIDs / key rotation | Before identity portability matters (cell #3+) |
| Social recovery (Shamir 3-of-5) | With DID migration |
| LLM clarifying dialogue | After scripted-dialogue learnings from seed |
| Governance tooling (multi-sig charters, juries, attestation feeds) (**now specified, §36.2**) | First real governance crisis in a cell |

**Open design threads:** the terms-language vocabulary and its two-tap UI; rendezvous-node protocol details; attestation-feed subscription format; economic sustainability of client development at scale.

---

*This document consolidates a collaborative design session (July 2026). It is a working draft: every threshold is an initial guess, every protocol sketch awaits adversarial review, and the three invariants in §9.4 are the test any future change must pass.*

---

## 14. UX Design: Lowest-Friction, Intuitive

**The governing metaphor: asking a trusted friend to ask around.** Not "posting," not "searching a database" — *asking around*. Every screen, word, and wait state reinforces it. This metaphor does heavy lifting: it makes hours-scale latency feel natural (friends aren't instant), makes silence feel normal (sometimes nobody knows anyone), and makes trust legible (you know *how* you know someone).

**Five UX laws for this product:**

1. **Voice in, cards out.** Speaking is the primary input; everything the system says back is a short card with at most two actions.
2. **Crypto is invisible.** No keys, hashes, DIDs, or hop-TTLs ever on screen. Trust renders as human sentences: "a friend of Maya's," "vouched by Maya Chen since 2024," "nobody you know can vouch for this person."
3. **Two taps to any decision.** Terms, matches, charters — every consent moment is a pre-filled card with sensible defaults, editable by toggle, confirmed by one tap.
4. **Silence is designed, not apologized for.** Dead queries, declines, and waiting are first-class states with honest, calm copy — never spinners, never guilt.
5. **No feed. Ever.** The home screen is a short list of your asks and your conversations. When it's empty, it's empty. The absence of infinite scroll is the product's spine, not a missing feature.

### 14.1 Onboarding (target: under 90 seconds, zero typing except a name)

1. **Tap Maya's invite link** → app opens to a single card: *"Maya Chen invited you — and vouches for you. That means people here can trust you're real, because she says so."* One button: **Join**.
2. Keys generate silently in the background (platform keystore). No password, no email, no phone number. *There is no account — there is a key, and the user never needs to know that yet.*
3. **"What should people call you?"** — one text field, the only typing in onboarding.
4. **"Tell me a couple of things you're into — just talk."** Big mic button. The user rambles for fifteen seconds; the agent reflects back three interest chips ("koji & fermentation," "trail running," "film photography") with an ✕ on each. Tap to correct, or continue.
5. Done. Home screen. A dismissible banner appears *the next day*, not now: *"If you lose this phone, you lose your identity here. Take 1 minute to back up?"* (Backup nudged post-hoc — never a friction gate on day one.)

### 14.2 Home screen

Three zones, top to bottom, no navigation bar needed in v1:

- **The mic button** — large, centered, hold-to-talk. The one verb of the app: *Ask*.
- **Asks out in the world** — each active query as a slim card with a living status line written in the metaphor: *"Traveling… reached friends of friends"* → *"3 people are looking at this"* → *"1 match came back."* A quiet ripple animation, no percentages, no hop counts. Expired asks fade out with *"This one didn't find anyone — networks have gaps. Ask again anytime, or try the town square."*
- **Conversations** — established channels and groups, ordered by recency. That's it. Below the fold: nothing.

### 14.3 The ask flow (speak → chips → confirm)

1. **Hold, speak, release.** Transcript appears immediately, editable by tapping words.
2. **Clarifying chips, not questions-as-text-entry.** The agent asks at most three, each answered by tapping a chip:
   - *"Looking to…"* → `learn` `swap as peers` `trade materials`
   - *"Location…"* → `anywhere` `prefer nearby` `must be local`
   - *"Hoping for…"* → `a person or two` `a small group`
   Chips the utterance already answered are skipped (lazy clarification, §2). Total interaction: three taps, five seconds.
3. **Confirmation card in plain words:** *"Ask my network for: a small group swapping koji techniques, intermediate level, anywhere (nearby is a bonus). Your name stays hidden until you both agree to connect."* Buttons: **Send it** / edit. The privacy promise is stated *on the card, every time* — it's the product's core claim, so it's said where it matters, not buried in settings.
4. After send: *"Your ask is traveling. Answers usually come within a day or two, as friends come online."* — expectation set once, honestly, then the app gets out of the way. No push notifications about progress; only about results.

### 14.4 A match arrives

Notification: *"Someone 2 hops away matches your koji ask — a friend of Maya's."*

The **match card**:

- **What's known:** "A small group, 5 people, meets monthly. Intermediate. Same region as you."
- **The trust line, in human words:** "The path to them runs through **Maya** — she trusts the person who trusts them." (For distant matches: "6 hops away — nobody you know can vouch for them yet." Rendered in a cooler visual tone, never as a warning per se — distance is information, not danger.)
- **The exchange, as two columns:** *They'll share:* name, vouches. *They ask you to share:* name, vouches. Each item is a toggle; defaults mirror what the user offered when asking.
- Two buttons: **Connect** / **Pass**. Pass is silent by design, and the UI says so once, the first time: *"Passing is invisible — they'll never know."* This single sentence teaches the harassment-proofing without a word of theory.

### 14.5 The reveal moment (make the ceremony felt, not explained)

On mutual consent, the card **flips** — one small, deliberate animation in an otherwise still app — from the masked silhouette to: *"**Bob Tanaka** — vouched by Maya Chen (since 2024) and Priya S. (fermentation group)."* Then a message box, already focused.

If verification fails (§5, Stage 4), the flip never happens; instead a flat red card: *"This person's vouches don't check out — the endorsements were for someone else. This looks like impersonation. We've closed the connection."* One button: **OK**. (Optionally: *"Tell Maya?"* — routing the social-layer repair through the social layer.)

### 14.6 Joining a group: the charter as a front porch

Before entering any group channel, one scrollable card — **House rules** — of at most ~6 short lines ("No selling. Three strikes. Disputes go to two rotating members. Your sponsor answers for you at first."), with the group's steward names at the bottom. Button: **Agree & join**. The cryptographic charter-signing happens invisibly beneath the tap. Template charters mean most groups' porches look reassuringly familiar.

Ejection, from the ejected side, is equally plain: the conversation grays out with *"This group has closed its door to you."* No public shaming surface exists — there is nowhere for one to be.

### 14.7 Honest surfaces (settings that read like disclosures)

- **"What leaves this phone"** — one screen, plain sentences: *"Your asks travel as scrambled meaning-codes, not words. Your name travels only when you tap Connect. If you've turned on network health sharing, 6 blurred counters leave weekly — here's this week's, exactly as sent."* Showing the actual outbound beacon is the trust move: radical legibility instead of a privacy policy.
- **"Your people"** — the contact graph with per-person forwarding: *"Sam can send asks through you: ~20/week"* with a slider. This is the stamp economy wearing a human face.
- **"If you lose your phone"** — the backup/recovery flow, framed socially in v2: *"Pick 5 friends; any 3 can help you recover."*

### 14.8 Anti-patterns (banned by design review)

- No unread badges except actual matches and messages. No streaks, no "X people asked about topics like yours," no re-engagement pushes. The app must be *comfortable being closed* — its success metric is matches made, not minutes spent (§12.7).
- No global search box. Its absence *is* the mental model: there is no index of people; there is only asking.
- No visible scores of any kind — not reputation, not response rates, not member counts beyond a group's rough size. Numbers invite optimizing; sentences invite judgment.
- Never the word "request" (transactional), "profile" (there isn't one), or "network" in copy — it's *"your people."*

**The one-sentence UX spec:** it should feel like leaving a note with a trusted friend — brief to write, safe to wait on, and warm when an answer comes back.

---

## 15. Direct Invitations (Contacts, Email, Phone)

**The principle that governs everything here:** the address book is the most intimate dataset on a phone, and uploading it is the founding sin of platform social apps ("find your friends" = "give us everyone's number"). This design never transmits the contact list — not hashed, not partially, not once. The device uses contacts *locally* to help the user address an invite; the network only ever sees that a signed invite token was redeemed.

### 15.1 Mechanism: the invite is a pre-signed vouch

An invite is a small signed object generated on the inviter's device:

`{invite_id, inviter_pubkey, vouch_template: {context: "personal invite", expiry}, single_use: true, expires: 14d, signature}`

- Encoded as a deep link (and QR code for in-person invites).
- **Single-use and expiring.** Redeemed once, then dead; unredeemed tokens evaporate in 14 days and are revocable before redemption from an "invites out" list.
- On redemption, the invitee's freshly generated key is bound to the token, and the vouch finalizes — creating simultaneously: an identity, a graph edge, a trust attestation, and a pairwise stamp relationship. One link does all four (§12.2's "invitation is vouching," now with transport).

### 15.2 The three entry paths (all ending in the same token)

1. **From contacts:** tap **Invite a friend** → the *OS contact picker* opens (the app never reads the address book; the OS hands back only the single person chosen) → the app composes a pre-filled message containing the link → it sends via the user's *own* SMS or email app through the share sheet. No server ever learns who was invited or how to reach them. The invitee's name/number never leaves the phone — it was only used to address an envelope the user's own messenger carries.
2. **By email/phone entry:** identical flow minus the picker — type an address, the OS mail/SMS composer opens pre-filled. The typed address is used once, locally, and not stored.
3. **In person:** show a QR of the same token. Zero metadata anywhere, strongest binding (you're looking at them).

Batch invites = repeating the flow; each contact gets an individual single-use token. No "select all."

### 15.3 Securing the weak link: SMS and email are postcards

The token travels over unencrypted channels, so a forwarded or intercepted link could let a stranger redeem Maya's vouch. Absorbed by a **redemption confirmation** step:

- When a token is redeemed, the *inviter* gets a card: *"Someone just joined with the invite you sent to Bob. Their name reads 'Bob T.' — is this your Bob?"* **Confirm** finalizes the vouch; **That's not them** voids it, leaving the redeemer with a valid identity but *zero vouches* — a key with no edges, which in this system is inert (§6, Sybil analysis: identities are free, paths through real people are not).
- Until confirmation, the invitee can use the app but their vouch line reads "invitation pending Maya's confirmation" — honest state, no dead air.
- This turns link theft from an impersonation vector into a no-op, without adding any friction to the honest path (one tap for Maya, usually within the hour).

### 15.4 Invitation economics (same immune system as everything else)

- Outstanding invites are capped (e.g., 10 unredeemed at a time) and each *confirmed* invite is a real vouch — meaning the inviter's local reputation with their own contacts is on the line for who they bring in (§7: "the sponsor of a removed member loses vouching weight"). Inviting is cheap in taps and expensive in social capital, exactly the design's signature move.
- No referral rewards, ever (§12.7 anti-playbook: growth mechanics that pay people to invite manufacture low-trust edges, which poison routing).

### 15.5 What is deliberately absent: "find friends already here"

The familiar feature — hash everyone's phone numbers, match against a server — is omitted, and not as an oversight. Hashed phone numbers are trivially crackable (the number space is small enough to brute-force), so the feature is address-book upload with extra steps. If contact discovery ever ships, it must use private set intersection (v2+ cryptography, real engineering cost) — until then, the honest answer is: *you find your friends by inviting them, and they find theirs the same way.* Density grows along real edges, which is the cold-start playbook anyway (§12.6).

### 15.6 UX surface (additions to §14)

- **Home screen**, beneath Conversations: a quiet **"Bring a friend"** row — never a badge, never a prompt, never "your network is too small!" nagging.
- **Invites out** list: pending tokens with *sent-to* labels (stored locally only), each with **Revoke**.
- Confirmation cards (§15.3) arrive as ordinary match-style cards, one tap to resolve.
- Copy stays in the metaphor: not "grow your network" but *"vouch for someone you trust."* The button text can simply be: **Invite & vouch** — teaching, in two words, that bringing someone in means standing behind them.

---

## 16. Open Problems, Design Gaps, and Areas of Concern

An honest adversarial pass at our own design. These are unresolved — some are engineering debts, but several are genuine tensions where the design's own principles collide.

### 16.1 The sensitive-interest paradox (sharpest protocol gap)

Detail-stripping starts *after* hop one — which means **your first-hop contacts see your queries with your identity attached**. For koji, fine. For "I'm questioning my faith," "I think I'm trans," "I need help leaving my marriage," the people best positioned to route your query — your friends — are often exactly the people you cannot let see it. The system's core trust mechanism (route through people who know you) is inverted for precisely the queries where discovery matters most; the rendezvous fallback exists but offers the *least* trust exactly when the stakes are highest. Possible directions, none free: first-hop blinding (contacts relay queries they can't read — but then semantic routing breaks at hop one), decoy attribution ("someone among N of my contacts asks…" — k-anonymity at the first hop), or per-query "skip these people" exclusion lists (which leak by omission if implemented naively). This needs real design work before any community with vulnerable members joins.

### 16.2 The embedding model is a hidden mediator (sharpest philosophical gap)

Matching requires every device to compute *comparable* embeddings — meaning everyone runs the same model, or compatible ones. That model is a chokepoint we reintroduced without naming it: **whoever trains and versions the embedding model decides what meanings exist and which concepts are near each other.** A model trained mostly on English tech-adjacent text will match some communities' vocabularies crisply and mangle others'; two dialects of the same interest may never find each other; and a model *update* silently reshuffles the semantic map (yesterday's 0.78 match is today's 0.64 — discovery rots on upgrade day, §10's drift alarms notwithstanding). Cross-language matching compounds it: "seven degrees" across a multilingual world requires multilingual embeddings, which are weakest exactly for low-resource languages. Mitigations to explore: pinned model versions negotiated per-query (compatibility handshake), community-chosen models as part of a cell's charter, published model provenance. But the honest statement is: *the semantic layer is centralized even when the network is not*, and pretending otherwise would be the design lying to itself.

### 16.3 Pseudonymity vs. Sybil defense (a principles collision)

The Sybil defense assumes identities are socially expensive; real life requires that people be *plural* — the same person legitimately needs a professional self, a recovery-group self, a political-organizing self, with no linkage between them. But every unlinked persona is, mechanically, a Sybil: it starts with zero vouches and no graph edges, i.e., inert (§15.3 celebrates exactly this inertness). So the design currently forces a cruel choice: link your personas (context collapse — the thing that makes platform identity dangerous) or start each persona friendless. Directions: per-context derived identities with *selective, unlinkable* vouch transfer (cryptographically possible via blind signatures / anonymous credentials — real complexity), or persona-scoped vouching ("Maya vouches for this pseudonym's holder without learning which friend it is"). Unsolved, and load-bearing for exactly the sensitive communities in 16.1.

### 16.4 Vouch reluctance and social chilling (the sociology may not cooperate)

The entire economy prices actions in social capital — which works only if people spend it. But if sponsoring a member who later gets ejected costs *me* standing (§7), the rational move is to vouch rarely and blandly. PGP's web of trust died partly of exactly this: signing felt like liability, so people didn't. Too-cheap vouching is Sybil fuel; too-expensive vouching starves the graph. The tuning between them isn't a constant — it varies by community norms — and we have no mechanism for communities to tune it, nor evidence for where the healthy band lies. Related: the postage/throttle mechanics ask users to (implicitly) rate their friends' relay-worthiness, and people are historically terrible at, and made miserable by, rating friends.

### 16.5 Platform dependency we glossed over (the OS is a mediator)

Layer 3 quietly depends on **push-notification wakeups** — which route through Apple/Google infrastructure: a centralized metadata point (who gets woken, when, correlated with what) and a kill switch. Worse: the entire client lives or dies by **app-store approval**, and both stores have histories of removing E2E/P2P apps under government pressure. An architecture whose thesis is "no mediator" runs, in practice, on the sufferance of the two biggest mediators in computing. Partial outs — web/PWA clients, F-Droid/sideloading, unified push alternatives — all trade reach or battery or iOS entirely. This deserves a named strategy, not a shrug.

### 16.6 Legal exposure nobody has resolved (for this or any similar system)

- **GDPR right-to-erasure vs. signed attestations:** a vouch and especially an *ejection attestation* ("we ejected DID-X for harassment") is personal data, cryptographically signed, cached across many devices and relays with no controller to petition. Expiry helps; it is not erasure.
- **Who is the "provider"?** DSA, the UK Online Safety Act, and similar regimes assume an operator with duties. Here there is a protocol, volunteer relays, and client developers. Regulators may simply assign the duties to whoever is findable — likely the client developer — regardless of architectural reality. §7.3's honest tradeoff (no scanning chokepoint) is also a legal posture that some jurisdictions are actively legislating against (client-side scanning mandates).
- **Relay operator liability** for ciphertext they cannot read varies wildly by jurisdiction and remains chilling for the community-run model (§11.2's aligned default).

### 16.7 The equity gap: invite-vouch reproduces social capital

You join through someone who already belongs. The socially isolated — new arrivals, the elderly, the rural, people estranged from their communities — are precisely those with the fewest inviting edges *and* plausibly those for whom affinity discovery matters most. A system that grows along existing social edges structurally amplifies existing social advantage. Rendezvous points are the pressure valve, but "the well-connected get the trust network; the isolated get the public square" is a two-tier outcome the design should be uncomfortable with. No good answer yet; worth stealing ideas from community-sponsorship models (libraries, community centers as institutional inviters — §11.2's institutional relays could double as institutional *vouchers*).

### 16.8 Accessibility of voice-first

Voice as the primary input excludes deaf and hard-of-hearing users, people with speech differences, and anyone in a situation where speaking aloud is unsafe (which correlates with 16.1's sensitive interests — the person who can't say it out loud is often the person who most needs to ask). Text entry must be a co-equal path, not a fallback — and the prosody-as-intent idea (§2) needs an explicit line drawn: inferring *slots* from phrasing is fine; inferring *emotional state* from voice is a capability the design should refuse on principle, since it's inference the user didn't declare.

### 16.9 One-shot asks vs. standing interest (an unmodeled lifecycle)

Everything designed so far is a one-shot query with a TTL. Real discovery is often ambient: "keep an ear out for koji people." Standing queries change the privacy calculus entirely — a persistent interest registered across the graph is closer to a profile than an ask, and staleness compounds (people's interests drift; their standing queries don't). Needs explicit design: renewal rituals, decay, and honest UI about what a standing ask reveals over time.

### 16.10 Protocol governance (who versions the commons?)

Event-kind schemas, the terms-language vocabulary, embedding-model versions, beacon schemas — someone stewards these. Today's answer is "the initial developers," which is fine until the first contested change. Options range from rough-consensus RFC processes to charter-style multi-stakeholder stewardship, but a system this allergic to central authority needs its *own* governance designed with the same care as §7 — including the right to fork the protocol itself, and what happens to network effects when someone does.

### 16.11 The last mile: in-person safety

Matches become meetups. The design's duty of care currently ends at Stage 5, but the risk curve *peaks after it* — this is where dating apps and marketplace apps accrue their worst harms. Cheap, protocol-consistent affordances exist and are absent: meet-in-public nudges for first meetings, a "share this connection with a friend" escrow (tell Maya who you're meeting, automatically), and post-meet private feedback that feeds only your own local trust ledger. None of this requires a platform; all of it requires designing.

### 16.12 Match quality has no ground truth

We can measure that matches *happen* (§10) but not that they're *good* — and bad matches erode trust in the whole system silently, one disappointed handshake at a time. Self-reported match quality is the obvious signal and the obviously gameable one. The private routing ledger absorbs some of this (bad paths get demoted), but "the network confidently delivers mediocre matches" is a failure mode no current alarm catches.

**Meta-observation:** the pattern across 16.1, 16.3, 16.7, and 16.8 is that the design's costs concentrate on vulnerable and marginal users — the exact people a post-platform system claims to serve better. That's the tension to hold while prioritizing: the elegant mechanisms (vouching, hop-routing, social postage) all assume a user rich in trusted edges, safe to speak, and singular in identity. The next design cycle should start from the user who is none of those things.

---

## 17. Resolving the Sensitive-Interest Paradox (§16.1)

### 17.1 Restating the problem precisely

A query arrives at first-hop contacts on the pairwise channel, attributed to its author. Therefore: **your friends learn what you're looking for.** For most asks this is the feature — friends route best. For a class of asks (questioning faith, sexuality, leaving a relationship, health fears, escaping a community), the first hop *is* the threat model. The people with the routing knowledge are the people who must not know. And the current fallback — the rendezvous square — offers the least trust at the highest stakes.

Name the adversaries, because the solutions differ per adversary:

- **A1 — the curious friend:** honest-but-nosy; reads what their client shows them.
- **A2 — the controlling contact:** a family/community member inside your contact list, actively watching (the domestic-abuse and high-control-group case).
- **A3 — colluding contacts:** several of your contacts comparing notes ("did you get her query too?").
- **A4 — a compromised contact device:** full protocol visibility at one hop.

### 17.2 The key realization: the protocol never needed the author's name

Audit why hop-1 queries carry identity at all: they don't need to. Replies route via the **ephemeral reply key and reverse-path routing** — each forwarder briefly remembers `query_id → arrived from X` and passes replies backward. Nothing in matching, postage, or reply delivery requires the origin to be named. Attribution at hop 1 was an unexamined default, not a requirement. Remove it, and every query a contact receives is structurally identical whether the sender **authored it or is relaying it**.

This is the *Crowds* insight (Reiter & Rubin, 1998): in a network where everyone forwards for everyone, receiving a message from Sam means only "Sam, or someone behind Sam." The property is called **plausible deniability of origin**, and it converts the first hop from an exposure into ambiguity.

Two supporting changes make the deniability real rather than cosmetic:

1. **Randomized initial TTL.** If fresh queries always start at TTL 6, a TTL-6 query fingerprints its receiver's neighbor as the author. Instead, initial TTL is drawn from a distribution (or Crowds-style probabilistic termination), so TTL reveals only fuzzy distance.
2. **Chaff is already in the budget.** The sentinel/cover traffic of §10.3 means real queries swim among synthetic ones. Deniability is statistical — "one of the queries passing through Sam's channel might be Sam's" — and chaff sets the denominator. This is the third time one mechanism has paid two bills (postage=battery, sentinels=chaff, chaff=deniability).

**What this costs:** hop counts become estimates, so the trust line in the match card softens from "2 hops via Maya" to "arrived through people Maya trusts" — an acceptable blur, since the vouch chain (not the hop integer) was always the real trust carrier. Routing sketches learn "interests flowing *through* Sam" rather than "Sam's interests" — slightly noisier, and honestly more private for Sam too. Postage and spam throttling are unaffected: they're per-channel volume accounting and never needed origin.

**What this does NOT solve:** the contact still sees the query's *meaning* (the embedding decodes). Against A1 in a busy network, ambiguity suffices. Against A2 in a *quiet* network — the controlling spouse watching a channel that carries three queries a month — "someone near you is asking about leaving" is still a fire alarm. Origin ambiguity is necessary, not sufficient.

### 17.3 Hiding the meaning: coarse routing, private matching

The deeper fix separates what routing needs (a *direction*) from what matching needs (the *specifics*), and stops letting relays see the specifics at all.

- **Route on coarse facets.** A sensitive-flagged query carries only a locality-sensitive hash bucket of its embedding — a coarse tag on the order of "health-adjacent" or "relationships-adjacent," deliberately sized so thousands of distinct interests share a bucket. Relays route on the bucket. A watching contact learns "a health-ish query passed through," which is the ambient truth of any network and nearly information-free.
- **Match on encrypted specifics.** The fine embedding travels encrypted to the ephemeral reply key. When a candidate's device sees a bucket it plausibly serves, the *match test itself* runs as a private threshold comparison over the ephemeral channel — a small secure two-party computation in which each side learns one bit ("above/below threshold") and neither learns the other's vector. Only mutual above-threshold proceeds to the normal handshake.
- **Cost:** routing precision drops (coarse buckets misroute more; expect more hops and more dead queries — the price is paid in latency, which §14's expectations already absorb), and the private comparison is real cryptographic engineering (v2+, but well-trodden: this is private similarity testing, not exotic research).

Against A2 and A3, this reduces the leak to bucket-level traffic patterns. Against A4 (compromised device), the compromised hop still learns only bucket + ciphertext — the fine meaning is never plaintext at relays.

### 17.4 Fixing the fallback: the rendezvous should not be trust-zero

The complaint was that maximum sensitivity gets minimum trust. **Anonymous credentials** repair this: a user can prove, in zero knowledge, "I hold at least one valid vouch from within this network" — without revealing *whose* vouch or *which* identity (blind signatures / BBS+-style credentials; the same machinery §16.3 needs for plural personas, so it's one investment paying two debts). A sensitive-topic rendezvous can then require *anonymously-proven-vouched* entry: everyone in the room is a real, vouched person; nobody in the room is identifiable. That is a genuinely new kind of space — the accountability of the web of trust with the anonymity of the crowd — and it's arguably the *right* venue for the most sensitive discovery, better than friend-routing could ever be.

### 17.5 The user-facing surface: choose how it travels

The protocol layers become one honest choice at ask time. After the confirm card (§14.3), one additional line for any ask — never auto-classified into visibility, always user-controlled, with local-only gentle suggestion ("this sounds personal — want it to travel more privately?" is computed on-device and can be turned off):

> **How should this travel?**
> ○ **Through friends** — fastest, and people close to you may see what's asked (never that it's you, but near you).
> ○ **Deniably** — through friends as coarse whispers; specifics stay sealed until a match. Slower.
> ○ **Anonymously** — to a vouched-members-only square. Nobody, including friends, sees anything.
> Plus: **"Never through…"** — exclude specific people or circles from ever carrying this ask.

On exclusion lists and leak-by-omission (§16.1's worry): under origin ambiguity, a contact *not* receiving a query proves nothing — they can't distinguish "excluded" from "the path didn't come my way," which is most paths most of the time. Exclusion becomes safe to offer once attribution is gone; another reason 17.2 comes first.

### 17.6 Rollout order and the honest residuals

1. **v1.5 — origin ambiguity** (strip attribution, randomize TTL, reply-path bookkeeping): small protocol change, large safety gain, ship before any vulnerable community joins.
2. **v2 — coarse-route/private-match** for sensitive-flagged asks.
3. **v2/v3 — anonymous-credential rendezvous**, shared machinery with plural personas (§16.3).

Residual risks that remain after all three, stated plainly: a *global* traffic observer (not in our threat model, but named) correlating timing across many channels; an A2 adversary with physical access to the asker's own unlocked device, which no routing protocol addresses (device-level duress features — hidden asks, decoy state — are a different design conversation worth having); and the unavoidable fact that *answering* a sensitive match still ultimately means trusting a stranger, where §16.11's meetup-safety work picks up.

**The reframe worth keeping:** the paradox dissolved once we noticed the design was carrying an assumption it never needed — that queries name their authors. The lesson generalizes and belongs next to the §9.4 invariants: **attribute nothing by default; let identity enter only where a human chooses to reveal it.** Every future feature should be audited against it.

---

## 18. Plural Personas (§16.3): Unlinkable Selves With Bounded Plurality

### 18.1 The tension, stated as requirements

One human legitimately needs several unlinked selves — a professional self, a recovery-group self, an organizing self. The Sybil defense (§6) works *because* fresh identities are inert: no vouches, no reach. So the persona machinery must square four requirements that pull against each other:

1. **Unlinkability** — no observer (contact, group member, relay, or the personas' own counterparties) can connect persona P to root R or to sibling personas.
2. **Inherited legitimacy** — P must be able to prove "a real, vouched human stands behind me" *without* saying which one, or it's inert.
3. **Bounded plurality** — the same proof must not let one root mint unlimited trusted faces, or personas are Sybils with a pedigree.
4. **Sticky accountability** — a community must be able to eject P *and have the ban hold*, even though it can never learn who P is.

Requirements 1+2 are the §17.4 machinery. Requirements 3+4 are new, and they're where the interesting cryptography lives.

### 18.2 The mechanism, layer by layer

**Derivation.** Personas are hierarchically derived from the root key (hardened derivation, so siblings and root are cryptographically unlinkable, yet one backup — §9.2's social recovery — covers every self). Nothing about a persona's key betrays its lineage.

**Inherited legitimacy without naming the voucher.** Vouches are already signed credentials; upgrade them to an anonymous-credential scheme (BBS+-class). R can then derive, for any persona, a zero-knowledge presentation proving statements like *"I hold an unexpired vouch from an issuer in this set"* — where the set is, say, all vouch-issuing keys in a cell or region. The proof names no issuer and no subject; its anonymity set is the whole community, not Maya. Crucially this hides the issuer too, because proving "Maya vouched me" would place P one hop from Maya — which is most of the way to unmasking. Selective disclosure comes free: P can prove "vouched since before 2025" or "member of a fermentation cell" as separate, unlinkable predicates.

**Bounded plurality: k-show credentials.** The anonymous credential is issued as a *k-show* credential per epoch (a well-studied construction: each showing produces a fresh unlinkable token, but showing more than k times in an epoch produces an arithmetic collision that flags — and cryptographically identifies — the cheater). Concretely: a root's vouch entitles it to stand behind at most, say, **3 active persona-attestations per quarter**. Within the bound, personas are unlinkable even to each other; exceed it, and the over-spend itself deanonymizes the root — cheating is not detected by anyone watching, it is *self-incriminating by construction*. The Sybil math changes from "identities are free" to "trusted faces cost 1/k of a real vouched human each, hard-capped."

**Sticky accountability: scope-exclusive pseudonyms.** Within any given context — one rendezvous, one group — a persona's identifier is a *scoped pseudonym*: deterministically derived from (root, context), unlinkable across contexts, but **fixed within one**. The consequences are exactly what governance needs: a root can present only one face per room, ever. Eject that pseudonym and the ban sticks — the root cannot re-derive a fresh face for that scope, because the derivation is deterministic and the k-show credential can't be re-shown there. The community banned someone it can never identify, *and the ban holds*. (This is the nullifier pattern from anonymous-signaling systems, put to work as door policy.) Ejection attestations (§7) work unchanged: they name the scoped pseudonym, which is precisely as much identity as the scope ever had.

**Epochs double as revocation.** Credentials expire per epoch and must be renewed against the underlying vouch. Maya revokes her vouch to R → at the epoch boundary, every persona-presentation that leaned on it silently stops renewing. Revocation propagates to personas *without anyone learning the personas existed*.

### 18.3 What a persona honestly trades away

A persona cannot have the warm trust line. "2 hops via Maya — she trusts the person who trusts them" *is* linkage; that's not a bug to fix but the price of unlinkability. A persona's trust renders differently and more coldly: *"a vouched member of this community — identity sealed."* Its match cards carry anonymity-set trust, not path trust. Its queries route via rendezvous (or its own earned graph — see lifecycle), never via the root's contacts, because riding the root's channels is traffic-analysis linkage. The UX must say this plainly at persona creation: **a new self starts warm enough to enter, but it earns its own way from there.** And it can: people who know only the persona can vouch *the persona*, first-class, and over time P accumulates its own graph, its own stamp relationships, its own reputation — at which point it is simply an identity, indistinguishable from anyone's, whose origin story never mattered to the protocol. Graduation is the design's quiet promise: pseudonymity that can mature into standing.

### 18.4 Sybil re-analysis with personas in play

- *Mint-and-flood one room:* impossible — one scoped pseudonym per root per room.
- *Mint across many rooms:* capped at k faces per epoch per real vouch; the attack costs real vouched humans at ratio k:1, and each face banned is banned forever in its scope.
- *Get vouched, misbehave, get revoked, re-enter:* epoch renewal fails; all faces expire together.
- *Launder trust by having personas vouch each other:* sibling vouches are just fresh-identity vouches — an island with no path into any real graph (§6's Sybil-island analysis applies unchanged; the anonymous machinery grants entry proofs, not graph edges).
- *Collusion — rent someone's k-budget:* real humans lending their vouch-standing to an attacker is the same "compromised voucher" problem as §6, with the same social/temporal absorptions — no new surface, but the k-budget makes the lending *quantifiable*, which arguably helps.

### 18.5 Persona lifecycle and UX surface

- **Creation:** from settings — never mid-flow, to avoid accidental cross-contamination — "Start a separate self." Speak the context ("this is for my recovery stuff"); the device derives keys, requests epoch credentials, and opens a visually distinct shell (different accent color derived from the persona key — the user always knows which self is speaking; contamination-by-mistake is the #1 practical linkage risk).
- **Separation hygiene the protocol can't do for you, said out loud:** the creation flow warns, once, plainly: *"The network can't link your selves. Your habits can — the same rare interests, the same phrasing, the same hours of the day. Keep this self's world separate."* Stylometry, schedule correlation, and rare-interest fingerprinting are real deanonymization vectors that no key derivation fixes; the design's duty is honest warning plus defaults that help (persona-scoped interest lists with an overlap warning: "this ask closely matches one from your main self — that similarity is linkable").
- **Compartment safety:** personas are hidden behind a separate unlock by default (relates to §17.6's duress residual — for some users, a persona's *existence on the device* is the danger). A duress-mode conversation (decoy state, hidden shells) is flagged as its own future design pass.
- **No persona directory anywhere:** the root's device knows its selves; nothing else does, including backups' custodians (Shamir shares reconstruct the root key; derivation reconstructs the selves; the shares reveal neither).

### 18.6 Rollout and shared machinery

The credential scheme is the same investment as §17.4's anonymous rendezvous — build once: (1) BBS+-class vouch credentials with hidden-issuer set proofs; (2) k-show issuance per epoch; (3) scoped pseudonyms/nullifiers for rooms. Sequencing: ship §17's layers first (origin ambiguity needs no cryptography and protects everyone), then the credential stack, then personas as its second client. Persona support should exist **before** any at-risk community is invited — for those users it isn't a power feature, it's the entry condition.

**Residuals, plainly:** behavioral linkage (stylometry, timing, interest overlap) is bounded only by user discipline plus warnings; a global traffic observer correlating a root's and persona's network activity from the same device/IP remains out of scope of the routing layer (a persona used over the same home connection is linkable to that connection — mitigable with transport-level tools, but that's an honest dependency to state); and k, the plurality bound, is a governance constant with no natural value — too low and it rations selfhood, too high and it cheapens vouches. Like §16.4's vouching economics, it likely belongs in cell charters rather than in the protocol.

**The invariant this adds (append to §9.4 and §17.6's):** *plurality is bounded, accountability is scoped* — anyone may be several selves; no one may be unlimited selves; and every self answers, permanently, within each room it enters.

---

## 19. The Embedding Model as Hidden Mediator (§16.2)

### 19.1 Applying the design's own rule to itself

The diagnosis stands: matching requires comparable embeddings, so a single blessed model is a central authority over *what meanings exist* — exactly the kind of mediator this design exiles everywhere else. The resolution is not to eliminate the mediator (semantic coordination is irreducible: two devices matching vectors must agree on the space) but to subject it to the document's own standard: **chosen, plural, and fireable.** Concretely, the semantic layer becomes governed infrastructure with five properties.

### 19.2 Models are named, versioned, and open

Every query envelope carries a **model identifier** — a content hash of open weights plus documented training provenance. No hash, no match: an unnamed semantic space is an unauditable one. Models are protocol infrastructure like event kinds, stewarded under the same governance the protocol itself needs (§16.10), and *anyone may train a candidate* — adoption, not permission, is the gate. This converts "whoever controls the model" from an invisible fact into a visible, contestable choice.

### 19.3 Communities choose their semantic space

A cell's charter names its model the way it names its rules. This is where the plurality has teeth: a Yoruba-speaking cell adopts a model strong in Yoruba rather than inheriting one that mangles it; a technical community picks a space with fine-grained jargon resolution; a general cell takes the commons default. The model becomes an instrument the community holds, evaluated by the community — each cell can maintain a small local benchmark (phrase pairs its members consider obviously-similar and obviously-different) and *test candidate models against its own language* before adopting. "Does this model understand us?" becomes an empirical, local question, answered before it silently costs anyone matches. Observability closes the loop: beacons already carry match-rate counters (§10.2); adding the model-version dimension (bucketed, as ever) makes a model that is failing some community visible as divergent survival rates — semantic rot gets an alarm, per §10.5.

### 19.4 Version transitions without flag days

A model update reshuffles the similarity map, so upgrades are **dual-embedding overlap periods**: during migration, queries and declared interests carry vectors under both versions; matching prefers same-version comparisons; routing sketches re-learn under the new space while the old one still works. The overlap ends per-cell when its beacons show the new space matching at parity. Nobody experiences upgrade day as the day discovery broke — the failure mode §16.2 predicted becomes a managed, measured transition.

### 19.5 Bridging across spaces — honestly downgraded

Cross-cell discovery between different models needs translation between embedding spaces. Learned alignment maps (Procrustes-style, trained on public anchor phrase sets) do this serviceably but lossily — and the design's obligation is to *say so*: a cross-space match carries a visible confidence downgrade ("matched across communities — looser fit"), the same honesty grammar as trust-regime labels (§3) and cross-dialect humility. Bridge quality is itself measurable against the anchor sets and publishable alongside relay metrics. Where bridges are weak — which will correlate with low-resource languages — the gap is at least *named and quantified* rather than silently swallowed, and it becomes a fundable, attackable target (§20 picks this up as an equity obligation).

### 19.6 Reducing the dependence itself

Two hedges shrink how much power any semantic space holds. **Lexical side-channels:** an ask may pin explicit user-chosen tags that must match verbatim — communities whose vocabulary every model mangles can fall back to their own words; the embedding proposes, the lexicon disposes. **Private fine matching** (§17.3) already moves the *decisive* comparison to a direct exchange between the two endpoint devices, which may use richer, locally-agreed comparison than the routing layer's coarse space — the routing model only needs to get the query *near* the right people, softening how much its biases decide final outcomes.

**Residual, plainly:** plural models fragment the network's semantic reach (that's the cost of firing a universal authority — same trade as federated moderation), and someone must actually train good models for under-served languages: plurality creates the *slot* for them, not the models themselves. The mediator is not gone; it is demoted from sovereign to supplier.

---

## 20. The Equity Gap (§16.7): Ladders Into the Trust Network

### 20.1 Reframing: tiers are inevitable; unclimbable tiers are the failure

Trust must be earned somehow, so a system with earned trust will always have an inside and an edge. The equity failure is not that tiers exist — it's a two-tier outcome with **no ladder**: the well-connected inherit the trust network, the isolated get the public square, permanently. The design obligation is that every tier is climbable from below, by behavior, without pre-existing social capital. Three ladders, plus measurement to keep the design honest.

### 20.2 Ladder one: institutions as vouchers of first resort

§11.2 identified libraries, community centers, clinics, unions, and congregations as natural relay operators; the deeper role is **institutional vouching** — these organizations already perform trust-conferral for the unconnected (a library card is an identity attestation requiring no friends). An institution holds a vouching key governed by its own public charter; its vouches are honest about their nature: *"vouched by Oakland Public Library — in-person onboarding"* — a different flavor than friendship, weighted by receiving communities like any attestation (§7), but categorically better than nothing, and issued through the strongest binding the protocol has (in-person QR, §15.2). Staff-assisted onboarding also answers §16.8's accessibility duty for elderly and low-tech users. The named risk: institutions are gatekeepers with their own exclusions and biases — which is why they are *a* ladder, plural and local, never *the* door.

### 20.3 Ladder two: standing earned at the square

§18's graduation path — a cold identity that earns vouches from people who know only its behavior — was built for personas, but notice: **an isolated newcomer is structurally identical to a fresh persona.** The machinery generalizes into an earnable ladder with three rungs:

- **Open rendezvous** exist (clearly labeled as the lowest-trust regime, rate-limited against spam) — anyone may enter and participate with zero capital.
- **Provisional vouches** become a first-class credential type: *"met at the square; several good exchanges; provisional."* Weaker than a friendship vouch, honest about its basis, cheap enough to give that §16.4's vouch-reluctance bites less — the voucher stakes little, states little, and the vouch expires fast unless renewed.
- **Greeter stewardship:** cells may run front-porch programs — members who spend time at open squares specifically to meet, converse with, and provisionally vouch newcomers. This formalizes what healthy communities do anyway, and cell charters can recognize greeting as stewardship (§7's governance-as-service, pointed outward). Guarding against greeter exhaustion and capture is a charter problem, deliberately kept local.

The rungs compose: square → provisional vouch → entry to vouched spaces → real relationships → full-graph standing. Every rung is behavioral. None requires arriving with friends.

### 20.4 Ladder three: seed equitably, and cheaply by design

Cold-start selection (§12.1) optimizes for social density — and density is *not* affluence: a mutual-aid network, a union local, a mosque, a tenants' association are superb seeds by every §12 criterion, and choosing them is a deliberate act of counter-programming against the tech-adjacent default the founding team's own graph would otherwise produce (the playbook's "grow along real edges" would faithfully replicate the founders' demographics forever if the first cells aren't chosen against that gradient). The protocol's own economics help more than most systems': KB-scale envelopes suit low-bandwidth and prepaid data; hours-scale latency tolerates intermittent connectivity (§8's "feature, honestly"); the v1 embedding model must be sized for old cheap phones as a *requirement, not an optimization* — if the reference client needs a flagship device, the equity conversation is already lost. Text remains co-equal with voice throughout (§16.8).

### 20.5 Measuring the ladder (or admitting there isn't one)

Add to the beacon schema (bucketed, noised, per §10.2): **entry-tier mobility** — of identities that entered via open squares or institutional vouches, what fraction hold ≥1 relationship-vouch after 8 weeks? That single number is the equity audit. If it trends toward zero, the system is a gated community wearing open-protocol clothes, and the honest responses are to say so publicly and to treat it as a P0 — because a discovery network that only discovers the already-connected has failed its founding premise, not merely a metric.

**Residual, plainly:** ladders reward time and social energy, which are themselves unequally distributed; institutional vouching imports institutional bias; and no mechanism here reaches the person who never hears the system exists. The design can lower the wall and build the rungs — it cannot conjure the first step someone else's outreach must provide.

---

## 21. Vouch Economics (§16.4): Making Generosity Rational

### 21.1 Learning from the autopsy

PGP's web of trust died of a specific pathology worth naming precisely: its signatures were **binary, permanent, public, and context-free** — every signing felt like co-signing a loan of unbounded term. Each property is reversible, and this design already reversed two (vouches expire; vouches carry context). The remaining economics work is bounding liability and removing performance pressure.

### 21.2 A graduated vocabulary lowers the price of the first rung

One vouch type forces every voucher to price the worst case. Instead, three tiers with honest semantics and proportionate stakes: **provisional** ("met at the square, good exchanges" — expires in weeks, stakes almost nothing, §20.3), **contextual** ("known from the fermentation group" — vouches for conduct in a domain), and **relationship** ("known personally since 2024" — the strong claim). Receiving communities weight them accordingly (§7's local-weighting handles this with no new machinery). Most reluctance dissolves when saying *something true and small* becomes possible — the PGP signer's dilemma was having only a megaphone.

### 21.3 Bounded, decaying liability

The sponsor-accountability mechanic (§7) must not mean reputation death by one bad call. Two bounds: sponsor stake **decays as the vouched person earns independent vouches** — you co-sign their entry, not their life; once they stand on their own graph, your name quietly steps back — and per-incident cost is **capped and recoverable** (a voucher whose judgment proves consistently bad fades in weight; one mistake does not). Liability that is bounded, decaying, and private is liability people will actually take on.

### 21.4 No performance, no ratings

Vouch counts are never displayed anywhere — vouching is testimony, not a leaderboard, and invisibility removes both status-farming and comparison anxiety. Renewal is a one-tap annual ritual ("still know Sam? — yes"), defaulting to lapse, so the graph self-cleans without anyone having to *withdraw* a vouch (withdrawal is socially expensive; lapse is free). And the friend-rating discomfort (§16.4's postage worry) is dissolved by never surfacing it: throttle tuning is automatic device behavior; the only user-visible control is a per-person forwarding *capacity* slider framed as "how much of my battery Sam's asks may use" — a resource question, not a judgment of Sam.

### 21.5 Instrumenting the healthy band

The tuning constants (vouch weights, decay rates, the persona bound k) have no natural values and belong in cell charters (§18.6). What the protocol provides is the gauge: beacon counters (bucketed, §10.2) for vouch issuance rate, renewal rate, and provisional→relationship conversion. Starvation (issuance falling toward zero — PGP's death) and inflation (promiscuous vouching — Sybil fuel) are both visible as trends, and both are §10.5-style alarms. **Residual:** economics can make generosity rational; only culture makes it habitual — seed cells (§12) set the norms everyone else inherits, which is one more reason their selection matters.

---

## 22. OS Dependency (§16.5): Living on Sufferance, Deliberately

### 22.1 The two dependencies, separated

They differ in kind: **push infrastructure** (APNs/FCM) is a metadata and availability dependency; **app-store distribution** is an existential one. Different mitigations.

### 22.2 Push: content-free pokes, batched

The push payload is always the empty poke — "check your mailbox" — never content, never sender. Apple/Google learn only wake timing. Even that is blunted: relays **coalesce and randomly delay pokes** (poke at most every N minutes, jittered), so wake timing decorrelates from message arrival; the mailbox model (§9.2) means delay costs latency, never data. Transport is layered by platform: UnifiedPush where available (Android/F-Droid), OS background-fetch polling as the universal floor (degraded to hours — which §14's expectations already absorb), APNs/FCM as the convenience tier. The design's tolerance for latency, adopted for social reasons, turns out to be its independence from push monopolies — the fourth time a property has paid two bills.

### 22.3 Distribution: no single binary is the network

The protocol is the product; clients are plural by design (§11.5), and that is also the survival strategy: reference apps in the stores, a PWA (web push now viable even on iOS, with limits), F-Droid and direct APK on Android, desktop clients untouched by mobile gatekeeping, and EU-style sideloading where regulation provides it. Preparedness is a feature: the app ships an **"if this app disappears"** screen — PWA address, sideload instructions, key-export path — cached locally from day one. A store takedown then degrades reach; it cannot erase identities (keys are the user's), relationships (pairwise state), or the network (other clients). **Residual, plainly:** iOS-without-store means PWA-only in most jurisdictions; polling costs battery; and the strategic fact stands — this architecture runs on the sufferance of the two largest mediators in computing, and the design's answer is not defiance but *redundancy priced in advance*.

---

## 23. Legal Exposure (§16.6): Architecture as the First Brief

*(Design-side preparation, not legal advice; any deployment needs counsel per jurisdiction.)*

### 23.1 Minimize what cannot be erased

The GDPR-vs-signatures conflict is real, so shrink its surface: signed payloads carry **pseudonymous keys, context codes, and dates — never names** (display names resolve locally from one's own contact store and are never in attested payloads). Ejection attestations carry an evidence *hash*, with evidence held only by the ejecting group. What is cryptographically unerasable is thereby nearly contentless. For erasure requests, the protocol norm is **tombstone propagation**: a subject-signed revocation event that compliant clients honor by deleting cached attestations — best-effort, like email deletion, stated honestly. Expiry-by-default (§9.2's amnesiac posture) is storage-limitation compliance built into the architecture rather than bolted on.

### 23.2 Let duties land where they can be met

The ecosystem's roles map onto existing legal categories deliberately: **relays** as mere-conduit/caching intermediaries (encrypted blobs, short retention, published abuse contact and policies — the good-faith posture that intermediary protections were written for); **client developers** as software publishers in the E2EE-messenger tradition, a category with regulatory precedent; **the protocol** stewarded by a foundation (§26) with published governance, sited thoughtfully. Plural, jurisdictionally distributed clients and relays mean no single order stops the network — fork-resilience is legal resilience. Two architectural facts do real compliance work and should be documented as such: there is **no recommender system and no feed** (a large fraction of platform-duty regimes attaches precisely to those), and there is no data honeypot to breach, retain, or disclose (§9.2).

### 23.3 The mandate collision, stated in advance

Client-side scanning mandates collide with invariant 4 and the §7.3 posture. The foundation's position is published before it is tested: the reference client will not ship scanning; jurisdictions that require it will be served, if at all, by other clients making their own choices — plurality cuts both ways, and saying so beforehand is the only honest version. **Residual:** regulators may assign duties to whoever is findable regardless of architecture; relay-operator risk varies by jurisdiction and chills §11.2's community-run default; this section reduces exposure, it does not eliminate the need for counsel and, eventually, precedent.

---

## 24. Meetup Safety (§16.11): The Last Mile, Designed

### 24.1 Route first meetings through groups

The cheapest structural fix: discovery already prefers matching people *to small groups* (§2's format slot, §14's match card), and a first encounter at a group's regular meetup — public, witnessed, hosted — is categorically safer than a cold 1:1. Cell charters can adopt it as a norm ("first-timers come to the monthly"), and the agent can gently prefer it ("they meet monthly — that's a natural first hello"). The safest introduction is the one that never needed a safety feature.

### 24.2 The escrow: tell Maya

For 1:1 meetings, one tap — **"Share this meetup with someone"** — sends a chosen contact the match card, time, and place over the existing pairwise channel, and arms a check-in timer: at T+90 minutes the user's device asks "all good?"; silence escalates to the escrow contact with the shared details. Entirely peer-to-peer, no platform, no server ever knowing a meeting occurred — the safety net is, once again, one's own people. Optional live location for the *escrow contact only* (never the match) extends the terms language (§5) to the physical world: what I reveal, to whom, contingent on what.

### 24.3 Before and after

**Before:** match cards surface subscribed ejection attestations (§7) against the counterpart's scoped pseudonym — a red flag visible at the moment it matters, weighted as always by trust in the attesters. **After:** a one-tap private debrief ("glad you met? yes / meh / something was wrong") feeds only the local routing ledger and, bucketed, the §27 quality signal; "something was wrong" offers the charter-governed path — report to the group steward with the evidence in hand. There is no public rating of humans, ever; the feedback rates the *match*, and its worst consequence for anyone is quieter routing. **Duress affordances** (quick-exit to a decoy screen, one-gesture escalation to the escrow contact) join §18.5's compartment-safety pass as a dedicated design cycle. **Residual:** no protocol prevents harm between people in a room; this layer shortens response time, adds witnesses, and puts the user's own trusted people in the loop — the honest ceiling of what software can do, and worth every line.

---

## 25. Standing Queries (§16.9): Rhythm, Not Registry

### 25.1 The reframe that removes the profile

A standing interest implemented as persistent network state is a profile — the thing this design refuses. Implemented as **rhythm**, it is nothing but ordinary asks: the device re-emits the query on a decaying schedule (weekly at first, easing toward monthly), each emission a normal ephemeral, origin-ambiguous, TTL'd ask that evaporates like any other. Persistence lives solely on the asker's own device; the network never holds a standing record. Ambient discovery is achieved as *repetition*, and every §17 protection applies at each beat. The rhythm is also the value: it is how standing needs meet people who joined last week.

### 25.2 Staleness, and what repetition reveals

Every standing ask carries a **renewal ritual** — quarterly, one tap: "still looking for koji people?" — defaulting to expiry on silence, so drifted interests die of neglect rather than haunting the graph. The symmetric surface matters more: **declared interests** (what makes one *matchable*) are the true standing exposure, and get identical treatment — expiry, renewal prompts, and per-interest reach settings (matchable by friends / by the vouched / by anyone; §17.5's travel modes, pointing inward). Repetition's residual leak is honest and mitigated: the same coarse bucket pulsing through the same channels accumulates inference over months, so emissions **rotate their first-hop subsets and jitter their schedule**, swimming in the standing chaff (§10.3). The privacy screen (§14.7) states it plainly: a standing ask reveals more over time than a single one — here is what, and here is the dial.

---

## 26. Protocol Governance (§16.10): A Constitution and the Right to Leave

### 26.1 Rough consensus, with the invariants as constitution

Specs — event kinds, the terms language, beacon schemas, the model registry (§19.2) — are stewarded by a small foundation whose only powers are editorship and trademark. Changes move by public RFC and rough consensus; **the five invariants function as a constitution**: any proposal violating one carries the burden of proof and an explicit supermajority bar, formalizing §9.4's "must justify itself." The foundation holds no token, no equity, no fee stream from the protocol (§11.3's exclusions are also capture-resistance): there is deliberately little to capture. Funding is grants and published-books memberships; steward seats rotate; security fixes get a fast track with post-hoc review.

### 26.2 Adoption is ratification; forking is the check

The real legislature is the installed base: version fields ride every envelope (the §19.2 negotiation pattern, generalized), cells choose what they speak in their charters, and a spec nobody adopts is a document, not a law. The **fork right is designed in**: specs and reference code are libre-licensed, the trademark is separable (a fork takes the code, not the name — the Matrix/Nostr precedent), and the failure behavior of a fork is graceful by construction — pairwise channels keep working (cryptography doesn't consult governance), while discovery fragments along version lines, visibly, in the beacons. Exit pressure disciplines the stewards exactly as it disciplines group admins (§7) and relays (§11.4): the same medicine at every layer. **Residual:** rough consensus structurally favors those with time and fluency — the §16.7 equity echo at the meta level — and no mechanism substitutes for governance culture; the constitution can only make betraying it expensive and legible.

### 26.3 The concrete license choice (resolves §35 F14)

"Libre-licensed" above is now pinned to a specific dual-track split, chosen because the two halves of the codebase serve opposite goals. The **protocol engine** (`core`, `sim`) and the **documentation** are **Apache-2.0** — maximally permissive, so *any* client, including commercial or closed ones, can embed the engine and speak the protocol. That directly serves the client-plurality defense (§11.5): the more independent clients exist, the less any single one can capture users, and permissive licensing removes the last friction to writing one. The **reference client** (`pwa`, `porch`) is **AGPL-3.0** — copyleft with the network-use trigger — so a hosted, closed, data-harvesting fork of the *reference client specifically* is not possible; anyone offering a modified reference client over a network must publish their modifications. This is the poison-the-well concern from §11.5 answered directly: the engine is free for everyone to build on, but the blessed client cannot be quietly turned against its users. The trademark remains separable from both (a fork takes the code, not the name — the Matrix/Nostr precedent), so "Weft" names the governed protocol while the code flows freely. The split is recorded in the repository's `LICENSE` file and enforced per-package by a CI check (build-list M0-T0); changing it is a §26.1 constitutional matter, not a maintainer's discretion.

---

## 27. Match Quality (§16.12): Ground Truth Without Asking

### 27.1 The signals nobody has to be surveyed for

Quality proxies already exist as local facts on the endpoints' own devices: did the handshake complete; did the conversation persist past a few exchanges, past four weeks; and — the elegant one — **was the same ask re-issued after a "successful" match?** The re-ask rate is a confession no survey could extract: if people keep asking for what the system already "found" them, matching is confidently mediocre, and this is detectable without asking anyone anything. These feed the local routing ledger (paths that produce durable connections quietly gain weight) and, bucketed and noised, the beacons — where *matches leading to 4+ week conversations* becomes the network's north-star counter, and *re-ask-after-match* its shame metric (§10.5 gains both alarms).

### 27.2 Calibration, light feedback, and the line not crossed

Embedding thresholds (§8's cosine ~0.75) stop being folklore: **sentinel pairs (§10.3) extend to carrying known-good and known-bad synthetic query/interest pairs**, manufacturing calibration ground truth with zero human exposure — threshold tuning becomes an experiment cells can run from their charters. On top, at most one optional tap after a match matures ("glad you connected? yes / meh"), feeding only the local ledger and aggregate counters: never shown to the counterpart, never attached to a person, nothing farmable — it rates the match, not the human, and its entire blast radius is quieter routing. **The line, drawn deliberately:** the quality of the *relationship* is not the system's to measure. Persistence proxies are the honest ceiling; a design that tried to score friendship would have rebuilt, in its final section, everything it was written against.

---

## 28. Serverless Bootstrap: The Website Is a Printing Press, Not a Post Office

### 28.1 The deployment model in one sentence

A static website distributes signed client software; people carry it to their communities; each community becomes sovereign — its members' devices plus a mailbox or two it chooses. Nothing about the website participates in any network it spawns: no accounts, no API, no directory, no telemetry endpoint. It can be mirrored, cached, seized, or lost without touching a single running cell.

### 28.2 What the site actually is

Static files on commodity hosting (Pages-class, ~$0), containing: the **PWA** (installable, runs the full client in-browser), direct **APK** download, desktop builds, the steward kit (§28.4), and the docs. Because the site is the one centralized bootstrapping artifact, it gets the supply-chain treatment: **reproducible builds, releases signed by published foundation keys, update verification client-side** (the app trusts the signature, never the domain — TUF-style), content-addressed mirrors (IPFS + multiple domains), and the §22 "if this site disappears" page cached into every install. Seizing the domain inconveniences new downloads; it cannot reach existing users, whose updates verify against keys, not URLs.

### 28.3 The zero-dollar network, level by level

- **Level 0 — two people, one room:** install the PWA, exchange invite QRs (§15.2's strongest binding). For mailboxes, v1 needs *some* relay — and the existing public Nostr relay ecosystem is a commodity already running: since every event is ciphertext and relays are amnesiac mailboxes (§9.2), borrowing strangers' relays costs nothing in trust. **A functioning two-person network costs $0 and requires deploying no infrastructure whatsoever.**
- **Level 1 — a cell (50–150):** the steward runs the §12 playbook with the steward kit. The cell may keep riding public relays or stand up its own on a $5 VPS, a Raspberry Pi, or a home-server box — one container, no state worth backing up (the mailbox forgets by design). Multi-home across its own + one public relay for redundancy (§11.4).
- **Level 2 — federation:** bridge people (§12.6) link cells; nothing new deploys. The "network" at every level is only: members' devices, plus mailboxes chosen per cell.

### 28.4 Relay discovery without a directory: invites carry the mail address

A hardcoded relay list would be quiet centralization. Instead, **the invite token carries the cell's relay hints** — joining a community auto-configures where it checks mail, the same way the invite already carries the vouch (§15.1). Relay configuration thus flows through the social graph itself: no global registry, no bootstrap server, and each cell's mailbox choices travel with its front door. The app ships with only a small, diverse public-relay fallback set for Level-0 strangers, overridden the moment any invite is redeemed.

### 28.5 The PWA's honest limits, and porch nodes

Browser clients are the entry ramp, not full citizens: background forwarding barely works in a browser (queries relay only while the tab is open), key storage is IndexedDB-plus-passphrase rather than a secure enclave, and the embedding model runs via WASM/WebGPU (feasible at ~80MB, slower). The design absorbs this with a division of labor that needs naming: **porch nodes** — a steward's always-on desktop client (or the cell's Pi, running a client, not a server) that carries a disproportionate share of forwarding while phone and browser clients sleep. Architecturally it is still an edge — a member's device with a member's keys, subject to postage and every protocol rule — but operationally it is the cell's workhorse, and the steward kit should treat standing one up as a first-class, one-click act. Early networks will be a few porch nodes plus many light clients; that asymmetry is fine *because it remains fireable* — any member can run one, and no porch node holds anything the mailbox model doesn't already forget. The upgrade path is explicit in the UX: PWA to try it, native app to carry your cell.

### 28.6 What this bootstrap deliberately avoids

No hosted "try it" server (a demo server becomes the de-facto platform within a month); no foundation-run default relay (same trap, §11.4's concentration risk from day one); no account recovery service (recovery is social, §9.2 — the website cannot reset what it never held); no analytics on the site beyond server-less download counts. The foundation's total operational surface is: static hosting, signing keys, and spec stewardship (§26) — deliberately small enough that there is almost nothing to subpoena, breach, or capture, which is both the security posture and the legal one (§23.2).

**Residual:** public-relay squatting at Level 0 is borrowed hospitality — fine at KB-scale but worth graduating out of (the steward kit nudges cells toward their own mailbox at ~30 members); porch nodes concentrate *availability* (not trust) in stewards' uptime, mitigated by making them plural per cell; and the signing keys are now the design's crown jewels — key ceremony, threshold signing among stewards, and rotation procedure belong in §26's constitution before the first public release.

---

## 29. The Steward Kit: A Concrete Checklist

Everything a community steward needs to take a cell from zero to functioning. Ships on the website (§28.2) as docs plus tooling baked into the desktop client's "Steward mode."

**Pre-flight (two weeks out)**
- [ ] Fit check against §12.1: 50–150 people, members largely know each other, real sub-interest diversity, an existing channel for coordinating the move
- [ ] Recruit 1–2 **co-stewards** — plural porch nodes (§28.5), plural charter signers, and nobody's vacation stalls the cell
- [ ] Install desktop client on an always-on machine per steward; enable Steward mode (porch-node forwarding, invite ledger, local health dashboard)
- [ ] Pick a charter template and edit to ≤6 lines of house rules (§14.6); co-stewards co-sign; publish as the pinned charter event and record its event id — this becomes the **charter pointer** every invite carries (§30)
- [ ] Relay decision: start on 2–3 public relays from the fallback set (fine at this scale, §28.3); calendar a reminder to revisit at ~30 members
- [ ] Generate the first invite batch (one token per founding member — never a reusable link, §15.1); print QR cards for launch day
- [ ] Choose which moderation/attestation feeds, if any, the cell subscribes to (§7) — or explicitly none; write the choice into the charter
- [ ] Set the beacon conversation: seed cells are laboratories, so plan to *ask* members to opt in (§12.4), never default them in

**Launch day**
- [ ] Onboard in person at a regular gathering — QR invites, the strongest binding (§15.2)
- [ ] First ritual: every new member speaks one real ask before leaving (seeds routing sketches and normalizes the core verb, §12.4)
- [ ] Confirm each redemption same-day (§15.3 cards) while faces are fresh

**Weekly (steward time budget: ~4–6 hours, shrinking)**
- [ ] Post the weekly ask prompt (§12.4)
- [ ] Clear the invite ledger: confirm redemptions, revoke stale tokens
- [ ] Read the local dashboard: dead-query ratio, hops-to-match, handshake funnel (§10.5 alarm table is the interpretation guide)
- [ ] Greet at the rendezvous if the cell runs a front-porch program (§20.3)

**Milestones**
- [ ] ~30 members: stand up the cell's own relay (one container; Pi or $5 VPS); add to charter's relay hints; members multi-home automatically via re-issued invites and a charter update event
- [ ] Week 8: run the §12.5 gate review with co-stewards; decide iterate-in-place vs. begin bridge scouting (§12.6)
- [ ] Any time: **succession** — Steward mode exports the role, not the person: charter co-signing keys are already plural, the invite ledger and dashboard are local files, and a departing steward's exit is one charter-update event naming the new signer set. If all stewards vanish, the cell still runs (forwarding, matching, and channels need no steward); only charter changes and new-member greeting stall — which is the correct failure mode.

---

## 30. Invite Token Wire Format v1

The invite token is the most load-bearing object in the system: it bootstraps an identity, a graph edge, a vouch commitment, relay configuration, and charter consent in one artifact (§15, §28.4). It must fit in a QR code, survive being pasted into an SMS, and leak nothing to any server in transit.

### 30.1 Design constraints

- **≤ ~450 base64url characters** (comfortable QR at medium error correction; safe in SMS/email)
- **Never touches a server:** the URL form carries the token in the **fragment** (`https://weft.link/i#<token>`), which browsers do not transmit in HTTP requests — the website serves the static redeemer page and never sees the token. The app-to-app form is a URI scheme: `weft:i:<token>`
- **Contains a commitment to vouch, not a vouch** — the invitee's key doesn't exist yet; the real vouch event is issued only at the inviter's confirmation (§15.3)
- **Forward-compatible:** unknown fields are ignored, never fatal

### 30.2 Encoding and fields

Deterministic CBOR map with integer keys, then base64url. Signature is Nostr-native Schnorr (BIP-340) over the SHA-256 of the CBOR body with the signature field absent.

| # | Field | Type / size | Meaning |
|---|---|---|---|
| 0 | `ver` | uint, 1 B | Format version = 1 |
| 1 | `iid` | bytes, 16 B | Invite id (random nonce; single-use ledger key; replay defense) |
| 2 | `inv` | bytes, 32 B | Inviter pubkey (x-only secp256k1) |
| 3 | `vtpl` | map, ~8 B | Vouch commitment template: `tier` (1=provisional, 2=contextual, 3=relationship §21.2), `ctx` (context code), `vexp` (vouch validity, days) |
| 4 | `exp` | uint, 4 B | Token expiry, unix seconds (≤ issue + 14 d, §15.1) |
| 5 | `flags` | uint, 1 B | bit0 single_use (always 1 in v1); bit1 confirm_required (§15.3, default 1); rest reserved |
| 6 | `relays` | array ≤3, ~120 B | Cell relay hint URLs (§28.4) |
| 7 | `chp` | bytes, 32 B | Charter pointer = Nostr event id of the **current** pinned charter the joiner consents to (the id *is* its SHA-256, so pointer and integrity hash are one field; fetched from `relays`). The **cell id** is a distinct value — the *genesis* charter id, derived by walking the charter's `prev` chain (§33.2, F4) — and is **not** carried in the token; clients compute it. | 
| 8 | `sig` | bytes, 64 B | BIP-340 signature by `inv` over fields 0–7 |

Raw total ≈ **300 bytes → ~400 base64url chars**: QR version ~13 at EC-M, printable on a business card. The charter pointer identifies the *current* charter the joiner consents to; the **cell identifier** is the genesis charter id, which clients derive by walking the `prev` chain — a cell *is* its charter lineage, and the two values are kept distinct precisely so that consenting to a charter and identifying a cell can never be confused (F4).

### 30.3 Redemption protocol (normative steps)

1. Parse; reject if `ver` unknown-major, `exp` passed, or `sig` invalid over the canonical body.
2. Fetch the charter event from `relays`; verify its id equals `chp`; **display charter + inviter identity + vouch tier before any key generation** — consent precedes existence.
3. On accept: generate root key (§9.1); configure `relays` as initial mailboxes.
4. Publish a **redemption event** encrypted (NIP-44) to `inv`: `{iid, new_pubkey, display_name}`.
5. Inviter's client checks its local single-use ledger for `iid` (first redemption wins; later ones surface as fraud alerts, not silent failures) and raises the §15.3 confirmation card.
6. On "yes, that's my Bob": inviter creates the real vouch attestation (kind 4902: subject = new_pubkey, tier/ctx/expiry from `vtpl`) and **delivers it privately, wrapped to the new contact** — nothing is published; the subject caches it and presents it wherever a vouch chain is needed (§33.3, §35 F1). A pairwise channel opens. On "not them": inviter publishes a 4903 void for `iid`; the redeemer keeps a keypair with zero vouches — inert (§15.3).
7. Invitee caches the charter, joins the cell's rendezvous if the charter names one, and appears in the inviter's contact list. Bootstrapping complete: identity, edge, vouch, mailboxes, and consented rules — from one scan.

### 30.4 Failure and abuse cases

*Expired/void/replayed token* → clean client-side errors; a replay after redemption alerts the inviter (someone reused a link — social signal worth having). *Intercepted token* → §15.3's confirmation makes theft a no-op; residual: the token plaintext reveals inviter pubkey and cell relay hints to whoever holds the SMS — acceptable for ordinary cells, and high-risk cells should prefer QR-in-person or the noted v2 extension (**cloaked invites**: inviter identity encrypted to a per-token key, revealed only at redemption). *Malicious inviter (Sybil farming)* → unchanged economics: every confirmed invite is a real vouch staking the inviter's local standing (§15.4, §21.3). *Relay hints poisoned* → the charter hash check fails or the charter shown isn't the community claimed; the human-visible charter step is itself the tamper alarm.

---

## 31. Month One of a Real Seed Cell, Day by Day

A concrete model: **"Cascade Fermentation Collective"** — 62 people on an existing group chat, monthly meetups, one energetic steward (Dana) plus two co-stewards. Numbers are targets and expected shapes, not promises; the failure signals and interventions matter more than the happy path.

**Days −14 to −1 — pre-flight.** Dana runs the §29 checklist: co-stewards recruited (Sam's home server becomes porch node #2), charter drafted from the template in one evening, invite batch printed as QR cards. The move is announced on the existing channel — framed as an experiment the community runs on itself, beacons explained, opt-in requested. *Steward hours: ~8 total.*

**Day 1 — launch at the monthly meetup.** ~35 of 62 attend; ~30 onboard by QR (90 seconds each, §14.1 — two stewards scanning in parallel clears the room in half an hour). The founding ritual: each person speaks one real ask before leaving. Routing sketches take their first imprint from 30 real queries in one evening. Dana confirms all redemptions that night while faces are fresh. *Expect: 30 identities, ~30 edges to stewards + organic edges among friends who invite each other on the spot.*

**Days 2–7 — the cold week (expected, and said out loud).** Remaining members trickle in via personal SMS invites (§15.2). Most hop-routed queries die or fall through to the cell rendezvous — sketches are cold, and the graph is a hub-and-spoke around the stewards. This is the ghost-town-risk window: the design's answer is the rendezvous doing honest heavy lifting (every match labeled "via community square," §12.3) and the first weekly ask prompt on day 5. *Healthy signals: ≥40 members by day 7; ≥25 asks total; first 3–5 rendezvous matches; first completed handshake (someone's koji ask meets someone's miso curiosity). Failure signal: asks < 15 → the ritual didn't take; intervention: stewards personally ask five members for one real ask each — seeding flow is a legitimate steward job in week one.*

**Days 8–14 — first warmth.** Sketches have gradients now; the first genuinely hop-routed match lands (probably 2 hops, probably through a steward — fine). The latency contract meets reality: someone's Tuesday ask matches Thursday, and the "traveling…" framing (§14.2) either feels natural or the copy needs work — watch for users re-sending identical asks within 24 h (impatience signal → UX iteration, and incidentally the first taste of §27's re-ask metric). Dana reads the dashboard Sunday: dead-query ratio should be *falling* week-over-week even if absolute numbers are rough. *Healthy: hop-matches ≥ 3; handshake completion ≥ 60%; a first small group forms around a sub-interest (the natto people find each other). Failure: all matches still rendezvous-only → fan-out too narrow or thresholds too strict; intervention: stewards check their porch nodes' forwarding logs before touching thresholds — availability bugs masquerade as matching bugs.*

**Days 15–21 — first friction.** Statistically this week brings: one stalled handshake (terms mismatch nobody understands — the two-tap terms UI gets its first real test), one invite confirmation mix-up ("Bob T." is actually Bob's partner using his phone — the §15.3 card catches it, which is the system working), and possibly the first governance blip (a commercial-ish post tests the charter's line — stewards apply the written rule, gently, in public: the charter's first live demonstration matters more than the incident). Membership crosses ~30–45 active: **stand up the cell's own relay** (the §29 milestone); charter update event adds it to relay hints. *Healthy: ≥50 onboarded; weekly active ≥ 60%; beacon opt-in ≥ 70% (it's a lab). Failure: active% sliding → almost always ask-flow starvation, not tech; intervention: themed ask week ("everyone ask one thing you'd never bring up at the meetup" — which also road-tests §17's travel modes).*

**Days 22–30 — the value moment, then the gate.** With ~45 warm sketches and steady flow, expect the month's payoff event: a **surprise lateral match** — the cheesemaker and the natto experimenter discover a shared obsession neither had named in the old group chat; rendezvous couldn't have made it, and the old platform's feed never would have. That story, retold at the day-29 meetup, is worth more than every metric (and is the qualitative gate in §12.5). Day 30: gate review with co-stewards against the §12.5 table — realistic month-one shape: query survival ~50–60% and climbing, hop-share approaching parity with rendezvous (full crossover is a month-two event; the §12.3 sunset rule stays armed, not fired), retention ~65%, handshake completion ~70%. *Decision: iterate in place (most likely), and begin **bridge scouting** only if gates are green — Dana quietly lists members who belong to other dense communities (§12.6) for the month-three conversation.*

**Month-one steward time, honestly totaled:** ~25–30 hours, front-loaded, trending to ~4/week — a real volunteer commitment, which is why the kit exists, why co-stewards are a pre-flight requirement, and why §20.3's stewardship-recognition norms aren't decoration. The month's meta-lesson for the playbook: **every early failure signal has a social intervention before a technical one** — seed flow before tuning thresholds, check porch uptime before blaming matching, tell the surprise-match story before quoting the beacon.

---

## 32. PWA Feasibility: One Codebase, Installed Everywhere, Offline by Default

### 32.1 The verdict

Yes. Everything in this design that runs on a device can run in an installed PWA on modern mobile and desktop browsers — crypto, storage, the embedding model, local speech-to-text, QR onboarding, relay networking — and the design's latency tolerance makes the web platform's weaknesses unusually survivable. Two limits are structural and must be owned rather than papered over: **no background forwarding when closed** (PWAs are leaf clients; porch nodes carry the graph, §28.5) and **update trust rests on the origin** (the one real security downgrade versus signed native builds, §32.5).

### 32.2 Capability map, honestly

| Need | Web platform answer | Status |
|---|---|---|
| Offline app shell | Service worker + cache | Solid everywhere |
| Keys & signing | Audited WASM/JS secp256k1 (WebCrypto lacks the curve); keys wrapped via passkey-derived secret (WebAuthn PRF) where supported, passphrase-KDF elsewhere | Solid; enclave-grade non-extractability is native-only |
| Database | SQLite-WASM on OPFS + `navigator.storage.persist()` | Solid on Chromium/Firefox; iOS eviction risk is real → §32.4 |
| Embedding model | Quantized sentence model (~25 MB int8) via ONNX/transformers.js; WebGPU where present, WASM-SIMD fallback | Solid; cached once, runs fully offline |
| Speech-to-text | Whisper-class WASM/WebGPU, on-device | Works; **the built-in Web Speech API is banned** — many browsers ship audio to vendor servers, violating invariant 4 |
| Relay transport | Nostr relays speak WSS; WebSocket is universal | Solid; no raw sockets ever needed |
| Push | Web Push with content-free pokes (§22.2); iOS requires home-screen install | Adequate; polling floor beneath it |
| QR onboarding | Camera + local decode | Solid, including fully offline (§32.3) |
| Background forwarding | Periodic sync is Chromium-only and unreliable | **Not viable — accept leaf-client status** |

### 32.3 Offline is not degraded mode — it's the native posture

Because the protocol already assumes hours-scale, store-and-forward communication (§8), offline PWA behavior is just the same design with a longer beat: asks compose and *queue* locally, flushing on reconnect; conversations read from local store; the model and STT run without any network; the privacy dashboard, charters, and vouch cache are all local reads. One addition makes even onboarding network-free: the **two-QR handshake** — invitee scans the invite (§30), their device displays the redemption payload back as a QR for the inviter to scan; both sides queue their events and publish when either finds a relay. Two phones in a basement can complete identity, vouch commitment, and charter consent with zero connectivity — Level 0 (§28.3) drops its last dependency.

### 32.4 Platform quirks that get design responses

**iOS:** push and reliable storage require home-screen installation, so install is treated as onboarding step zero, not a nice-to-have; storage eviction risk makes the key-backup nudge (§14.1) *earlier and firmer* on iOS builds. **Desktop:** an installed desktop PWA left running is a *serviceable porch node while open* — real forwarding capacity for a cell during waking hours — with true always-on porch duty going to a thin Tauri wrapper around the identical codebase or the headless core on a Pi. Which points to the architecture that makes all of this one project rather than four: **the protocol engine is a pure TypeScript library** (crypto, CBOR, routing, matching, storage schema) with thin platform adapters — DOM/PWA, Tauri desktop, headless Node. The PWA is not the compromise build; it is the reference client, and the porch node is the same engine wearing a different shell.

### 32.5 The honest asterisk: web distribution trusts the origin

A service worker updates from its origin; whoever controls the domain (or coerces the host) controls next week's code. Mitigations exist and are worth building — reproducible builds, a signed release manifest the app verifies before activating any new service worker, published build transparency — but the browser's update root of trust remains TLS-plus-origin, beneath native TUF-style signing (§28.2). The layered answer: the PWA is the universal on-ramp and everyday client; **users under targeted threat should graduate to sideloaded/native builds whose updates verify against foundation keys, not domains** — and the app says so, in the same plain register as every other honest surface (§14.7). Residuals beyond that: browser-vendor dependency is real (the web *is* a mediated platform — three engine vendors instead of two store owners, a better ratio and a wider door, not freedom), and battery economics of WASM inference on old phones need measuring against §20.4's cheap-device requirement before the reference client is declared equitable.

---

## 33. Event-Kind Registry v1: The Wire Closes

All protocol objects as concrete Nostr events. Kinds **4900–4959** are claimed as the Weft block (provisional pending NIP registration, §26.1 stewardship). Two families: **public kinds** (plaintext, signed, meant to be read) and **inner kinds** (application semantics visible only after decryption, carried inside a uniform wrapper).

### 33.1 The wrapper: one shape on the wire

Every private object travels as a **NIP-59-style gift wrap (kind 1059)**: the inner event is sealed and wrapped under a fresh ephemeral key, so relays see only — kind 1059, recipient pubkey tag, ciphertext, and an expiration tag. Adopting the existing gift-wrap kind rather than a custom wrapper is deliberate: Weft traffic becomes indistinguishable from the wider ecosystem's wrapped DMs, inheriting a chaff crowd far larger than the network itself (§10.3's economics, for free). The wrapper's `expiration` tag (NIP-40) implements §9.2's amnesiac retention classes: relays delete on schedule because the events ask them to.

**Retention classes:** **E** (hours — handshake state), **D** (days — discovery), **P** (persistent — public record). Every kind below declares one.

### 33.2 Public kinds (plaintext, signed, stored)

| Kind | Name | Class | Contents & rules | Implements |
|---|---|---|---|---|
| 4900 | **Charter** | P | Rules text + steward pubkey set. Genesis has no `prev` tag; amendments chain via `prev`. **Cell id = genesis charter id**; invite `chp` (§30) points at the *current* charter; verification walks the `prev` chain to genesis. Steward rotation is an amendment. | §7, §29, §30 |
| 4903 | **Void / revocation** | P | References the SHA-256 of the voided object: a vouch attestation hash (§4), an invite `iid` (§30.3), or a "not my Bob" (§15.3). Signed by the issuer. **This is the only vouch-related object that ever appears on a relay** — it reveals that the issuer voided *something*, never the subject or the edge. | §4, §15, §30, §35 F1 |
| 4904 | **Ejection attestation** | P | `p`=scoped pseudonym, `e`=charter, clause ref, evidence *hash* only. Signed by steward set per charter rules. | §7, §18.2, §24.3 |
| 4905 | **Health beacon** | P (months) | Bucketed, noised counters per the versioned schema; `mdl` tag for model-version dimension (§19.3), entry-tier mobility counter (§20.5), match-durability and re-ask counters (§27.1). | §10.2 |
| 4906 | **Relay ops metrics** | P (months) | Queue depth, retention config, uptime; signed by operator key. | §10.4, §11.4 |
| 4907 | **Model registry entry** | P | Content hash of open weights, provenance pointer, anchor-set bridge scores (§19.5). Adoption happens in charters, not here. | §19.2 |
| 4909 | **Release manifest** | P | Build hashes per platform, signed by foundation threshold keys; clients verify before activating updates. | §28.2, §32.5 |

### 33.3 Inner kinds (inside the 1059 wrapper)

| Kind | Name | Class | Contents & rules | Implements |
|---|---|---|---|---|
| 4902 | **Vouch attestation** | D (delivery) / P (on subject's device) | Signed object: subject pubkey, `tier` (1/2/3), `ctx` code, issued/expiry dates. **Delivered privately** — wrapped to the subject, who caches it and presents it inside match tokens and reveal payloads as a self-contained, offline-verifiable credential (§9.3). Never published to any relay in plaintext; verification = signature check + a relay lookup for a 4903 void of its hash. Anonymous-credential issuance (§18.2) rides the same kind with a credential payload. Renewal = a fresh attestation. | §4, §21, §30.3, §35 F1 |
| 4910 | **Query** | D | Embedding (int8-quantized, ~384 B) *or* LSH bucket + sealed fine embedding (§17.3); `ttl`; terms offered; ephemeral reply key; **route token `rt`** (fresh random 16 B assigned by whoever hands the query to you — rewritten at every hop, §35 F2); travel-mode flags; `ver` + `mdl` tags. There is no stamp field — postage is per-channel accounting, never payload (§35 F5). **Authored and forwarded queries are byte-shape identical** — no origin field exists (invariant 4, §17.2). A standing ask emits ordinary 4910s on its rhythm — *deliberately no standing-query kind exists* (§25.1). | §3, §8, §17, §25 |
| 4912 | **Match reply** | D | Match token: score bucket, hop estimate, **self-contained masked vouch chain** (the 4902 attestations themselves, masked per §5 — never references requiring relay lookup, per §35 F1), responder ephemeral key. Routed along the reverse path via **blinded route tokens**: the wrapper carries only the `rt` of the edge it arrived on; each hop looks up its swap table (myToken → upstreamToken, neighbor), relabels, and re-wraps — no identifier survives more than one hop, so colluding non-adjacent nodes cannot correlate a reply's path (§35 F2). **A reply may answer on behalf of a *group* (F9):** if so it carries a `grp` tag = the group's charter/cell id and a group-scoped vouch (a 4902 whose subject is the group and whose issuer is a charter-designated greeter), and the responder ephemeral key belongs to the answering member, not the group. The match card then reads "a group, per {charter}" rather than a personal identity. See 4911. | §5 stage 0, §35 |
| 4913 | **Intent ping** | E | Terms proposal under asker's ephemeral key; nonce; references match token. | §5 stage 1 |
| 4914 | **Terms response** | E | Accept / counter. Silent decline = no event, ever (the protocol has no decline message *by design*). | §5 stage 2 |
| 4915 | **Commit** | E | Ciphertext of identity payload. | §5 stage 3 |
| 4916 | **Reveal** | E | Decryption key; sent only after both commits held. | §5 stage 3 |
| 4917 | **Channel handoff** | E | Group/room invite or double-ratchet bootstrap; relay path dropped after. | §5 stage 5 |
| 4918 | **Invite redemption** | D | `iid`, new pubkey, display name — encrypted to inviter. | §30.3 step 4 |
| 4919 | **Pairwise hello** | D | Opens the contact channel post-confirmation: ratchet init, stamp-ledger zeroing. | §9.1, §15 |
| 4920 | **Group message** | D | Encrypted under current group key; published with hashed-channel `h` tag members subscribe to. | §7, §9.1 |
| 4921 | **Group key rotation** | D | New key wrapped per remaining member (naive O(n); MLS supersedes at scale, §9.1). Rotation *is* ejection enforcement. | §7, §9.1 |
| 4922 | **Charter consent receipt** | D | Joiner's signature over charter id, delivered to stewards — the "agreed at the porch" record. | §14.6, §29 |
| 4923 | **Tombstone** | P | Subject-signed erasure request; compliant clients delete cached copies of referenced events (best-effort, §23.1). | §23 |
| 4924 | **Escrow share** | E (auto-expire post-meetup) | Match card + time/place + optional live-location grant, to the chosen safety contact only. | §24.2 |

### 33.4 Cross-cutting rules

- **Tag vocabulary (normative):** `p` recipient/subject · `e` referenced event · `prev` charter lineage · `expiration` retention (NIP-40) · `tier`/`ctx` vouch semantics · `h` hashed group channel · `grp` group/cell charter id when a reply or declaration speaks for a group (§35 F9) · `ver` protocol version · `mdl` embedding-model hash · `rt` per-edge blinded route token (16 B random, meaningful only between adjacent hops, swapped at each). Nothing else may carry routing-relevant meaning.
- **Unknown handling = forward compatibility (§26.2):** relays store/forward anything well-formed; clients ignore unknown inner kinds and unknown tags without error. New capability = new kind, never a mutated old one.
- **Randomized wrapper timestamps (§35 F3).** Every 1059 gift wrap carries a `created_at` drawn uniformly from the past 48 hours, never the true send time (standard NIP-59 practice Weft adopts as normative). True time is known only locally; the `expiration` tag is computed from true time at send and is unaffected. This denies relays and observers a real-time correlation signal, and — combined with F1's no-public-vouches rule — means even the *timing* of relationship formation never appears on any shelf.
- **The social graph is never published.** No plaintext object linking two member pubkeys (vouch, contact list, edge of any kind) may ever be stored on a relay. Vouches are private attestations carried by their subjects; only hash-referencing voids (4903) touch relays. This rule exists because the trust graph *is* the social graph (§35 F1), and it is a release gate, not a guideline.
- **Sign inside, encrypt outside (§9.1)** holds for every inner kind: the sealed inner event is signed by whichever key owns the act (ephemeral for handshake stages, pairwise for queries, group-member for 4920), then wrapped.
- **Size sanity:** the largest routine object is a 4910 query at ~600–700 B wrapped — well under any relay limit, cheap on prepaid data (§20.4), and uniform enough after padding-to-bucket (v2, §6) to resist size fingerprinting.
- **What is deliberately absent from this registry:** a profile kind, a follow/contact-list kind of our own (NIP-02 suffices and stays client-local in meaning), a reaction/like kind, a public post kind, and a standing-query kind. Each absence is a design decision made earlier in this document; the registry's silences are as normative as its rows.

*With §33, every object named in §§1–32 has a wire representation, a retention class, and a versioning rule. The v0 specification is closed; what remains is code. The v2 group and persona layers add four further inner kinds (4930–4933) specified in §36.4, registry-complete now so no number is ever mutated, but built only when those layers ship.*

---

## 34. Media: Images, Video, Sound, and Long Text

### 34.1 The principle that keeps media from breaking the design

Every medium is welcome; **no medium gets a stage.** Media in Weft travels the same consent paths as everything else — into established channels between people who chose each other, or as *meaning* attached to an ask — and never into anything resembling a feed, a story, or a public gallery. The moment media can be broadcast to strangers, the attention economy walks back in through the side door, and with it every pathology this design exists to exclude. So the rule is structural: **pixels and audio move only where a consent handshake has already been completed; before that, only their meaning (an embedding) moves.**

### 34.2 The blob layer: shelves, not mailboxes

Relays are KB-scale amnesiac mailboxes (§9.2, §33.4) and must stay that way — a photo is a thousand times too big for that layer. Media gets its own layer with the same virtues:

- **Client-side encryption first, always.** Every media object is encrypted on-device under a fresh random symmetric key before it exists anywhere else. What's stored is ciphertext, content-addressed by its hash.
- **Shelves** are dumb blob stores holding encrypted objects — the media sibling of relays. The Nostr ecosystem already has this shape (Blossom-style content-addressed blob servers), so v-next borrows rather than invents: any HTTP store, a cell's own box, or IPFS can be a shelf; users and cells multi-home shelves exactly as they multi-home relays (§11.4), and a seized shelf yields ciphertext with no keys.
- **The pointer travels the existing sealed channels.** A new inner kind, **4926 media pointer** — {blob hash, decryption key, shelf hints, mime, size, duration} — rides the same gift-wrapped transport as any message (§33.1). The mailbox layer carries the *key*; the shelf carries the *ciphertext*; neither alone is anything. This is the Signal/Matrix attachment pattern, applied to Weft's topology.
- **Amnesia extends to media.** Blobs expire by default on the same forgetting-first posture (§9.2): conversation media lives weeks, not forever. Durable media — the koji group's technique videos — is the already-anticipated steward-maintained artifact (§9.2's group archive), explicitly kept, quota'd, and paid for by the cell that wants it (§34.5).
- **Direct when possible.** For pairwise channels with both ends online, media can skip shelves entirely via an encrypted peer-to-peer transfer (WebRTC data channel) negotiated inside the channel — zero infrastructure, the purest expression of the design. Shelves are the store-and-forward fallback that the offline-tolerant posture requires; **porch nodes** (§28.5) naturally double as a cell's media cache for members' overnight phones.
- **Hygiene by default:** EXIF and location metadata are stripped on-device before encryption unless the sender explicitly opts to keep them — a photo should not carry a home address as a stowaway.

### 34.3 Media as meaning: multimodal asks

The discovery layer gets richer without leaking a single pixel. An ask may attach media *as an embedding only*: photograph the mystery plant on your windowsill, and what travels the graph is a CLIP-class image embedding — "who else grows this?" routes and matches exactly like a text ask, through the same §3 machinery, under the same §17 protections. The photo itself stays on the asker's device until a handshake completes and they choose to share it into the new channel. The same pattern generalizes: a hummed melody or field recording becomes an audio embedding ("what is this song / bird / engine noise?"), a video becomes keyframe embeddings. Each modality is just another entry in the model registry (§19.2) — named, versioned, community-chosen — and another implementation of the `Embedder` interface the build already isolates (build list M5-T1/M8). Multimodal models are heavier than text models, so §20.4's cheap-device requirement makes them optional client capability, negotiated like any model version (§19.4), never a floor.

### 34.4 Safety: the handshake was already the answer

Media is the network's largest abuse surface — unsolicited imagery, NCII, and worse — and Weft's strongest defense turns out to be a rule it already had: **no media can reach you from anyone you haven't completed a mutual-consent handshake with.** The masked stages (§5) carry structured terms only — there is no field in kinds 4913–4916 for a pixel, just as there is no message for "no" — so the unsolicited-image attack that plagues every DM system is not moderated away but *unrepresentable*, the same way rejection-harassment was. On top of that structural floor: first media from any *new* connection renders blurred-until-tap by default (receiver-side, receiver-tunable); group charters govern media norms per community (§7), including media-free groups; senders can tombstone their blobs (4923 reaches ciphertext everywhere it's shelved, honestly best-effort per §23.1); and the evidence-preserving report path (§7.3, §24.3) applies to media as to anything else. Shelves, holding only ciphertext, enforce quotas and postage per uploader and honor tombstones — they cannot scan, and §7.3's plainly-stated tradeoff extends here unchanged.

### 34.5 Economics and residuals

Media is where infrastructure stops being almost-free: shelves cost real storage and bandwidth, which is why default expiry, per-uploader quotas, and cell-funded durable archives (§11.2's clubhouse-rent model, extended) are load-bearing rather than nice-to-have — a cell's dues cover its mailbox *and* its shelf, and the §29 steward kit grows a shelf checklist line. Residuals, plainly: video at scale strains volunteer shelves (cells wanting heavy video will pay commodity storage prices — stated, not hidden); tombstoned media may already be copied (true of every system; forgetting-by-default at least shrinks the window); and multimodal embeddings inherit §19's model-mediator politics with a sharper edge, since image models encode cultural bias at least as strongly as text models — the §19.3 community-benchmark discipline applies with extra force.

**Registry addition (extends §33.3):**

| Kind | Name | Class | Contents & rules | Implements |
|---|---|---|---|---|
| 4926 | **Media pointer** | D (channel media) / P (steward artifacts) | blob hash, symmetric key, shelf hints, mime, size, duration; valid only inside an established pairwise or group channel — clients MUST reject 4926 arriving in any handshake stage | §34.2, §34.4 |
| 4911 | **Group-interest declaration** | P (on the group's charter relays) / cached by members | Resolves F9. A charter-designated **greeter** publishes, under the group's key, the group's declared interests (embeddings) plus which members are authorized to answer for it. A member's client only auto-answers "in group mode" (emitting a `grp`-tagged 4912) if it holds a current 4911 authorizing it. This gives group-as-respondent a concrete home: the group's *interests* live in a signed declaration, the *consent to answer* is the greeter authorization, and the *handshake* is conducted by an authorized member whose personal identity stays masked until the normal reveal — at which point they reveal "member of {group}, per charter," not necessarily their own name (asymmetric terms, §5). | §5, §7, §20.3, §35 F9 |
| 4927 | **Terms vocabulary reference** | (not an event — a versioned registry) | Resolves F11. The `terms` carried in 4913/4914 (intent ping / terms response) are **coded predicates from a versioned registry**, never free text: e.g. `reveal.name`, `reveal.vouches`, `reveal.city`, `reveal.after=1msg`, `stay.pseudonymous.until=sponsor`. Each side renders the codes in its own language locally, so two parties in different languages consent to the *same* predicate set — a free-text "terms" field would let them agree to different things, which is a consent bug, not a translation bug. New predicates are added to the registry by the §26.1 process; unknown predicates are rejected, never guessed. | §5, §14.3, §35 F11 |

*Text, for completeness, was never the question: short text is native to every channel, and long-form text (essays, guides, the koji wiki) is simply a small blob — the same pointer pattern with a lighter footprint.*

---

## 35. Second Adversarial Pass: Newly Identified Weaknesses

A fresh end-to-end audit of all deliverables (design §§0–34, mockup, build list, overview, manifesto), looking specifically for defects *not* previously catalogued in §16 or any section's residuals. Sixteen findings, grouped by kind, each with severity and a direction of fix.

### 35.1 Specification-level defects

**F1 — Public vouches publish the social graph. (SEVERE — the biggest finding of this pass.)** Kind 4902 vouches are plaintext, signed, persistent events on relays: voucher pubkey → subject pubkey, tier, date. That is the trust graph, and the trust graph *is* the social graph — published, timestamped, and queryable by anyone. This quietly undermines much of the rest of the design: §17's origin-ambiguous queries protect the weft while the warp sits on a public shelf; an adversary maps the graph from vouches first, then traffic-analyzes with that map. It also falsifies the manifesto's "seize every server and find empty shelves" — the vouch shelf is full. The fix direction was already half-written in §9.3: vouch chains must travel **with** match tokens as self-contained signed objects, which means they never needed public storage at all. V-next: vouches become pairwise-delivered attestations cached by subject and presented on demand; at most a *commitment* (hash) lives on relays for revocation checking. This should be treated as a pre-v1 spec change, not a v2 IOU, and the manifesto's claim held until it is true. *(STATUS: fix folded into §30.3, §33.2–33.4.)*

**F2 — Reply routing leaks query correlation per hop. (HIGH.)** The reverse-path mechanism (§17.2, build list M5-T3) requires intermediaries to route a wrapped 4912 backward by looking up `queryId` — meaning the queryId must be visible in plaintext on the wrapper at every hop. Colluding nodes can therefore trace a query's full path by correlating the identifier, partially defeating origin ambiguity. Fix: per-hop **blinded route tokens** — each forwarder assigns a fresh random token to its upstream edge and stores (myToken → theirToken, neighbor); replies carry only the local token, re-labeled at each hop, onion-style. Small change, should enter the wire spec before M5 is coded. *(STATUS: fix folded into §33.3–33.4 and the build list M5-T3.)*

**F3 — Timestamp hygiene is unspecified. (MEDIUM.)** Every Nostr event carries `created_at`. Wrapper timestamps enable traffic correlation, and (per F1) vouch timestamps reveal when relationships formed. NIP-59 practice randomizes gift-wrap timestamps by up to ±2 days; Weft never adopted this. Fix: normative rule in §33 — all 1059 wrappers carry randomized `created_at` (uniform over the past 48h); expiration is computed from true time locally. *(STATUS: resolved — normative randomized-`created_at` rule added to §33.4.)*

**F4 — Charter pointer ambiguity. (LOW, but a consent bug in waiting.)** §30 calls `chp` the cell identifier; §33 defines cell id as the *genesis* charter while invites point at the *current* charter. Two documents, two answers. Fix: `chp` = current charter event (what the joiner consents to); `cell_id` = genesis id, derived by walking `prev`; the invite carries only `chp` and clients compute the rest. *(STATUS: resolved — §30.2 now distinguishes `chp` (current charter, consented) from the derived cell id (genesis); §33.2 unchanged.)*

**F5 — The `stamp` field is vestigial. (LOW.)** §33's 4910 carries `stamp: 1`, but postage is per-channel local bookkeeping (§6, §21.4) — a self-declared field in the query is meaningless and invites confusion. Fix: delete the field; stamping is accounting, not payload. *(STATUS: fix folded into §33.3.)*

### 35.2 Unmodeled attacks

**F6 — The interest-probing oracle. (HIGH.)** Devices auto-reply to queries whose embedding matches declared interests ≥ threshold. A malicious *contact* can therefore binary-search your interest space with crafted probe queries — each match reply is one bit of an oracle, and a few hundred silent probes reconstruct your declared interests with no handshake ever completed. Nothing in §6 covers this because the prober isn't spamming humans, only your matcher. Fix directions: per-sender match-reply rate limits (independent of forwarding postage); probe-pattern detection (many high-similarity queries from one edge in a short window → require user confirmation to reply); optional reply-only-after-tap mode for sensitive interest entries; and jittered thresholds so the oracle is noisy. Belongs in the threat model (§6) and the build list's M5-T3 acceptance tests. *(STATUS: mitigations folded into build-list M5-T3 — per-sender reply budget, probe detection, threshold jitter, with a 200-probe acceptance test.)*

**F7 — Invite-tree capture (the eclipse at onboarding). (MEDIUM-HIGH.)** Whoever invites you initially shapes your entire graph: a controlling person or high-control group that onboards someone controls their contacts, their relay hints, their charter, and — via routing — their whole view of the network. §17 protects against a hostile contact; nothing yet addresses a hostile *onboarding monopoly*. Mitigations: the client visibly encourages edges beyond the inviter's cluster ("all your paths currently run through one person" as a gentle, private health note), public-relay fallbacks that no invite can remove, and rendezvous reachability that no charter can disable.

**F8 — Porch nodes are intra-cell metadata observers. (MEDIUM.)** §28.5 claimed porch nodes concentrate "availability, not trust" — incomplete: a node relaying most of a cell's traffic observes most of a cell's *flow metadata* (who queries when, at what volume), and a compromised steward desktop approximates a cell-wide traffic camera. Honest restatement plus mitigations: plural porch nodes per cell as a checklist requirement (§29 already gestures at this — make it mandatory, not advisory), client-side randomization of which porch/first-hops carry each ask, and porch software that aggressively forgets (route tables in RAM, counters only).

### 35.3 Unspecified mechanics

**F9 — Who answers for a group? (MEDIUM-HIGH — a hole in the core value proposition.)** Match cards throughout say "a small group, 5 people, meets monthly" — but the protocol never defines *group-as-respondent*: whose device holds the group's declared interests, who consents to answer on the group's behalf, and who conducts the group's side of a handshake. Options to spec: a charter-designated greeter role whose client answers with group-scoped (not personal) interest entries; or any member may answer in group mode with the reply flagged "speaking for Koji Circle per charter." Until specified, the most common match type in every mockup screen has no wire-level meaning. *(STATUS: spec resolved — kinds 4911 (group-interest declaration) and the `grp`-tagged 4912 group reply added to §33.3; not implemented in v0, which demonstrates person-to-person matching only.)*

**F10 — Multi-device same-key is created by our own build list. (MEDIUM.)** M7 imports a PWA-exported key into a porch node — the same identity live on two devices, with no design for concurrent state: stamp ledgers diverge, routing sketches fork, both devices answer the same query, and pairwise ratchets (v2) would break outright. Fix for v0: porch nodes get their **own** keypair, vouched by and paired to the owner's primary (a device-key pattern — which also usefully prototypes delegation); real multi-device sync is named as the v2 problem it is. *(STATUS: resolved in build-list M7-T1 — porch nodes get their own device key, paired by a device vouch; root keys are never copied.)*

**F11 — Terms are consent, so terms must be codes. (MEDIUM.)** The terms language (§5, §14.3) was never pinned as enumerated codes vs. free text. If terms are text, two parties using different languages can "agree" to different things — a consent bug, not a localization bug. Fix: the terms vocabulary is a registry of coded predicates (like `vtpl` already is in §30), rendered locally in each user's language; free-text terms are prohibited at the protocol level. *(STATUS: resolved — terms are coded predicates from a versioned registry (§33.3 kind 4927); free-text terms prohibited.)*

**F12 — Local store migrations. (LOW-MEDIUM, but the #1 cause of local-first data loss in practice.)** Nothing anywhere addresses schema versioning of the client store across app updates. Fix: a `schema_version` row from M3 onward, forward-only migration steps shipped with every release, and a migration test in CI (open a fixture DB from version N−1, migrate, assert integrity).

### 35.4 Governance, legal, and claims discipline

**F13 — Minors are entirely unaddressed. (SEVERE as an omission.)** Nothing in thirty-four sections mentions users under 18 — for a system that introduces strangers, that is the largest single gap in the project. The tensions are real and must be faced rather than waved at: age assurance mechanisms conflict directly with the no-identity-no-documents architecture; child-safety regulation (COPPA, age-appropriate design codes) attaches duties this system's shape resists; and yet "we simply don't serve minors" is both unenforceable and its own failure mode. Honest directions, none sufficient alone: cells and institutions as the age-context bearers (a school club or scouting troop is an age-verified context in the way no protocol can be, and institutional vouches (§20.2) can carry an age-context attestation); charter-level minor-safe modes (no 1:1 handshakes with unvouched adults, group-mode matches only, mandatory-steward-visibility norms that the minor's cell consents to); and a plainly stated v1 posture (not designed for or marketed to minors) while the real design work happens. This needs its own design cycle with child-safety expertise — flagged here as the top item of the next one. *(STATUS: v0 posture stated in README § Scope-and-safety and SECURITY § Minors — not built for or offered to minors; the full design cycle remains the top open item.)*

**F14 — The license was never chosen. (MEDIUM — load-bearing and unpicked.)** §26.2 promises libre licensing with a separable trademark; §28 promises reproducible signed builds; the build list creates a repo with no LICENSE task. The choice (copyleft AGPL-class vs. permissive MIT-class) materially shapes the fork right, client plurality, and the "one violating client poisons trust" concern in §11.5 — it is a governance decision, not paperwork. Fix: an explicit M0 task and a §26 paragraph recording the choice and its reasoning. *(STATUS: resolved — dual-track license chosen and recorded in §26.3; enforced by build-list M0-T0.)*

**F15 — Practical naming collisions in the developer namespace. (LOW.)** The word cleared the *consumer social* category (§ naming pass), but `weft` is taken on PyPI and used by at least two active dev tools — so package names need a scope from day one (`@weft-protocol/core`, `weft-protocol` on PyPI), and the build list's package naming should say so before M0 creates artifacts that must later be renamed.

**F16 — Claims discipline across deliverables. (MEDIUM — trust is the product; overclaiming is the vulnerability.)** The manifesto says "promises can be broken; math has to be broken" and "empty shelves"; the design doc honestly concedes PWA origin-trust (§32.5), OS sufferance (§22), best-effort tombstones (§23.1), and — per F1 — currently-public vouches. None of these make the manifesto false in spirit, but a project whose entire moat is honesty cannot let its most-quoted document be its least-precise one. Fix: a standing rule that the manifesto and overview are re-audited against the residuals ledger at every release, and one added manifesto line that buys the needed room honestly — the promise is the *architecture's direction and its refusal to hold what it doesn't need*, not perfection.

**Meta-observation for this pass:** the previous audit (§16) found tensions in the *design's ideas*; this one found defects in the *design's plumbing and its silences* — the graph published by accident (F1), the identifier that traces the path (F2), the group that can't legally speak (F9), the child the document never imagined (F13). Idea-audits and plumbing-audits find different bugs; the project should institutionalize both, per release, forever.

**Disposition roll-up (as of the current revision).** *Resolved in spec and/or build list:* F1 (private vouches, Gate 3), F2 (route-token blinding, Gate 4), F3 (randomized wrapper timestamps, §33.4), F4 (charter-pointer vs. cell-id disambiguated, §30.2), F5 (stamp field removed), F6 (probe resistance, M5-T3), F9 (group-as-respondent — kinds 4911 + `grp`-tagged 4912, §33.3; spec-complete, implemented only when groups ship in v2), F10 (porch device key, M7-T1), F11 (terms as coded predicates, kind 4927), F14 (dual-track license, §26.3 + M0-T0). *Posture stated, full design cycle deferred:* F13 (minors — README/SECURITY). *Documented-and-mitigated, deeper work deferred:* F7 (invite-tree capture), F8 (porch metadata observation), F12 (store migrations — TESTING/M3), F15 (npm scope — handled), F16 (claims discipline — process control). Every specification-level and plumbing defect (F1–F6, F9–F12, F14) is now closed in the spec; what remains open is one deferred design cycle (F13) and four standing operational residuals (F7, F8, F15, F16), each carrying a stated mitigation. Nothing is lost.

---

## 36. V2 Specification: The Group Layer and the Persona Layer

Sections §7 and §18 argued for groups and plural personas conceptually; this section specifies them concretely — wire kinds, key management, state machines, and the protocol flows — to the same standard §5, §30, and §33 hold for v0. Both layers share one cryptographic dependency (anonymous credentials), so they are specified together and, per the build list, built together. Everything here is **v2**: it is registry-complete and flow-complete now so nothing mutates a kind number later, but none of it ships in v0.

### 36.1 Shared foundation: the credential engine

Personas (§36.3) and the anonymous rendezvous (§17.4) both need the same primitive, so it is specified once here and both layers consume it.

**Scheme.** BBS+ signatures over the BLS12-381 curve (the mature, audited choice with multiple production libraries and an active IETF draft). A credential is a BBS+ signature by an *issuer* over an ordered set of messages (attributes); the holder can later produce a zero-knowledge **presentation** that proves a signature exists over the committed attributes while selectively disclosing, or proving predicates over, only some of them — revealing nothing else, and unlinkable across presentations.

**Attributes in a Weft vouch credential** (the messages signed): `subject_commitment` (a Pedersen commitment to the subject's root secret, so the holder can prove they are the subject without revealing which key), `tier` (1/2/3), `ctx` (context code), `issued_epoch`, `expiry_epoch`, `issuer_scope_tag` (a tag identifying the issuer's set — cell or region — *without* identifying the issuer). This is the credential form of the 4902 attestation (§33.3): a plaintext 4902 is delivered privately for named use; its BBS+ form is issued for anonymous use. One vouch, two representations, same underlying act.

**k-show enforcement (bounded plurality, §18.2).** Each presentation includes a **nullifier** = `PRF(root_secret, issuer_id ‖ epoch ‖ show_index)` with `show_index ∈ {0…k−1}`. Presenting more than k times in an epoch forces reuse of a `show_index`, producing two presentations with the same nullifier — a collision anyone can detect, and (because the nullifier construction is the standard double-spend-style trapdoor) the collision *deanonymizes the over-spending root*. Cheating is self-incriminating; honest use within k is fully unlinkable. Default k is a cell-charter constant (§18.6), initial value 3 per quarter-epoch.

**Scoped pseudonyms / accountability nullifiers (§18.2).** For a given scope (a group or rendezvous), a persona's stable identifier is `scope_nym = PRF(root_secret, scope_id)` — deterministic within the scope, unlinkable across scopes, and provably bound to a valid credential at first presentation. Ejection names the `scope_nym`; the root cannot mint a second face for that scope because the derivation is deterministic and re-showing there collides. This is the same nullifier machinery as k-show, keyed by scope instead of show-index.

**Epoch clock.** Epochs are global, coarse (quarter-length by default), and derived from wall-clock date — no coordination needed. Credentials carry `expiry_epoch`; presentations are rejected past it; renewal re-issues against the still-valid underlying vouch (§18.2's revocation-by-non-renewal).

**Issuance flow.** (1) Subject sends the issuer a **credential request** (new inner kind **4930**) containing the blinded `subject_commitment` and requested attributes. (2) Issuer, if willing (this is just the anonymous form of vouching, so the same social judgment applies), returns a **credential issuance** (**4931**) with the BBS+ signature. (3) Subject verifies and stores it locally; it never touches a relay in either direction beyond the wrapped delivery. Revocation reuses the existing **4903 void** against the credential's revocation handle (a hash), so a subject checks non-revocation the same way it checks a plaintext vouch.

### 36.2 The group layer

A **group** is a durable, consented, self-governing channel with a charter. v0 already defines its skeleton — charter (4900), consent receipt (4922), group message (4920), key rotation (4921), ejection (4904), and the group-as-respondent kinds (4911, `grp`-tagged 4912). §36.2 completes it.

**Membership and identity inside a group.** A member is present in a group under a **scope_nym** (§36.1) for that group's `scope_id` = the genesis charter id. This is the pivotal design choice: **group membership is pseudonymous by default** — you are "a vouched member, this face" — and a member may *optionally* reveal their real identity to the group (or to specific members) through the ordinary consent handshake (§5) run pairwise inside the channel. Governance (ejection, jury service, sponsorship) operates entirely on scope_nyms and therefore needs no real names, which is exactly what lets ejection stick without anyone learning who was ejected (§18.2).

**Joining.** (1) A prospective member obtains an invite to the group (the §30 token, whose `chp` names the group's current charter). (2) They present, via a **group join request** (inner kind **4932**), a credential presentation proving "I hold a valid, unexpired vouch within this cell's issuer scope" (§36.1) plus their fresh `scope_nym` for this group. (3) A charter-designated **steward or greeter** verifies the presentation and the non-collision of the scope_nym, then issues a **membership grant** (**4933**): the current group key wrapped to the joiner, plus the joiner's scope_nym recorded in the group's membership roster (itself a group-key-encrypted 4920-class record, never public). (4) The joiner signs a **4922 consent receipt** over the charter. Consent precedes key delivery, mirroring v0's consent-before-existence.

**Messaging.** Group messages are **4920**, encrypted under the current group key, published with the hashed-channel `h` tag members subscribe to. Sender is identified inside the ciphertext by scope_nym, so a relay sees only "traffic on channel `h`," never who or how many. Media in groups uses the §34 pointer (4926) with the blob key wrapped under the group key.

**Group key management and the MLS transition.** Two regimes, switched by size (§9.1):
- **Small groups (≤150 members): sender-keys with naive rotation.** A single symmetric group key; each member also holds a per-member wrapping key established at join. Rotation (**4921**) publishes the new group key wrapped once per *remaining* member — O(n) ciphertexts, fine at Ostrom scale. This is the v2-initial implementation.
- **Large groups (>150): MLS (RFC 9420).** The group becomes an MLS group; ratchet-tree operations give O(log n) rotation, forward secrecy, and post-compromise security. The transition is a charter-flagged migration: the group publishes an MLS `Welcome` to current members and thereafter uses MLS `Commit` messages (carried inside 4921) for all membership changes. MLS's own epoch/leaf model absorbs join/remove/rotate; Weft's 4921 becomes a thin envelope around MLS handshake messages. Groups that never cross 150 never pay MLS's complexity — the sociology and the cryptography agree again (§9.1).

**Ejection (sanction = key rotation, §7).** (1) Per the charter's rule (e.g., 3-of-5 stewards, or a jury verdict), the stewards publish a **4904 ejection attestation** naming the ejected `scope_nym`, the charter clause, and an evidence *hash* only. (2) Immediately a **4921 rotation** issues a new group key wrapped to every member *except* the ejected scope_nym. (3) The ejected member retains old messages they already hold (no reaching into devices) but receives nothing further and cannot rejoin: their scope_nym for this group is deterministic and now known-ejected, and re-presenting a credential yields the same nym, which the roster rejects. The ban holds against someone the group never identified.

**Charters and amendments.** The **4900 charter** carries: human-readable rules (≤6 lines by UX convention), the steward pubkey set, the amendment rule (e.g., "key rotation of governance requires m-of-n stewards"), the ejection procedure, the chosen embedding model (§19.3), media policy (§34.4), and the credential constants (k, epoch length). Amendments chain via `prev`; the **cell id is the genesis charter id** (§30, F4). A charter amendment that changes governance keys is itself an m-of-n-signed event, so admin capture (§7) requires compromising the threshold, not one account.

**Group-as-respondent (F9, completing §33.3).** A greeter authorized in the charter publishes a **4911 group-interest declaration** (the group's declared-interest embeddings + the list of scope_nyms authorized to answer). An authorized member's client, on a matching query, emits a `grp`-tagged **4912** carrying a group-scoped credential presentation ("this reply speaks for {cell_id}, and the answerer is an authorized member") without revealing which member. The seeker's handshake then runs against the group: the reveal unmasks "a member of {group}, per charter" (asymmetric terms, §5), and only a subsequent pairwise handshake inside the group — at the member's option — attaches a personal identity.

**Group governance-as-service (§7's federated moderation).** A group may **subscribe** to another group's ejection-attestation stream: a **moderation subscription** (local config, not a wire kind) that treats another cell's signed 4904s as weighted input, per §7's "chosen, plural, fireable" rule. Attestations are weighted by the subscriber's trust in the issuer and never summed into a global score — the same discipline as vouches (§35 F1's sibling concern).

### 36.3 The persona layer

A **persona** is an unlinkable secondary self carrying anonymous proof of backing (§18). The credential engine (§36.1) is its whole cryptographic basis; §36.3 specifies lifecycle and wire.

**Derivation.** Persona keys are hardened-derived from the root: `persona_root = HKDF(root_secret, "weft-persona" ‖ persona_index)`. Siblings and root are cryptographically unlinkable; one social-recovery backup of the root (§9.2) reconstructs every persona by re-deriving indices. The device stores the persona index list locally and nowhere else — no persona directory exists, including in backups (Shamir shares reconstruct the root; derivation reconstructs the selves; the shares reveal neither, §18.5).

**Standing (inherited legitimacy).** A persona holds no plaintext 4902 vouches (those would name its subject and leak the link). Instead the root, using its *own* real vouches, issues the persona **anonymous credentials** (§36.1) it can present as "backed by a vouched member of this network/cell" without naming the backer or the root. Bounded by k-show: a root can back at most k active personas per epoch (default 3/quarter), and over-spending self-incriminates. A fresh persona therefore enters cold — "a vouched member, identity sealed" — and cannot ride the root's contact graph (that would be linkage): it earns its *own* graph from people who know only the persona, at which point it is simply an identity whose origin never mattered (§18.3's graduation).

**Presentation in the wild.** When a persona asks, matches, or joins a group, its trust line is the credential presentation, not a named chain: match cards show "a vouched member of this community — identity sealed" (already the anonymous-match copy in §14/UX §12). Inside a group it is a scope_nym (§36.2). Everything else — querying, the consent handshake, messaging — is identical to the primary self's flows; the persona is a full client identity, just one whose backing is proven anonymously.

**Lifecycle and hygiene (wire + UX).** Creation is a settings action (never mid-flow, to avoid cross-contamination): "start a separate self" → derive the next persona index → request anonymous credentials from the root against the root's own vouches (4930/4931, §36.1) → open the persona in a **visually distinct shell** (accent color derived from the persona key, so the user always knows which self is speaking — the #1 practical linkage risk is human error, §18.5). The creation flow shows the §18.5 warning verbatim: *the network can't link your selves; your habits can.* Persona-scoped interest lists carry an **overlap detector**: if a persona's ask closely matches one from another self, the client warns ("this closely matches an ask from your main self — that similarity is linkable") before sending. Personas live behind a separate unlock by default (the compartment-safety concern of §18.5 / §17.6's duress residual).

**Revocation.** Persona standing is only as durable as the underlying vouch: when a backer revokes the root's vouch (4903 void), the anonymous credentials leaning on it fail to renew at the next epoch (§36.1), and the persona silently loses standing — without anyone learning the persona existed (§18.2).

**Residuals restated (honesty, §18.5).** No key derivation defeats behavioral linkage: stylometry, timing correlation, rare-interest fingerprinting, and same-device/IP correlation remain the user's responsibility, mitigated by warnings and the overlap detector, not eliminated. A persona used over the same home connection as the primary is linkable *to that connection* by a network observer — an honest dependency on transport-level tools (Tor-class), out of scope of the routing layer. These are stated at persona creation, not buried.

### 36.4 Registry additions (extends §33.3)

| Kind | Name | Class | Contents & rules | Implements |
|---|---|---|---|---|
| 4930 | **Credential request** | E | Blinded `subject_commitment` + requested attributes, wrapped to the issuer. The anonymous form of asking to be vouched. | §36.1 |
| 4931 | **Credential issuance** | D (delivery) / cached by subject | BBS+ signature over the attribute set, wrapped to the subject. Never public. | §36.1 |
| 4932 | **Group join request** | E | Credential presentation proving in-scope backing + the joiner's `scope_nym` for this group, wrapped to a steward/greeter. | §36.2 |
| 4933 | **Membership grant** | D | Current group key (or MLS `Welcome`) wrapped to the joiner + roster update; issued after 4932 verifies. | §36.2 |

*Notes.* All four ride the standard 1059 gift wrap with randomized `created_at` (§33.4, F3). None links two pubkeys in plaintext (§33.4's social-graph rule): 4930/4931 carry commitments and blinded proofs; 4932 carries a scope_nym and a zero-knowledge presentation; 4933 carries a wrapped key. The credential presentations inside 4912 (group reply), 4932 (join), and rendezvous entry (§17.4) are the *same* object shape — one verifier, three call sites. Existing kinds are unchanged; 4911/4920/4921/4922/4904/4900 already carry the group layer, and 4902's BBS+ form (§36.1) reuses the vouch kind rather than adding one.

### 36.5 The v2 invariant check

Both layers are audited against the five invariants (§9.4, §17.6, §18.6) exactly as the constitution (§26.1) requires:
1. **Encryption layered by lifetime** — credentials are durable-but-private (subject-held), group keys rotate on ejection, presentations are ephemeral. Holds.
2. **Persistence inversely proportional to sensitivity** — no credential, roster, or membership fact is ever public; only hash-referencing voids and the `h`-tagged ciphertext of group traffic touch relays. Holds, and extends F1's social-graph rule to group membership.
3. **Scaling edge-bounded** — group messaging is O(group size) by nature, bounded by Ostrom-scale charters and MLS's O(log n) beyond 150; discovery (group-as-respondent) inherits v0's fan-out×TTL bound. Holds.
4. **Attribute nothing by default** — group membership is pseudonymous (scope_nyms), personas are anonymous by construction, identity enters a group only by a member's own pairwise reveal. Holds, and arguably strengthens the invariant.
5. **Plurality bounded, accountability scoped** — this is the pair of layers that finally makes invariant 5 *enforceable in code* (it was declared honestly unenforceable in v0, §18 / SECURITY): k-show bounds plurality, scope_nyms scope accountability, ejection sticks. Invariant 5 goes live here.

The layers add no new relay-visible linkage, introduce one well-audited cryptographic dependency (BBS+/BLS12-381), and turn the one invariant v0 could only promise into one the code enforces.
