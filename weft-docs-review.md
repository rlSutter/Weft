# Review 2 — the five process docs, and an originality assessment

## Part A — Document review

**Verdict: these are in very good shape.** Claude Code folded in essentially all of the first review's findings — the license decision is made and recorded, the four release gates are named consistently in SECURITY and TESTING, the copy lint now operates on source not the built bundle, Layer 3.5 component tests exist for the three safety-critical UI invariants, store migrations and accessibility items are in TESTING, the `core/relay/` module and `health.ts` are in STRUCTURE, the README carries the UX spec and a minors posture, and the npm scope was actually checked. That is a thorough response.

What remained were small consistency slips plus one open action the docs create. I fixed the slips directly; the action needs a human or a build-list edit.

### Fixed in this pass (already applied to the copies in outputs)
1. **TESTING.md intro said "the two release-gate tests"** while the whole body correctly describes four. Corrected to "four." (Left over from the pre-F1/F2 sentence.)
2. **STRUCTURE.md's repo tree omitted the three LICENSE files** that README now lists and that the License section describes. Added them, so the two maps agree.

### Open — needs your decision, not mine
3. **The build list has no license task, but the repo now ships licenses.** README and STRUCTURE both reference `LICENSE`, `LICENSE-APACHE-2.0`, `LICENSE-AGPL-3.0` as present files, and CHANGELOG's process implies they were added — but `weft-build-list.md` still has no `M0-T0 License` task, so there's no acceptance step ensuring per-package `license` fields in each `package.json` match the split (Apache-2.0 for core/sim, AGPL-3.0 for pwa/porch). **Recommendation:** add one line to the build list M0 — *"M0-T0: LICENSE files present; each package.json `license` field set per the dual-track split; a CI check asserts the field matches the package's path."* Without it, a published `@weft/pwa` could ship with the wrong SPDX identifier and nobody would notice.

### Smaller notes (optional, non-blocking)
4. **CHANGELOG `Unreleased` should now name the docs that landed.** It lists the four process docs as "added" but predates the license files and the §35 revisions; a fresh `Unreleased` entry ("aligned SECURITY/OBSERVABILITY/TESTING/README/STRUCTURE to DD §35; added dual-track LICENSE") would keep the traceability the file promises about itself.
5. **SECURITY's reporting section names a personal Gmail.** Fine for a pre-implementation repo, but once the repo is public and inviting vulnerability reports, a role address (`security@…` on the eventual domain) ages better than a personal one. Non-urgent.
6. **The `weft` PyPI/npm collisions are handled defensively** (scoped names, fallback plan) — good. The one thing still worth doing before M0 publishes anything is *reserving* the chosen npm org, which STRUCTURE already commits the human designer to. Just don't let M0-T1 create packages before that reservation exists, or the fallback-rename tax comes due.

Nothing above blocks Claude Code from beginning M0. Items 3 and 4 are best done in the same commit that starts coding.

### What is genuinely well done and should not be second-guessed
- The **four-gate framing** with file paths, assertions, and "never patch the test to make it pass; fix the drift."
- **Layer 3.5** existing at all — most teams would have left consent-before-key to manual review and shipped the regression.
- The **copy-lint-on-source** correction, with the explicit rationale for why grepping the bundle fails. That reasoning will save a future contributor from re-introducing the broken version.
- **L13's distinction** between project-review authority and DD §26 protocol governance. That is a subtle and correct separation; conflating them is how open protocols quietly become captured.
- **OBSERVABILITY's graph test** ("the graph is not a metric") and the dev-tracer-as-security-boundary rule. Both are exactly right.

---

## Part B — Is any of this original?

A fair question to ask honestly, because the answer shapes how the project should present itself. The short version: **almost none of the primitives are original; a fair amount of the synthesis is; and one or two mechanisms are at least novel-in-combination.** Breaking it down.

### Not original — and shouldn't pretend to be (the primitives)
Nearly every building block is prior art, deliberately so — the design's own rule was "compose existing primitives, spend the innovation budget on the glue":
- **Decentralized identity / self-owned keys** — PGP, DIDs, Nostr keypairs.
- **Web of trust / vouching** — PGP (1991), Scuttlebutt, Nostr WoT scoring, Verifiable Credentials.
- **Semantic-embedding search and routing toward relevance** — standard IR; semantic routing in DHTs and P2P is decades old.
- **Small-world / six-degrees forwarding** — Milgram (1967), Kleinberg's routing results (2000).
- **Onion / mixnet-style path privacy** — Chaum, Tor, mixnets; the route-token blinding is a direct application.
- **Origin ambiguity via forward-for-everyone** — this is *Crowds* (Reiter & Rubin, 1998), cited by name in the design.
- **Commit-then-reveal fair exchange** — textbook cryptography.
- **k-show / anonymous credentials, scoped nullifiers** — Camenisch–Lysyanskaya, BBS+, the nullifier pattern from anonymous-signaling and zk systems.
- **Encrypted blob store + pointer-in-channel media** — exactly how Signal and Matrix do attachments; the "shelf" is Blossom.
- **Local differential privacy, k-anonymity, bucketed/noised telemetry** — established privacy literature.
- **Commons self-governance** — Ostrom (1990), applied nearly verbatim.
- **Store-and-forward, dumb relays** — email/NNTP lineage; Nostr's actual architecture.

If someone says "this is just Nostr plus Tor plus PGP plus Ostrom," they are substantially right about the *parts*.

### Arguably original — the synthesis and a few specific moves
Originality here lives in combination and in a few deliberate inversions, not in new cryptography:
- **The overall thesis as a product** — "social discovery as origin-ambiguous, consent-gated, vouch-routed asks through your real graph, with no feed and no broadcast." The individual ideas exist; assembling them specifically to *replace platform discovery* (rather than platform publishing, which is what Mastodon/Bluesky/Nostr address) is a genuinely different target, and I haven't seen this exact assembly shipped.
- **Rejection made unrepresentable** — designing the protocol so there is literally no "no" message, turning silent-decline from a UI convention into a wire-level guarantee. The insight (silence prevents harassment hooks) exists in product design; encoding it as *the absence of a message kind* and enforcing it with a release-gate test is a sharp, arguably novel framing.
- **Discovery that carries meaning but not media** — asking *with* an embedding while the media itself never leaves the device until a handshake completes. A clean application of existing pieces, but a nice one.
- **"The trust graph IS the social graph, so never publish it"** as a first-class release gate — the observation isn't new (social-network-analysis 101), but treating vouch-privacy as a hard, tested invariant that reshapes the whole storage model is a discipline most WoT systems (PGP keyservers, Nostr) conspicuously *don't* apply.
- **One-mechanism-pays-two-bills as a recurring design value** — postage=battery, sentinels=chaff, chaff=deniability, latency-tolerance=push-independence, persona-credentials=anonymous-rendezvous. This is a *design aesthetic* more than an invention, but it's a coherent and unusual one.
- **The invite token as a single artifact bootstrapping identity + edge + vouch + relay-config + charter-consent** — an engineering synthesis I haven't seen packaged quite this way.

None of these are patentable-grade novel cryptography. They're **novel-in-combination and novel-as-framing** — which is the honest and defensible claim.

### The honest way to describe it
The project should claim exactly what's true and no more: *"Weft invents little and composes deliberately. Its contribution is an architecture and a set of design invariants that arrange well-understood primitives — web-of-trust, small-world routing, Crowds-style origin ambiguity, mixnet path blinding, anonymous credentials, Ostrom-style governance — toward a target most decentralization work doesn't aim at: replacing platform *discovery* without reintroducing a platform. A few mechanisms (rejection as an unrepresentable message; vouch-privacy as a tested invariant; meaning-carrying media that never moves) are, as far as we know, novel in combination."*

That framing is both more honest and more credible than an originality claim would be — and it matches the design doc's own stated philosophy of spending the innovation budget on glue, not primitives.

### One caveat I owe you
I'm assessing novelty from training knowledge, not a literature or patent search, and the decentralized-social space (ActivityPub, AT Protocol, Nostr NIPs, Farcaster, Scuttlebutt, DIDComm, Circles, BrightID, and many research systems) moves quickly and is large. Something close to the "asks hopping a vouch graph with consent-gated reveal" synthesis may exist in a paper or a NIP I don't know. Before making any public originality claim, a real prior-art search is warranted — BrightID and web-of-trust Sybil-resistance projects, DIDComm's connection protocols, and any Nostr NIPs on private groups or WoT discovery are the first places I'd look for overlap.
