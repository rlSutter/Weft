# Security Policy

Weft's security posture is **architectural first, procedural second**: the design's five invariants (`README.md` § *The five design invariants*) are what protects users, and this document explains how they're enforced in code, how threats we know about are addressed, what threats remain, and how to report vulnerabilities. Security review is co-owned with **Fable**, who reviews any change touching cryptography, wire formats, key handling, or the routing/handshake state machines before it's merged into a release phase.

> **Revision note (2026-07-13).** Updated for DD §35 (second adversarial pass). Material changes: the social graph is now a first-class protected asset (F1); three adversary classes added (A7 interest-probing oracle, A8 invite-tree capture, A9 porch-node metadata observer); **four** release gates, not two (F1, F2); vouches are private attestations, never published (F1); route tokens are blinded per hop (F2); the known-gaps catalog is aligned to §35 and now states a **minors posture** (F13).

---

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Preferred: **GitHub private vulnerability reporting** (Security tab → *Report a vulnerability*) — it keeps the report, the fix branch, and the advisory in one place.
Alternative: email **rebecca.c.sutter@gmail.com** with subject line beginning `[weft-security]`.

Include: a description of the issue, a reproduction if possible, the affected commit/tag, and any suggested mitigation. Encrypted mail welcome — request the current PGP key in an unencrypted opening message.

**Expectations:**
- Acknowledgment within 5 business days.
- A first assessment within 14 days.
- Coordinated disclosure by default; we will not sit on a fix, and we will credit the reporter (or preserve anonymity) as they prefer.
- No bounty program yet (pre-implementation repo).

If a vulnerability affects an already-released phase and its wire format, the fix ships as a new phase with a CHANGELOG entry under `Security`, and — if wire compatibility breaks — a version bump.

---

## Threat model (summary)

Full model: DD §6, DD §16, and DD §35. What follows is the version-controlled summary this repo commits to.

**Adversaries considered:**
- **A1 — passive relay:** sees traffic metadata, ciphertext, and any unpadded routing fields.
- **A2 — active relay:** may drop, delay, tamper with, or inject events; may collude with other relays.
- **A3 — hostile impersonator:** attempts man-in-the-middle by answering someone else's query and unmasking the asker.
- **A4 — hostile contact:** an honest-but-nosy or actively adversarial person inside the user's own contact list (DD §17's A1–A4 taxonomy).
- **A5 — compromised device (single hop):** full protocol visibility at one hop; the user's own device compromise is out of scope of any routing protocol.
- **A6 — supply-chain attacker:** compromises a dependency, a build, the website, or the store binary.
- **A7 — interest-probing oracle** *(new, DD §35 F6)*: a contact who does not spam humans but *queries your matcher*, crafting probe embeddings and reading each match reply as one bit. A few hundred silent probes reconstruct declared interests with no handshake ever completed. **This is the attack our own auto-reply behavior creates**, and v0 must ship its mitigations (below).
- **A8 — invite-tree captor** *(new, DD §35 F7)*: a controlling person or high-control group that monopolizes a user's onboarding — controlling their contacts, relay hints, charter, and therefore their entire view of the network. Not a protocol break; an eclipse.
- **A9 — porch-node observer** *(new, DD §35 F8)*: a compromised or curious always-on node that relays a large share of a cell's traffic and therefore sees a large share of its *flow metadata* (who queries when, at what volume). Porch nodes concentrate availability **and metadata** — the earlier claim that they concentrate "availability, not trust" was incomplete.
- **A2′ — colluding non-adjacent hops** *(clarified, DD §35 F2)*: two nodes on the same path comparing notes to reconstruct it. Mitigated by per-hop route-token blinding; Gate 4 tests it.

**Adversaries explicitly not in v0 scope** (design acknowledges, defers mitigation):
- Global passive observer correlating timing across many channels (v2: cover traffic).
- Coercive scanning mandates on the client (§ *Legal collision*).
- State-level adversary combining large Sybil rings, edge compromise, and traffic analysis simultaneously.
- Behavioral/stylometric linkage of a user's personas (v2 feature; DD §18.5 states this residual honestly — no key derivation fixes writing style).

**Assets protected (in priority order):**
1. **The social graph itself** — who vouches for, contacts, or routes for whom. *(Promoted to #1 by DD §35 F1: the trust graph* **is** *the social graph; publishing it would defeat much of the rest of the design, since an adversary maps the warp and then traffic-analyzes the weft.)*
2. Identity linkage of a query to its author.
3. Contents of unrevealed matches and undelivered handshakes.
4. Contents of established pairwise channels.
5. Vouch integrity and revocation-propagation correctness.
6. Availability of the routing layer against selective disruption.

---

## Cryptographic policy

**One rule, and it is inviolate: no hand-rolled cryptography.** Only these libraries provide primitives:

- `@noble/curves` (secp256k1, BIP-340 Schnorr sign/verify)
- `@noble/hashes` (SHA-256, HKDF, PBKDF2, scrypt)
- `@noble/ciphers` (ChaCha20-Poly1305, AES-GCM)
- `nostr-tools` (NIP-01 event shape, NIP-44 v2 encryption, NIP-59 gift wrap)

If a task appears to require a KDF, an AEAD, a curve op, or a signature scheme not covered above, **stop and ask** — do not write it, do not import a fourth crypto library without Fable's review. The build-list §2 pinning is a security control.

**v2 addition (specified, not yet built):** the group and persona layers (DD §36) add exactly one primitive — **BBS+ anonymous credentials over BLS12-381** — via a single audited library (`@noble/curves` supplies BLS12-381; the BBS+ presentation layer comes from a maintained implementation or, only under Fable review with published test vectors, over noble's pairing ops). The pairing and the signature scheme are **never** hand-rolled. This is the sole sanctioned crypto addition for v2; anything beyond it re-triggers "stop and ask."

**Key hierarchy (DD §9.1):**

| Key class | Storage | Lifetime | Rules |
|---|---|---|---|
| Root identity key | Platform keystore where possible (v0 PWA: passphrase-wrapped in IndexedDB); Secure Enclave / StrongBox in native builds (v2) | Permanent | Never logged, never exported unencrypted, never leaves the device in the clear |
| **Device key** *(new — DD §35 F10)* | Same as root, on the secondary device | Permanent per device | A porch node gets **its own keypair**, vouched by and paired to the owner's primary. **The root key is never copied to a second device in v0** — same-key-two-devices forks the stamp ledger and routing sketch, double-answers queries, and would break pairwise ratchets in v2. |
| Pairwise contact keys | Store, encrypted at rest | Durable | ECDH shared + symmetric ratchet; NIP-44 in v0 (not forward-secret); double ratchet in v2 |
| Ephemeral handshake keys | In-memory only, wrapped in `queryState` / handshake state | Hours–days | **Never touch disk unencrypted.** Zeroed via the `withEphemeral` helper (M1-T1) when the operation completes. Reaper (M3-T2) deletes the wrapping state on expiry. |
| Group channel keys | Not implemented in v0 | Rotates on ejection | v2 |

**Sign inside, encrypt outside** (DD §9.1): every inner event is signed by the appropriate key *first*, then sealed and wrapped. Relays authenticate nothing, see nothing; tampering is detected at the endpoint after decryption. `wrap.unwrap()` (M2-T2) is where inner-signature verification lives; if a code path invokes `sealTo` on unsigned bytes, that is a bug.

**No WebCrypto in `@weft/core`.** Two independent reasons: (1) `core/` compiles with zero DOM and zero Node built-ins by architectural law (DD §32.4, `STRUCTURE.md`) — WebCrypto is a platform API and is therefore simply unavailable there; (2) WebCrypto lacks secp256k1 in any case (DD §32.2), so signing must use noble regardless, and keeping key-wrapping (`scrypt` + AES-GCM) on the same audited surface avoids two crypto stacks with two failure modes.

---

## Invariant enforcement in code

Each of the five design invariants is enforced by specific code paths **and** specific tests. Both are load-bearing.

### Invariant 1 — Encryption layered by lifetime
- Enforced by the key hierarchy above and by `wrap/` refusing to wrap an unsigned inner event.
- Tested by `core/wrap` roundtrip tests (M2-T2 acceptance).

### Invariant 2 — Persistence inversely proportional to sensitivity
- Enforced by `core/kinds/registry.ts`: each kind carries a retention class (E=6h, D=5d, P=none) that populates the `expiration` tag automatically (M0-T2, M1-T2).
- Enforced by the reaper (`store.expireSweep`, M3-T2): active deletion on schedule, not lazy.
- **Corrected reading (DD §35 F1):** vouch attestations are *durable but private* — held by their subject, presented peer-to-peer inside match tokens and reveal payloads. They are **not** published to relays and do not "live forever" on any shelf. The only vouch-adjacent object that ever reaches a relay is a hash-referencing void (4903). Relays hold sealed, expiring envelopes and nothing else.
- Tested: kind-registry unit tests (4902 marked `privateOnly`); reaper test; **Gate 3** below.

### Invariant 3 — Scaling edge-bounded by construction
- Enforced by the query engine (M5-T3): fan-out capped at 3, TTL drawn from `{3,4,5}`, per-contact stamp balance debited on forward, dropped silently at zero balance. (The stamp is *ledger accounting*, never a payload field — DD §35 F5.)
- Tested: sim scenario asserting a stamp-zero neighbor forwards nothing.

### Invariant 4 — Attribute nothing by default
- Enforced by `core/routing`: the 4910 query struct has **no author field**, and per-hop **route-token blinding** (`rt`, fresh 16 B per edge, swapped at each hop) means no identifier survives more than one hop (DD §35 F2). QueryIds live only inside the sealed payload.
- Enforced by the log-content rules in `OBSERVABILITY.md`: no log line, anywhere, records who authored a query — or correlates route tokens across hops.
- Enforced by the handshake engine (M5-T4): silent decline emits zero events. There is no decline message *in the protocol*; do not add one, not even as an internal enum that could serialize.
- Tested by **Gates 1, 2, and 4**.

### Invariant 5 — Plurality bounded, accountability scoped
- **Not enforceable in v0** (personas & anonymous credentials are v2). v0's honest position: plural personas *do not exist yet*, and creating a "second identity" in v0 is simply a fresh identity with all of a fresh identity's inertness (zero vouches, no reach).
- **Enforceable in v2, now specified** (DD §36, build-list §16). The BBS+ credential engine bounds plurality via k-show nullifiers (a root backing more than k personas per epoch self-incriminates) and scopes accountability via scoped pseudonyms (an ejected `scope_nym` cannot re-enter its scope). When the persona/group layers ship, this invariant is enforced by tests M13-T1 (v2 release gates 5 and 6), not merely promised.

---

## The four release gates

These encode invariants the design cannot ship without. Full specifications live in `TESTING.md`; they are named here because **no one may weaken or remove them — not Fable, not Claude Code, not the human designer.**

| Gate | Asserts | Protects |
|---|---|---|
| **1 — Byte-identical authored/forwarded query** | An authored 4910 and a forwarded 4910 are byte-identical in wire shape | Origin ambiguity (invariant 4, DD §17.2) |
| **2 — Zero events on decline** | A declining node emits zero events of any kind, in any direction | Rejection cannot become a harassment hook (DD §5 stage 2) |
| **3 — No plaintext vouch reaches a relay** *(new, F1)* | After a full invite→redeem→confirm cycle, MockRelay storage holds zero plaintext 4902s; only hash-referencing voids may appear | The social graph (asset #1) |
| **4 — Reply paths cannot be correlated** *(new, F2)* | Two non-adjacent nodes on a path share no identifying wrapper value for the same query/reply | Origin ambiguity against colluding hops (A2′) |

---

## Specific security controls in v0

### Social-graph confidentiality *(new — DD §35 F1)*
- **No plaintext object linking two member pubkeys may ever be published to a relay** — not a vouch, not a contact list, not an edge of any kind. This is a build-list ground rule and a release gate (Gate 3), not a guideline.
- Vouch attestations (4902) are delivered **wrapped to their subject**, cached locally, and presented as self-contained, offline-verifiable credentials inside match tokens and reveal payloads (DD §9.3, §33.3).
- Verification = signature check + a lookup for a 4903 **void** of the attestation's hash. A void reveals that an issuer voided *something* — never the subject, never the edge.

### Group & persona confidentiality *(v2 — DD §36)*
- Group membership is **pseudonymous by default**: members are present under a `scope_nym`, governance operates on nyms, and no plaintext member-to-group or member-to-member link is ever public (extends Gate 3 to the group layer — build-list M13-T2).
- Personas carry **anonymous credentials**, never plaintext vouches; a persona never rides the root's contact graph; behavioral linkage (stylometry, timing, same-IP) remains the residual DD §36.3 states honestly at persona creation.
- Credential requests/issuance (4930/4931), join requests (4932), and membership grants (4933) carry commitments, presentations, or wrapped keys — never a plaintext pubkey pair.

### Route-token blinding *(new — DD §35 F2)*
- Every 4910 carries a fresh random 16-byte `rt` assigned by the node that handed it to you. Forwarders mint a new token per downstream copy and keep a private swap table (`myToken → upstreamToken, neighbor`).
- Replies carry only the token of the edge they arrived on and are relabeled at each hop. No identifier survives more than one hop. Gate 4 tests it.

### Interest-probing resistance *(new — DD §35 F6; MUST ship in v0)*
Auto-reply-on-match makes every device an oracle. Mitigations, all local and all required before M6 ships to real users:
- **Per-sender match-reply rate limit**, independent of forwarding postage (a probe costs the prober a reply budget with *you*, not just relay budget).
- **Probe-pattern detection:** many high-similarity queries from one edge in a short window → stop auto-replying on that edge and require user confirmation.
- **Jittered thresholds:** the match threshold is perturbed per query so the oracle is noisy and a binary search does not converge cleanly.
- **Sensitive interests may be marked reply-only-after-tap**, never auto-answering.
*Acceptance:* a sim scenario in which a probing node issues 200 crafted queries recovers **no** stable interest signal.

### Invite tokens (DD §30)
- Byte-exact wire format with a committed hex fixture (M1-T3): drift is detected by test failure.
- BIP-340 signature over SHA-256 of the CBOR body with `sig` absent — verified on redemption (§30.3 step 1).
- Single-use enforced by a **local ledger** on the inviter: a second redemption of the same `iid` surfaces as `replayAlert` and publishes no second vouch.
- URL form carries the token in the **fragment** (`weft.link/i#<token>`), which browsers never transmit — the redeemer page never sees the token even when hosted (DD §30.1).
- **Consent precedes existence:** charter + inviter identity + vouch tier are shown *before* any key is generated (UX §9 acceptance — automated, not just manually reviewed).
- Link theft (SMS interception): the DD §15.3 confirmation card converts it to a no-op — the inviter approves *the person*, not the link.
- **Residual (A8):** the token also reveals inviter pubkey and cell relay hints to whoever holds the SMS. Acceptable for ordinary cells; high-risk cells should use in-person QR. *Cloaked invites* (inviter identity encrypted to a per-token key) are a v2 extension.

### Onboarding-eclipse resistance *(new — DD §35 F7)*
- The client privately notes when **all** of a user's paths run through a single person and says so gently ("your asks currently all travel through one person") — a health note, never a nag, never shared.
- Public-relay fallbacks cannot be removed by an invite or a charter; rendezvous reachability cannot be disabled by a charter. An inviter shapes a user's start; it must not be able to own their exits.

### Impersonation defense (DD §5 stage 4)
- Vouch attestations are verified against the *revealed* identity at Stage 4; mismatch → `impersonationAlert`, **no name flip** (UX §12 acceptance).
- An impostor has no attestation chain verifiable against the asker's graph → "0 verifiable vouches" is the loud red flag.
- A relay answering someone's query to unmask them burns a real vouched identity for one look, by the same Stage-4 check.

### Sybil defense
- Identities are free (cryptographically); paths through real people are not (socially). Sybil rings form islands with no edges into the target's graph → "N vouches, none within k hops of you" = worthless.
- Vouches expire and require renewal — bounding the blast radius of stolen keys.
- Voucher quality is tracked **locally** (private routing feedback). No global score exists to farm.

### Postage / spam absorption
- Per-contact stamp **ledger** (M5-T3): forwarding spends budget with the sender's own contacts, so a spammer strangles their own connectivity first.
- Silent decline: nothing to optimize against.
- Reachability is bounded by graph position — there is no global directory of match tokens to scrape.

### Retention / amnesia
- The reaper (M3-T2) actively deletes expired records — not lazy, not on-read.
- Handshake state carries hours-scale TTLs; stalled handshakes evaporate with no residual "who almost-connected" archive.
- Every published event carries an `expiration` tag (NIP-40); **wrapper `created_at` is randomized** over the past 48 h (DD §35 F3) so timestamps cannot be used for traffic correlation.
- The relay honeypot is designed to be empty (DD §9.2) — and, post-F1, *actually is*: no graph, no vouches, no plaintext.

---

## Minors *(stated gap — DD §35 F13)*

**Weft v0 is not designed for, tested for, or offered to users under 18.**

This is the project's largest open safety gap, and it is stated here rather than discovered later. The tension is real: age assurance conflicts directly with an identity architecture that holds no documents and no personal data, while "we simply don't serve minors" is unenforceable on its own. The design directions (DD §35 F13) — cells and institutions as age-context bearers, charter-level minor-safe modes (group-mode matches only, no 1:1 with unvouched adults), and an explicit v1 posture — require a dedicated design cycle with child-safety expertise. That cycle has **not** happened. Until it does:

- The reference client carries no age gate that would be security theater, and makes no claim of one.
- No cell should onboard minors; the steward kit will say so.
- Any feature that would make Weft more attractive to minors (school cells, youth-org seeding) is out of scope until the design cycle completes.

---

## Supply-chain security

The PWA update-trust model is TLS-plus-origin (DD §32.5) — a genuine downgrade versus native signed builds. Controls:

- **Pinned dependencies** (build-list §2). No new dep without explicit approval; no lockfile drift without review.
- **`ignore-scripts=true` in `.npmrc`.** Dependency install scripts are the single most-exploited supply-chain vector; nothing in the pinned stack needs them.
- **`pnpm audit` in CI**, failing on high/critical. Lockfile committed; renovation is a reviewed PR, never automatic.
- **Reproducible builds** (v0 goal, formalized in v2): deterministic bundler output; committed lockfile; CI emits a manifest of build hashes per platform.
- **Signed release manifest** (kind 4909, DD §33.2, §28.2): the client verifies the manifest signature against **foundation threshold keys** before activating any new service worker. Signing keys are the design's crown jewels; key ceremony, threshold signing, and rotation are specified before public release (DD §28.6).
- **"If this app disappears" page** (DD §22.3, cached at first install): PWA address, sideload instructions, key-export path — a takedown degrades reach but cannot erase users.
- **Dev-only code cannot ship:** a CI check asserts the sim tracer/inspector/ladder modules are unreachable from the `pwa` and `porch` bundle graphs (`OBSERVABILITY.md`).
- **`.claude/` is gitignored** — no local agent state leaks into commits.
- **No untrusted input in HTML:** React by default; any `dangerouslySetInnerHTML` requires Fable review.

Users under targeted threat should graduate to a sideloaded/native build once available (DD §32.5). The PWA is the universal on-ramp; **it is not a safe surface against a state-level adversary**, and the app says so plainly (UX §21).

---

## Known gaps (v0 honest catalog)

Each is a real weakness with a design response scheduled or a tradeoff stated. Fable's job at each phase review is to confirm none has silently gotten *worse*.

| Gap | Status | Mitigation / plan |
|---|---|---|
| **Minors entirely unaddressed** (F13) | **Open — largest gap** | Stated posture above; dedicated design cycle required before any youth-adjacent cell. |
| Sensitive-interest paradox: first-hop contacts can read query embeddings even under origin ambiguity (DD §16.1, §17) | Deferred to v1.5/v2 | Origin ambiguity (v1.5, ships before any at-risk community joins); coarse-route/private-match (v2); anonymous-credential rendezvous (v2/v3). |
| Interest-probing oracle (F6) | **Mitigated in v0 — must ship** | Reply rate limits, probe detection, jittered thresholds, reply-only-after-tap. Sim test required. |
| Invite-tree capture / onboarding eclipse (F7) | Partially mitigated in v0 | Single-path health note; unremovable relay/rendezvous fallbacks. |
| Porch nodes observe intra-cell flow metadata (F8) | Documented, partially mitigated | Plural porch nodes per cell (mandatory in the steward kit); randomized first-hop selection; porch route tables in RAM only. |
| Group-as-respondent is unspecified (F9) | Open (spec) | The most common match type in the UX has no wire meaning yet; must be specified before groups ship. |
| Multi-device key handling (F10) | **Fixed in spec** | Porch nodes get their own device key, vouched by the primary. Root keys are never copied. |
| Terms are not yet coded predicates (F11) | Open (spec) | Free-text terms would be a *consent* bug across languages; terms must be an enumerated registry. |
| Store schema migrations (F12) | Open | `schema_version` + forward-only migrations + a CI migration test (M3). |
| No forward secrecy on pairwise channels (NIP-44, not double ratchet) | Deferred to v2 | Ship before any at-risk community joins. |
| No cover traffic / padding | Deferred to v2 | Partially prepaid by sentinels (DD §10.3). |
| No vouch revocation propagation (v0 = expiry only) | Deferred to v2 | Ship on first key-compromise incident or before cell #3, whichever comes first. |
| No disjoint-path redundant routing | Deferred to v2 | Ship when single-path drop rates become visible. |
| MLS group keying (groups deferred entirely in v0) | Deferred to v2+ | Naive rotation ≤150 members; MLS beyond. |
| PWA storage eviction on iOS (DD §32.4) | Mitigated | Home-screen install as onboarding step zero; earlier, firmer backup nudge. |
| PWA update trust is origin-based (DD §32.5) | Documented, mitigated | Signed release manifest; sideload path published. |
| Push depends on APNs/FCM (DD §16.5) | Mitigated (v2 feature) | Content-free pokes only; polling floor; UnifiedPush where available. |
| CSAM / credible threats cannot be centrally scanned (DD §7.3) | **Chosen tradeoff** | Stated plainly; client-side evidence-preserving reporting only. The same property that stops us scanning stops anyone else scanning everyone. |
| Root-key loss loses identity + all vouches received | Mitigated (v0), planned (v2) | Encrypted passphrase export (v0); Shamir 3-of-5 social recovery (v2). |
| Claims discipline: public docs must not outrun the code (F16) | Process control | Manifesto/overview/philosophy screen re-audited against this catalog at **every** phase boundary. |

---

## Legal collision (stated, not resolved)

Client-side scanning mandates (UK Online Safety Act, EU proposals; DD §16.6, §23.3) collide with invariant 4 and DD §7.3. The reference client will not ship scanning; jurisdictions requiring it will be served, if at all, by other clients making their own choices. Stated here **before** it is tested, deliberately.

GDPR right-to-erasure vs. signed attestations (DD §16.6, §23.1): post-F1 the exposure is much smaller — attested payloads carry pseudonymous keys, context codes, and dates, never names, and vouches are not published at all. Tombstones (kind 4923, deferred in v0) remain best-effort, like email deletion. Ejection attestations carry evidence *hashes* only, with evidence held by the ejecting group.

---

## Incident response

1. Acknowledge the report per the SLA above.
2. Assess and reproduce; Fable and the human designer both sign off on the assessment.
3. Fix in a private branch; write a regression test that **fails on the vulnerable code and passes on the fix**.
4. If the fix requires a wire-format change, plan a phase boundary and version bump; otherwise ship as a patch under the current phase.
5. Coordinate disclosure with the reporter; publish a `CHANGELOG.md` entry under `Security` naming the class of issue (not the exploit, unless already public), the affected phases, the fix, and the reviewer.
6. **If any user-visible claim** in `OBSERVABILITY.md`, `SECURITY.md`, UX §15, the philosophy screen, the manifesto, or the overview was undermined by the defect, update those documents in the same PR. The trust move is to correct the record — a project whose moat is honesty cannot let its most-quoted document be its least-precise one (F16).

Silent additions of telemetry, silent removal of invariant tests, and silent weakening of any release gate are themselves treated as security incidents.

---

## Review

Fable reviews `SECURITY.md` at every phase boundary against what actually shipped, and reviews code changes to:
- `core/keys`, `core/codec`, `core/wrap` (cryptography)
- `core/invite` (wire format, single-use enforcement, **private vouch delivery — Gate 3**)
- `core/routing` (**Gate 1** attribute-nothing; **Gate 4** route-token blinding; probe resistance)
- `core/handshake` (**Gate 2** zero-events-on-decline; impersonation check)
- `core/store` (retention / reaper correctness; migrations)
- Any dependency addition, lockfile change, or bundler configuration touching the release manifest

The human designer signs off alongside Fable. **Neither may approve a phase whose release-gate tests are weakened or removed.**
