# Changelog

> **Canonical status.** *Governs:* history of what shipped when, phase-by-phase, with reviewer sign-off recorded per entry. *Defers to:* nothing — this is the log; other docs describe intended state, this doc records realized state. *Last reviewed:* 2026-07-19 (post-v0.1.0-alpha, pre-M9 groups build). Every substantive change to any other root doc must produce an entry here.

All notable changes to Weft are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning will follow [Semantic Versioning](https://semver.org/) once code ships.

**Phase model.** Weft ships in phases (roughly one per build-list milestone or coherent slice of one). Each phase is a released tag (`v0.M0`, `v0.M1`, …) and gets its own section here. `Unreleased` accumulates work in progress. Every phase entry names the collaborator who reviewed it — Fable reviews design and code for this repo alongside the human designer, and reviews are recorded here for traceability.

**Entry conventions.**
- Group changes under: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- Reference the build-list milestone/task (`M1-T3`), DD section (`DD §30`), or UX spec section (`UX §12`) that a change implements.
- Wire-format changes (invite token bytes, event-kind numbers, tag names) are called out under **Wire** and always require a version bump under the phase model.
- Reviewer: append `— reviewed by: {name}` to the phase heading once review is complete.

---

## [Unreleased]

### Added — 2026-07-25 — persona layer (M11 T1–T2) — reviewed by: pending

The v2 persona layer is live in `core/src/persona/`. Personas are unlinkable
secondary selves; siblings and root are cryptographically unlinkable at the
key level, but ALL personas share the root secret for k-show purposes —
which is what enforces "no root exceeds k active personas per epoch."

- **M11-T1** derivation + tracking + k-show binding.
  * `personaRoot(rootSecret, index)` — hardened HKDF-SHA256 → secp256k1
    keypair. Rejection-resamples on the ~2^-128 invalid-scalar branch.
  * `PersonaDirectory` — local index list with add / remove / find /
    serialize / deserialize. `removePersona` refuses index 0 (root
    persona is load-bearing). Serialized directory travels in the
    encrypted backup blob (§9.2) so a single social recovery
    reconstructs every persona by re-deriving from root + index.
  * `personaShareTicket(rootSecret, personaIndex, issuerId, epoch,
    challenge)` — wraps M9-T2's `makeShareTicket` with
    `showIndex = personaIndex mod k`. The (k+1)th active persona in
    a given (issuer, epoch) forces a nullifier collision; two colliding
    presentations with distinct verifier challenges recover the root
    via `detectDoubleSpend`. Cheating is self-incriminating; honest
    use within k is fully unlinkable.

- **M11-T2** persona as full client identity (sim).
  * Persona ships as an ordinary Nostr identity (keypair derived from
    root) plus anonymous BBS+ credentials obtained from cells.
  * Uses the identical M9/M10 engines — no persona-specific plumbing
    at the protocol layer.
  * Sim verifies: persona's Nostr pubkey unrelated to root's;
    persona presents a credential yielding a scope_nym (never its
    Nostr pubkey); two personas from the same root produce distinct
    scope_nyms in the same cell (credentials are per-persona);
    contacts are per-persona; deriveKSign accepts persona-generated
    inputs; directory survives a serialize/restore cycle.

**Deferred: M11-T3 (PWA persona UX)** — promoted to standalone
milestone **M11.5** in `weft-build-list.md`. Same scope-boundary call
as M10-T6/M10.5: settings creation, distinct shell tint, §18.5 warning,
overlap detector, separate unlock is genuinely multi-day PWA work and
belongs on its own milestone. Protocol half is complete today.

Test count workspace-wide: **262 total** (was 234). Core: 206
(was 185). Sim: 50 (was 43).

### Added — 2026-07-20 through 2026-07-25 — v2 credential + group layers (M9 + M10 T1–T5) — reviewed by: pending

The v2 credential engine (M9) and group layer (M10-T1 through T5) are now
live in `core/`. Ostrom-scale groups (≤150 members) can create charters,
admit members via blind issuance, exchange messages under a shared group
key with O(n) rotation, eject members whose scope_nyms are permanently
blocked, and respond as a group without exposing which member is answering.

Test count workspace-wide: **234 total** (was 157). Bundle size PWA:
446 KB / 150 KB gzip (unchanged from M9 — new group code is in `core/`
and not yet imported by the alpha PWA).

**M9 — Credential engine (`core/src/cred/`) shipped in full:**
- **M9-T1** BBS+ wrapper (`cred.ts`, `bbs.ts`) over the IETF blind-BBS +
  per-verifier-pseudonym drafts. Wraps `@digitalbazaar/bbs-signatures`
  via the [rlSutter fork](https://github.com/rlSutter/bbs-signatures)
  that adds `./blind` and `./pseudonym` subpath exports (upstream PR
  [digitalbazaar/bbs-signatures#22](https://github.com/digitalbazaar/bbs-signatures/pull/22)
  pending). Attribute schema per DD §36.1: 5 cleartext + 1 committed.
- **M9-T2** k-show nullifiers (`nullifier.ts`) — Brands' double-spending
  trapdoor over BLS12-381 Fr; the (k+1)th over-spend recovers the root
  secret in the clear (self-incrimination).
- **M9-T3** credential-bound scope_nym — refactored T1 to use the
  pseudonym-BBS variant end-to-end. Determinism within scope + cross-
  scope unlinkability + binding (forger without `nym_secret` fails)
  + `k_cred` lifecycle helpers (`backupForCell`, `restoreFromBackup`,
  `dropForCellOnLeave`).
- **M9-T4** epoch clock, 4930/4931 wire flow, 4903 revocation via
  handle. Sim test: subject requests, issuer issues, subject verifies,
  presents; issuer voids → next verify fails.

**M10 — Group layer (`core/src/group/`) shipped T1 through T5:**
- **M10-T1** charter + roster + group-key AEAD (`charter.ts`,
  `roster.ts`, `group-crypto.ts`). Kind 4900 with v2 field set;
  m-of-n amendments; cell id = genesis event id; roster tracks active
  + ejected sets (ejection-sticks enforced by the data structure);
  XChaCha20-Poly1305 for group-key AEAD.
- **M10-T2** join flow with blind issuance (`join.ts`, `k-sign.ts`).
  4932 signed by fresh `p_join_eph`; 4933 wrapped to `p_join_eph`;
  4922 consent receipt signed by cell-scoped `k_sign = HKDF(nym_secret,
  scope_id)`. Sim test asserts the greeter's full view contains no
  bytes of the joiner's identity pubkey.
- **M10-T3** messaging + O(n) rotation (`messaging.ts`). 4920 messages
  under the group key, h-tagged; sender is scope_nym inside ciphertext.
  4921 rotation packages one NIP-44 seal per remaining member's
  `p_sign`. Ejected members can't decrypt post-rotation.
- **M10-T4** ejection = key rotation (`ejection.ts`). 4904 m-of-n
  ejection attestation with structured `EjectionVerdict` (below-
  threshold, foreign-signer, duplicate-signer, wrong-cell, bad-
  signature). Followed by 4921 excluding the ejected `scope_nym`.
- **M10-T5** group-as-respondent (`respondent.ts`) — completes DD §35
  F9. 4911 declarations encrypted under the group key; grp-tagged
  4912 replies carry a scope-bound credential presentation; verifier
  checks scope binding + auth list + BBS proof validity.

**Deferred: M10-T6 (MLS transition, >150 members)** — promoted to a
standalone milestone **M10.5** in `weft-build-list.md`. Rationale
recorded there: the work (MLS library evaluation or vendoring, migration
bridge, sim tests with 200-member groups) is multi-day and blocks nothing
at Ostrom scale. Ostrom-scale groups are fully supported by M10-T1–T5
today.

**Wire kinds promoted out of `v2Only` during this phase:**
- M9-T4: 4930 CredentialRequest, 4931 CredentialIssuance
- M10-T2: 4922 CharterConsentReceipt, 4932 GroupJoinRequest, 4933 MembershipGrant
- M10-T3: 4920 GroupMessage, 4921 GroupKeyRotation
- M10-T4: 4904 EjectionAttestation
- M10-T5: 4911 GroupInterestDeclaration

Remaining `v2Only`: {4905 HealthBeacon, 4906 RelayOps, 4907 ModelRegistry,
4923 Tombstone, 4924 EscrowSetup} — all v2.1+ features per build-list §13.

**Non-obvious details worth remembering** (also in commit messages):
- `@digitalbazaar/bbs-signatures` has an ordering bug: blind functions
  compute default `api_id` before resolving the ciphersuite string, so
  passing a string yields a garbage api_id. Workaround: pass `api_id`
  explicitly to every call. Candidate for a second upstream PR.
- `signer_nym_entropy` is a `bigint` scalar, not "bytes of entropy".
- `L` in `BlindProofVerify` is the CLEARTEXT message count.
- Scope_nym is **48 bytes** (BLS12-381 G1 compressed), not 32.
- Group keys can't be sealed directly through NIP-44 (UTF-8 roundtrip
  is lossy). The rotation code hex-encodes before sealing.
- Recovered root from `detectDoubleSpend` is Fr-reduced; byte-compare
  against `raw_root mod Fr.ORDER`.
- Revocation-handle disclosure costs cross-scope pseudonym unlinkability
  for handle-observers — accumulator scheme deferred to v3.

### Fixed (spec) — 2026-07-19 — reviewed by: Fable

- **DD §36.1 amendment: scope_nym is now a credential-bound nullifier.** Rewritten as `PRF(k_cred, scope_id)` where `k_cred` is a per-credential secret committed in the credential and proven in ZK — replacing the earlier `PRF(root_secret, scope_id)` which silently made unlinkability-from-issuance and bounded-compromise conditional on root-secret secrecy. Adds `k_cred_commitment` to the credential attribute list and a `k_cred` lifecycle paragraph (backup-blob storage for current memberships; discard-on-leave as client discipline). Also carries a "Why not `PRF(root_secret, scope_id)`" callout so the failure mode isn't rediscovered later. Landed after the read-back cycle recorded in `SYNTHESIS-NOTES.md`.
- **DD §36.2 amendment: greeter blind issuance.** Adds an explicit "Greeter blind issuance" paragraph specifying that 4933 is delivered to a fresh joiner-supplied ephemeral pubkey `p_join_eph` and that the 4922 consent receipt is signed by a cell-scoped signing key `k_sign = PRF(k_cred, scope_id ‖ "sign")` — **no joiner identity pubkey on the join path**. Closes the group-layer form of §35 F7. Registry rows for 4932 and 4933 updated to match. Stated residual: greeter still observes join *timing* and the *carrying relay* (join-path instance of §35 F8).
- **DD §36.2 wording fix: "sender-keys" → "shared group key with per-member key-wrapping".** Follows the D3 correction Fable already made in `GROUPS.md`. Same construction — one shared symmetric group key that every member decrypts with, plus per-member wrapping keys used only to deliver the shared key — the earlier "sender-keys" phrasing invited confusion with Signal/MLS's distinct sender-keys scheme.
- **`GROUPS.md`** — corrected on scope_nym derivation (credential-bound ZK nullifier, not raw PRF), the small-group key scheme (per above), and 4911/roster details. Added a "Sharp edges the design answers" section stating the greeter-bottleneck, per-cell Sybil surface, no-appeal (exit-and-fork is appeal), cold-join = equity-ladder problem, and MLS threshold one-wayness properties so implementers don't rediscover them as open questions.
- **`SECURITY.md` gap table** updated: F9 (group-as-respondent) moves from *Open (spec)* to *Specified in DD §36.2*; a new row records F7-group-layer as *Fixed in spec* by the DD §36.2 amendment.

### Added — 2026-07-19

- **`SYNTHESIS-NOTES.md`** — process note capturing the meta-lesson from the GROUPS.md review cycle: compressed spec formulas often hide security-critical detail; the safety-carrying object is often the surrounding words, not the formula. Seven rules plus a pre-publish checklist, applicable to any future paraphrase of `weft-design.md` (READMEs, landing pages, steward guides, marketing copy).
- **Root docs canonicalized.** Every root document now carries a *Canonical status* blockquote naming what it governs, what it defers to, and when it was last reviewed, so future build sessions can point at a doc and know its authority is current. `STRUCTURE.md` refreshed to reflect that M0–M8 shipped and `weft/docs/` holds `manual-tests.md`; stale "Fable is revising" notes removed.

### Removed — 2026-07-19

- Review-cycle artifacts, purpose served: `weft-fixes-for-claude-code.md` (Fable's build-fix instructions, applied), `weft-groups-critique.md` (Fable's critique of GROUPS.md, corrections landed in the doc itself), `weft-dd-amendments-proposed.md` (the read-back to Fable, amendments now normative in `weft-design.md`), `weft-amendments-fable-signoff.md` (Fable's sign-off, content is in DD).

---

*(next phase entries appear here)*

---

## [0.1.0-alpha] — 2026-07-17 — First feature-complete PWA — reviewed by: pending

The PWA is now a real client — no longer a skeleton. Two browser profiles
can complete the full loop end-to-end: **invite → redeem → confirm →
declare interests → ask → match → connect → reveal → chat**, all against
public Nostr relays.

### Added
- **`weft/packages/pwa/src/weft-client.ts` — `WeftClient` runtime.** Owns
  the store, relay pool (SimplePool over Damus + nos.lol by default),
  embedder, and all three engines. Wires their subscriptions and
  dispatches inbound 1059 wraps to every engine. Exposes a listener-based
  state that React subscribes to via context. State slices: `asksOut`,
  `activeMatches`, `revealed`, `impersonationAlerts`, `conversations`,
  `invites`, `pendingConfirmations`, `interests`, `counters`.
- **`weft/packages/pwa/src/context.tsx` — `WeftProvider`, `useWeft()`,
  `useRoute()`.** Hash-based router (`#ask`, `#invite`, `#why`,
  `#match/:queryId`, `#chat/:peer`, `#i/:token` for invite redemption).
  Manages identity lifecycle (fresh keygen on onboarding; adopt redeemed
  keypair on invite path; wipe on reset).
- **`weft/packages/pwa/src/App.tsx` — real screens.** Onboarding, Home
  (asks-out, active matches, pending confirmations, impersonation alerts,
  declared interests, invites-out, conversations, Why-It-Works link),
  AskScreen (calls `client.ask()`), MatchScreen (masked → Connect/Pass →
  Reveal → Say hello), ChatScreen (send/receive pairwise messages),
  InviteScreen (create invite → shareable URL → invites-out list with
  status), RedeemScreen (parses URL fragment → charter consent → adopts
  redeemed identity), ConfirmationCard (Alice's "Someone joined with your
  invite" prompt), WhyItWorks (counters + honest surfaces).
- **Declared-interests UI** on Home. Type interest, click Add, chip
  appears; incoming asks match against them. Session-only in the alpha.
- **Handshake auto-commit.** `HandshakeEngine.initiate()` accepts optional
  `identityForAutoCommit`. When the terms response arrives, the engine
  sends our commit automatically without a UI round-trip. Removes a
  timing race between "advance stage to termsAgreed" and "send commit."
- **`weft/docs/manual-tests.md`** — Layer-5 manual test protocol per
  TESTING.md. Test 1 (headless E2E on public relays), Test 2 (two-profile
  browser flow), Test 3 (three-node porch scenario, deferred to v0.1.1).

### Fixed
- **`weft/packages/porch/src/index.ts` SimplePool adapter** — passed
  `[filter]` (array) where nostr-tools 2.23 wants a single `filter`
  object. Silently broke subscribe on some relays (Primal rejected, others
  quietly dropped). Caught during the Layer-5 headless run.
- **`weft/packages/core/src/globals.d.ts`** (Fable Fix 1) — declares
  ambient `TextEncoder`, `TextDecoder`, `setTimeout`, `clearTimeout` so
  `@weft/core` type-checks with `lib: ["ES2022"]` + `types: []` intact.
  Locks in DD §32.4 purity against transitive `@types/node` leakage from
  vitest's dependency graph. — reviewed by: Fable

### Verified (Layer 5, real infrastructure)
- **Headless E2E script passes** on `wss://relay.damus.io` +
  `wss://nos.lol`: invite → redeem → confirm → ask → match → initiate →
  Pass. Every publish acknowledged 2/2. **Gate 3** (no plaintext 4902) and
  **Gate 2 initiator side** (zero events after Pass) confirmed on the real
  wire. Repeatable via `packages/porch/scripts/e2e-public-relay.mts`.
- **Milestones M0–M8 all shipped.** 145 tests passing (`pnpm -r test`),
  build clean, lint clean, license CI green. PWA bundle 341 KB / 114 KB
  gzip.

### Not in this release (honest catalog)
- **Key storage is plaintext in localStorage.** Alpha testers only.
  Passphrase-wrapped storage is a v2 IOU.
- **No key backup UX.** Losing localStorage = losing the identity. Shamir
  3-of-5 social recovery is a v2 IOU (DD §9.2).
- **No QR scan.** Invites shared as URLs. `@zxing/browser` is a dep but
  the scanning UI is unwired.
- **No push notifications.** UI must be open to receive events.
- **Declared interests are session-only.** Persistence lands in v0.1.1.
- **UX §14–15 fidelity is partial.** Design tokens match; animations
  (ripple, dot pulse, reveal flip) are simpler than the mockup. Full UX
  pass scheduled for v0.1.1.
- **Layer 3.5 component tests deferred** — jsdom + `@testing-library/react`
  not wired. The three safety-critical UI invariants are sim-verified,
  not UI-verified.
- **Three-node porch-in-middle manual test deferred** to v0.1.1.
- **`relay.primal.net` incompatible** with our filter format; not in
  `DEFAULT_RELAYS`.
- **Groups, personas, media, voice, beacons, standing asks, real MiniLM
  embeddings** — all v2 spec-complete but code-absent per build-list §13.

### Files added or substantially changed in v0.1.0-alpha
- Added: `weft/packages/pwa/src/weft-client.ts`, `weft/packages/pwa/src/context.tsx`, `weft/docs/manual-tests.md`.
- Substantially rewritten: `weft/packages/pwa/src/App.tsx`, `weft/packages/pwa/package.json` (adds `nostr-tools` dep).
- Small: `weft/packages/core/src/handshake/engine.ts` (auto-commit path).

---

## [Prior work — pre-alpha]

### Verified (Layer 5, real infrastructure) — 2026-07-17
- **Layer-5 manual test passed against public Nostr relays** (`wss://relay.damus.io`, `wss://nos.lol`). Full flow ran in ~35 seconds: Alice creates invite → Bob redeems (4918 wrapped) → Alice confirms (4902 vouch delivered wrapped + 4919 hello) → Alice asks "koji fermentation" → Bob's engine matches → Alice initiates handshake → Alice taps Pass. Every publish acknowledged by both relays (2/2). All assertions passed. Repeatable via `weft/packages/porch/scripts/e2e-public-relay.mts`.
- **Gate 3 verified on the real wire.** A global subscription monitoring every kind-4902 event on the relays during the run captured zero plaintext vouches from either party. Bob's cached vouch is signed by Alice, verifiable, and lives only in his local store. The design's foundational asymmetry (warp private, weft ambiguous) holds against actual public infrastructure.
- **Gate 2 verified (initiator side) on the real wire.** After Alice's `Pass()`, zero additional events were emitted. The design's canonical silent decline — "no decline enum, no NACK, no receipt" — holds. Responder-side Gate 2 (Bob passing on a ping) remains sim-verified pending a follow-up two-node run with a proper handshake round-trip.

### Added
- **Milestones M0–M8 complete** (see git log for per-milestone commits). Protocol engine, sim harness, PWA skeleton, and porch CLI all shipped. 145 tests passing (`pnpm -r test`), lint clean, dual-track license CI check green. All four v0 release gates code-verified in sim (Gates 1–4); Gate 3 and Gate 2-initiator additionally verified on public relays per the Layer-5 result above.
- **`packages/core/src/globals.d.ts`** (Fable Fix 1) — declares ambient `TextEncoder`, `TextDecoder`, `setTimeout`, `clearTimeout` under `declare` so `@weft/core` type-checks with `lib: ["ES2022"]` + `types: []` intact. Locks in DD §32.4 purity against transitive `@types/node` leakage from vitest's dependency graph. — reviewed by: Fable
- **`weft/packages/porch/scripts/e2e-public-relay.mts`** — Layer-5 manual test script. Reusable: `npx tsx scripts/e2e-public-relay.mts` in `packages/porch/`. Should be re-run at every phase boundary before release.

### Fixed
- **`packages/porch/src/index.ts` SimplePool adapter** — `subscribeMany` was passing `[filter]` (array) instead of `filter` (single object). nostr-tools 2.23 changed the signature; the array form silently degrades to a malformed REQ that some relays (relay.primal.net) reject and others quietly drop. Discovered during the Layer-5 run.

### Known caveats worth stating
- **PWA is a UI skeleton, not a functional client yet.** `AskFlow` doesn't call `queryEng.ask()`; onboarding doesn't parse invite URLs; there's no match card, reveal flip, or conversation thread. The M6 browser-profile manual test cannot run until this wiring lands. The Layer-5 test above uses two in-process nodes exercising the same engines the PWA would.
- **`relay.primal.net` is currently incompatible** with our filter format; using it silently fails. Dropped from the manual-test relay set. Worth investigating before treating Primal as a supported relay.
- **Gate 2 responder side is not yet on-wire verified** — sim proves the engine emits zero events on Pass; the Layer-5 script proves the *initiator* emits zero after Pass. A follow-up two-terminal run with a proper query-engine → handshake-engine handoff would close the loop.

### Added (pre-implementation docs, unchanged)
- `CHANGELOG.md`, `TESTING.md`, `OBSERVABILITY.md`, `SECURITY.md` — pre-implementation process documents establishing how the phased build will be recorded, tested, observed (without surveilling users), and audited for security.
- Dual-track `LICENSE` (Apache-2.0 for `core`/`sim`/docs, AGPL-3.0 for `pwa`/`porch`), recorded in DD §26.3 and enforced by a new build-list task **M0-T0** (per-package `license` field CI check). Resolves DD §35 F14. — reviewed by: Fable

### Changed
- Aligned `SECURITY.md`, `OBSERVABILITY.md`, `TESTING.md`, `README.md`, `STRUCTURE.md` to DD §35 (second adversarial pass): four release gates (was two), social graph promoted to protected asset #1, adversaries A7/A8/A9 added, copy-lint moved to source-only, Layer 3.5 component tests, store-migration and accessibility tests. — reviewed by: Fable

### Wire
- **DD §33 registry additions (pre-code, so no released wire to bump yet):** kind **4911** group-interest declaration and `grp`-tagged **4912** group reply (group-as-respondent, F9; v2 behavior, registry-complete now); kind **4927** terms-predicate registry (F11 — terms are coded predicates, not free text); normative randomized `created_at` on all 1059 wrappers (F3); `grp` tag added to the normative vocabulary. Invite token `chp` clarified as the current-charter pointer, cell id derived from genesis (F4).

### Fixed (spec)
- DD §35 disposition: F1–F6, F9–F12, F14 now closed in the specification; F13 (minors) carries a stated v0 posture pending a dedicated design cycle; F7/F8/F15/F16 stand as documented operational residuals. Build-list M5-T3 gains probe-resistance (F6) and M7-T1 gives porch nodes their own device key (F10).

### Added (v2 spec)
- **DD §36 — full specification of the v2 group and persona layers:** the shared BBS+/BLS12-381 credential engine (§36.1), the group layer (membership as scoped pseudonyms, join/messaging/ejection flows, small-group keys and the MLS transition past 150 members, group-as-respondent completing F9) (§36.2), and the persona layer (hardened derivation, anonymous standing, k-show bounds, lifecycle and hygiene) (§36.3). Registry kinds **4930–4933** added (§36.4). Invariant 5 ("plurality bounded, accountability scoped") moves from *promised* to *specified-and-enforceable*.
- **Build-list §16 — v2 milestones M9–M13** (credential engine, group layer, persona layer, anonymous rendezvous, invariant re-audit with v2 release gates 5 and 6). Inert until v0 ships. One sanctioned new dependency: BBS+ over BLS12-381.
- `STRUCTURE.md`, `SECURITY.md`, `TESTING.md` updated for the v2 layers (reserved `core/{cred,group,persona}` folders; invariant-5 enforcement path; BBS+ as the sole v2 crypto addition; gates 5 and 6). — reviewed by: Fable

---

## [0.0.1] — 2026-07-13 — Scaffold — reviewed by: pending

Initial repository setup. No application code yet; the shape is in place.

### Added
- `weft/` monorepo scaffold per build-list §3: pnpm workspaces, TypeScript strict, four packages (`core`, `sim`, `pwa`, `porch`) with `package.json` + `tsconfig.json` per package and pinned dependencies matching build-list §2. Nine empty sub-folders under `core/src` corresponding to the M0–M8 modules (`keys, codec, kinds, invite, wrap, store, routing, handshake, embed`).
- `README.md` — repo landing page: status, reading order, v0 scope, five design invariants (DD §9.4, §17.6, §18.6).
- `STRUCTURE.md` — layout of the application scaffold and the package boundaries; describes the `core/`-no-DOM-no-Node rule (DD §32.4) and maps milestones to folders.
- `weft-ux-spec.md` — UX specification, normative for M6. Part IV per-screen BUILD sections are byte-for-byte binding the way DD §30 and §33 are for wire formats.
- Root `.gitignore` (excludes `.claude/`, `node_modules`, build artifacts) and `weft/.gitignore`.
- Git repository initialized; pushed to https://github.com/rlSutter/Weft as `main`.

### Documents already present at repo init (not added by these commits)
`weft-manifesto.md`, `weft-overview.md`, `weft-design.md`, `weft-build-list.md`, `weft-mockup.html`, `weft-mockup.jsx`.

### Not yet done
No implementation. M0-T1 (workspace scripts wired + placeholder tests) and M0-T2 (kind registry) still open. Design document is being revised by Fable; coding begins after revisions settle.

---

*New phases appear above this line. Historical entries are never edited except to add reviewer names and to correct factual errors, which are marked inline as `[correction YYYY-MM-DD: …]`.*
