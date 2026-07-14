# Security Policy

Weft's security posture is **architectural first, procedural second**: the design's five invariants (`README.md` § *The five design invariants*) are what protects users, and this document explains how they're enforced in code, how threats we know about are addressed, what threats remain, and how to report vulnerabilities. Security review is co-owned with **Fable**, who reviews any change touching cryptography, wire formats, key handling, or the routing/handshake state machines before it's merged into a release phase.

---

## Reporting a vulnerability

**Please do not open a public GitHub issue for security reports.**

Email: **rebecca.c.sutter@gmail.com** with subject line beginning `[weft-security]`.

Include: a description of the issue, a reproduction if possible, the affected commit/tag, and any suggested mitigation. Encrypted mail welcome — request the current PGP key in an unencrypted opening message.

**Expectations:**
- Acknowledgment within 5 business days.
- A first assessment within 14 days.
- Coordinated disclosure by default; we will not sit on a fix, and we will credit the reporter (or preserve anonymity) as they prefer.
- No bounty program yet (pre-implementation repo).

If a vulnerability affects an already-released phase and its wire format, the fix ships as a new phase with a CHANGELOG entry under `Security`, and — if wire compatibility breaks — a version bump.

---

## Threat model (summary)

Full model: DD §6 and DD §16 (open problems). What follows is the version-controlled summary this repo commits to.

**Adversaries considered:**
- **A1 — passive relay:** sees traffic metadata, ciphertext, and any unpadded routing fields.
- **A2 — active relay:** may drop, delay, tamper with, or inject events; may collude with other relays.
- **A3 — hostile impersonator:** attempts man-in-the-middle by answering someone else's query and unmasking the asker.
- **A4 — hostile contact:** an honest-but-nosy or actively adversarial person inside the user's own contact list (DD §17 A1–A4 taxonomy).
- **A5 — compromised device (single hop):** full protocol visibility at one hop; the user's own device compromise is out of scope of any routing protocol.
- **A6 — supply-chain attacker:** compromises a dependency, a build, the website, or the store binary.

**Adversaries explicitly not in v0 scope** (design acknowledges, defers mitigation):
- Global passive observer correlating timing across many channels (v2: cover traffic).
- Coercive scanning mandates on the client (§ *Legal collision*).
- State-level active adversary with resources for large sybil rings AND edge compromise AND traffic analysis simultaneously.

**Assets protected (in priority order):**
1. Identity linkage of a query to its author.
2. Contents of unrevealed matches and undelivered handshakes.
3. Contents of established pairwise channels.
4. Vouch integrity and revocation-propagation correctness.
5. Availability of the routing layer against selective disruption.

---

## Cryptographic policy

**One rule, and it is inviolate: no hand-rolled cryptography.** Only these libraries provide primitives:

- `@noble/curves` (secp256k1, BIP-340 Schnorr sign/verify)
- `@noble/hashes` (SHA-256, HKDF, PBKDF2, scrypt)
- `@noble/ciphers` (ChaCha20-Poly1305, AES-GCM)
- `nostr-tools` (NIP-01 event shape, NIP-44 v2 encryption, NIP-59 gift wrap)

If a task appears to require a KDF, an AEAD, a curve op, or a signature scheme not covered above, **stop and ask** — do not write it, do not import a fourth crypto library without Fable's review. The build-list §2 pinning is a security control.

**Key hierarchy (DD §9.1):**

| Key class | Storage | Lifetime | Rules |
|---|---|---|---|
| Root identity key | Platform keystore where possible (v0 PWA: passphrase-wrapped in IndexedDB); Secure Enclave / StrongBox in native builds (v2) | Permanent | Never logged, never exported unencrypted, never leaves the device in the clear |
| Pairwise contact keys | Store, encrypted at rest | Durable | ECDH shared + symmetric ratchet; NIP-44 in v0 (not forward-secret); double ratchet in v2 |
| Ephemeral handshake keys | In-memory only, wrapped in the `queryState` / handshake state | Hours–days | **Never touch disk unencrypted.** Zeroed via `withEphemeral` helper (M1-T1) when the operation completes. Reaper (M3-T2) deletes the wrapping state on expiry. |
| Group channel keys | Not implemented in v0 | Rotates on ejection | v2 |

**Sign inside, encrypt outside** (DD §9.1): every inner event is signed by the appropriate key *first*, then sealed and wrapped. Relays authenticate nothing, see nothing; tampering is detected at the endpoint after decryption. The `wrap.unwrap()` function (M2-T2) is where inner-signature verification lives; if a code path invokes `sealTo` on unsigned bytes, that is a bug.

**No WebCrypto in `@weft/core`**: the required curve isn't there (DD §32.2); using WebCrypto for parts of the flow while noble handles others invites subtle inconsistency. Everything uses noble.

---

## Invariant enforcement in code

Each of the five design invariants (`README.md`) is enforced by specific code paths and by specific tests. Both are load-bearing.

### Invariant 1 — Encryption layered by lifetime
- Enforced by the key hierarchy above and by `wrap/` refusing to wrap an unsigned inner event.
- Tested by `core/wrap` roundtrip tests (M2-T2 acceptance).

### Invariant 2 — Persistence inversely proportional to sensitivity
- Enforced by `core/kinds/registry.ts`: each kind has a retention class (E=6h, D=5d, P=none) that populates the `expiration` tag automatically (M0-T2, M1-T2).
- Enforced by the reaper (`store.expireSweep`, M3-T2): active deletion on schedule, not lazy.
- Tested: kind-registry unit tests; reaper test that inserts, advances the fake clock, sweeps, and asserts absence.

### Invariant 3 — Scaling edge-bounded by construction
- Enforced by the query engine (M5-T3): fan-out capped at 3, TTL drawn from `{3,4,5}`, per-contact stamp balance debited on forward, dropped-silently at zero balance.
- Tested: sim scenario that asserts a stamp-zero neighbor forwards nothing.

### Invariant 4 — Attribute nothing by default
- Enforced by `core/routing`: the 4910 query struct has no author field. A **type-shape test** (part of Gate 1, see `TESTING.md`) asserts byte-identical wire shape for authored vs. forwarded queries.
- Enforced by the log-content rules in `OBSERVABILITY.md`: no log line, anywhere, records "who authored this query."
- Enforced by the handshake engine (M5-T4): silent decline emits zero events. Gate 2 in `TESTING.md`.
- **If either release gate ever fails, the release does not ship.**

### Invariant 5 — Plurality bounded, accountability scoped
- Not enforceable in v0 (personas & anonymous credentials are v2, DD §18). This invariant becomes enforceable when the credential machinery ships; v0's honest position is that plural personas *do not exist yet* and creating a "second identity" in v0 is equivalent to a fresh identity with all its inertness.

---

## Specific security controls in v0

### Invite tokens (DD §30)
- Byte-exact wire format with a committed hex fixture (M1-T3): drift is detected by test failure.
- BIP-340 signature over SHA-256 of the CBOR body with the `sig` field absent — verified on redemption (§30.3 step 1).
- Single-use enforced by a **local ledger** on the inviter: a second redemption of the same `iid` surfaces as `replayAlert`, does not publish a second vouch.
- URL form carries the token in the **fragment** (`weft.link/i#<token>`), which browsers never send to any server — the redeemer page never sees the token even if hosted (DD §30.1).
- Consent precedes existence: charter + inviter identity + vouch tier are shown *before* any key is generated (UX §9 acceptance).
- Link theft (SMS interception): DD §15.3 confirmation card converts it to a no-op — the inviter approves the person, not the link.

### Impersonation defense (DD §5 stage 4)
- Vouch signatures verified against the *revealed* identity at Stage 4; mismatch → `impersonationAlert`, no name flip (UX §12 acceptance).
- The impostor has no vouch chain verifiable against the asker's graph → "0 verifiable vouches" is the loud red flag.
- Man-in-the-middle by a relay answering someone's query: burns a real vouched identity for one look, per the same Stage-4 check.

### Sybil defense
- Identities are free (cryptographically); paths through real people are not (socially). Sybil rings form islands with no edges into the target's graph → "N vouches, none within k hops of you" = worthless.
- Vouches expire and require renewal — limits blast radius of stolen keys.
- Voucher quality is tracked locally (private routing feedback): a voucher whose vouches consistently produce bad matches loses ranking weight *with you*, no global score.

### Postage / spam absorption
- Per-contact stamp ledger (M5-T3): forwarding spends stamp budget with the sender's own contacts, so relaying junk costs the spammer their own connectivity first.
- Silent decline: nothing to optimize against.
- Reachability is bounded by graph position — there is no global directory of match tokens.

### Retention / amnesia
- The reaper (M3-T2) actively deletes expired records — not lazy, not on-read.
- Handshake state carries hours-scale TTLs; stalled handshakes evaporate with no residual "who almost-connected" archive.
- Relay retention is enforced by `expiration` tags on every published event (NIP-40) — the relay honeypot is designed to be empty (DD §9.2).

---

## Supply-chain security

The PWA update-trust model is TLS-plus-origin (DD §32.5) — a genuine downgrade versus native signed builds. Mitigations shipped and planned:

- **Pinned dependencies** (build-list §2). No new dep without explicit approval; no lockfile drift without review.
- **`.npmrc`** with `strict-peer-dependencies=false` for pnpm ergonomics but no auto-update of transitive deps outside a pnpm-lock update.
- **Reproducible builds** (v0 goal, formalized in v2): deterministic bundler output; committed lockfile; CI produces a manifest of build hashes per platform.
- **Signed release manifest** (kind 4909, DD §33.2, DD §28.2): the client verifies the manifest signature against **foundation threshold keys** before activating any new service worker. Signing keys are the design's crown jewels and get their own ceremony/rotation procedure before public release (DD §28.6).
- **"If this app disappears" page** (DD §22.3, cached at first install): PWA address, sideload instructions, key-export path — so a takedown degrades reach but cannot erase users.
- **`.claude/` is gitignored** — no local agent state leaks into commits.
- **No untrusted user input in HTML** in the PWA: React by default; any `dangerouslySetInnerHTML` requires Fable review.

Users under targeted threat should graduate to a sideloaded/native build once available (DD §32.5). The PWA is the universal on-ramp; it is not a safe surface against a state-level adversary.

---

## Known gaps (v0 honest catalog)

Each of these is a real weakness with a design response either scheduled (v2) or deferred with a stated tradeoff. Fable's job at each phase review is to check that none of these has silently gotten *worse*.

| Gap | Status | Mitigation / plan |
|---|---|---|
| Sensitive-interest paradox: first-hop contacts can read query embeddings even under origin ambiguity (§DD 16.1, §17) | Deferred to v1.5/v2 | Origin ambiguity (v1.5, ships before at-risk community joins); coarse-route/private-match (v2); anonymous-credential rendezvous (v2/v3). |
| Plural personas are not available (§DD 16.3, §18) | Deferred to v2 | Anonymous-credential machinery, k-show bounds, scoped pseudonyms. |
| No forward secrecy on pairwise channels (NIP-44 only, not double ratchet) | Deferred to v2 | Ship before any at-risk community joins (build-list §13). |
| No cover traffic / padding | Deferred to v2 | Partial prepay by sentinels (v2, DD §10.3). |
| No vouch revocation propagation (v0 uses expiry only) | Deferred to v2 | Ship on first key-compromise incident or before cell #3, whichever first. |
| No disjoint-path redundant routing | Deferred to v2 | Ship when single-path drop rates become visible in beacons. |
| MLS group keying not implemented (v0 groups deferred entirely) | Deferred to v2+ | Naive rotation for ≤150; MLS beyond. |
| PWA storage eviction on iOS (DD §32.4) | Mitigated | Home-screen install treated as onboarding step zero on iOS; earlier & firmer backup nudge. |
| PWA update trust is origin-based (DD §32.5) | Documented, mitigated | Signed release manifest verification; sideload path published. |
| Push infrastructure depends on APNs/FCM (DD §16.5) | Mitigated | Content-free pokes only; polling floor; UnifiedPush where available. |
| CSAM / credible-threats content moderation cannot be centralized (DD §7.3) | Chosen tradeoff | Stated plainly; client-side evidence-preserving reporting path only. |
| Sybil / stolen-key blast radius before revocation propagation | Partial | Vouch expiry (v0); revocation propagation (v2). |
| Root-key loss loses identity + all vouches received | Mitigated (v0), planned (v2) | Encrypted passphrase export (v0); Shamir 3-of-5 social recovery (v2). |

---

## Legal collision (stated, not resolved)

Client-side scanning mandates (UK Online Safety Act, EU proposals, DD §16.6) collide with invariant 4 and DD §7.3. The reference client will not ship scanning; jurisdictions requiring it will be served, if at all, by other clients making their own choices. This is architectural, not policy — and it is stated in `SECURITY.md` before it is tested. See DD §23 for full treatment.

GDPR right-to-erasure vs. signed attestations (DD §16.6): expiry helps; tombstones (kind 4923, deferred in v0) are best-effort like email deletion. Ejection attestations carry evidence hashes only, with evidence held by the ejecting group — this is a design compromise, not a bug.

---

## Incident response

If a security-relevant defect is discovered post-release:

1. Acknowledge the report per the SLA above.
2. Assess and reproduce; Fable and the human designer both sign off on the assessment.
3. Fix in a private branch; write a regression test that fails on the vulnerable code and passes on the fix.
4. If the fix requires a wire-format change, plan a phase boundary and version bump; if not, ship as a patch under the current phase.
5. Coordinate disclosure with the reporter; publish a `CHANGELOG.md` entry under `Security` naming the class of issue (not the specific exploit unless already public), the affected phases, the fix, and the reviewer.
6. If any user-visible material claim in `OBSERVABILITY.md`, `SECURITY.md`, `UX §15`, or the philosophy screen was undermined by the defect, update those documents in the same PR — the trust move is to correct the record.

Silent additions of telemetry, silent removal of invariant tests, or silent weakening of a release gate are treated as security incidents (see also `OBSERVABILITY.md` § *Adding a new metric*).

---

## Review

Fable reviews `SECURITY.md` at every phase boundary against what actually shipped, and reviews code changes to:
- `core/keys`, `core/codec`, `core/wrap` (cryptography)
- `core/invite` (wire format + redemption single-use enforcement)
- `core/routing` (Gate 1 — attribute-nothing)
- `core/handshake` (Gate 2 — zero-events-on-decline; impersonation check)
- `core/store` (retention / reaper correctness)
- Any dependency addition, lockfile change, or bundler configuration touching the release manifest

The human designer signs off alongside Fable. Neither may approve a phase whose release-gate tests are weakened or removed.
