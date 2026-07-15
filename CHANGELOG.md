# Changelog

All notable changes to Weft are recorded here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning will follow [Semantic Versioning](https://semver.org/) once code ships.

**Phase model.** Weft ships in phases (roughly one per build-list milestone or coherent slice of one). Each phase is a released tag (`v0.M0`, `v0.M1`, …) and gets its own section here. `Unreleased` accumulates work in progress. Every phase entry names the collaborator who reviewed it — Fable reviews design and code for this repo alongside the human designer, and reviews are recorded here for traceability.

**Entry conventions.**
- Group changes under: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`, `Security`.
- Reference the build-list milestone/task (`M1-T3`), DD section (`DD §30`), or UX spec section (`UX §12`) that a change implements.
- Wire-format changes (invite token bytes, event-kind numbers, tag names) are called out under **Wire** and always require a version bump under the phase model.
- Reviewer: append `— reviewed by: {name}` to the phase heading once review is complete.

---

## [Unreleased]

### Added
- **`LICENSE`** (dual-track, Fable review B1) — root explainer of the licensing split, plus canonical `LICENSE-APACHE-2.0` and `LICENSE-AGPL-3.0` texts. `weft/packages/core` and `weft/packages/sim` under **Apache-2.0** (protocol engine and test harness may be embedded by any client, per DD §11.5 client-plurality); `weft/packages/pwa` and `weft/packages/porch` under **AGPL-3.0** (reference client stays open, blocks closed data-harvesting forks per DD §11.5). Documentation under Apache-2.0. Choice satisfies DD §26.2's separable-trademark posture and closes DD §35 F14.
- `CHANGELOG.md`, `TESTING.md`, `OBSERVABILITY.md`, `SECURITY.md` — pre-implementation process documents establishing how the phased build will be recorded, tested, observed (without surveilling users), and audited for security.
- **Scope and safety** section in `README.md` (Fable review M8, DD §35 F13): *"Not designed for minors."* Weft v0 is not built for, tested for, or offered to users under 18; the design work for a safe minors posture has not been done. Stated as a gap, not an oversight. Also states plainly that Weft is not a crisis service.
- `weft/packages/core/src/relay/` folder placeholder (Fable review H4). Corresponds to build-list M4-T1's transport-agnostic relay interface. Was missing from the initial scaffold's ten-folder core module set.
- `weft/packages/*/package.json` gain SPDX `license` fields matching the LICENSE split.

### Changed
- **`README.md`** (Fable review H3, M6, M7):
  - Invariant #2 corrected: *"vouch attestations are durable but private, held by their subject; handshakes evaporate in hours; relays hold only sealed, expiring envelopes."* The old wording (*"vouches live forever"*) implied public relay storage — the exact bug DD §35 F1 identified.
  - Reading order gains `weft-ux-spec.md` as item #5 (it was missing entirely — anyone building M6 from the README alone would have missed every acceptance checkbox).
  - Repo map lists the UX spec, `LICENSE`, and both license-text files; mockup relabeled as *visual* reference.
  - "34 sections … twelve open problems" → "36 sections … two adversarial passes: twelve open problems in §16, sixteen further findings in §35 (F1/F2/F5 folded; the rest open)."
  - New **License** section pointing at the dual-track structure.
- **`STRUCTURE.md`** (Fable review H4, M10, L11):
  - Core module list corrected to eleven entries (adds `relay/` and `health.ts`; was missing both).
  - WebCrypto rationale rewritten to be precise: signing uses noble because WebCrypto lacks secp256k1; key-wrapping also uses noble (`scrypt` + AES-GCM) to keep one audited crypto surface rather than two, not because WebCrypto's AES-GCM is unusable in isolation.
  - npm scope decision recorded: `@weft/*` verified available (2026-07-13); `weft` org to be reserved before M0-T1 publishes anything; `@weft-protocol/*` documented as fallback.
- **`TESTING.md`** (Fable review H2, H5, M9, L13, L14, L15):
  - **Release gates: four, not two.** Added Gate 3 (no plaintext vouch reaches a relay, DD §35 F1) at `core/invite/__tests__/vouch.private.test.ts`; Gate 4 (reply paths cannot be correlated, DD §35 F2) at `core/routing/__tests__/route.blinding.test.ts`. Rule and Review-authority sections updated to *"any of the four gates failing blocks the release."*
  - Copy lint rewritten (H5): source-only, whole-word, over centralized `pwa/src/copy/*.ts` string exports, with allowlist. Grepping the built bundle would produce thousands of false positives from React internals, `postMessage`, CSS, and dependencies — the lint would be disabled within a week. Source-only, string-literal-only is the shape that actually works.
  - **Layer 3.5** added (M9): `@testing-library/react` component tests for three safety-critical UI invariants that would silently regress under manual-only review — consent precedes existence, Pass emits zero events at the UI layer, impersonation never mounts a name. Manual review still confirms feel; CI confirms invariants.
  - **Store migration tests** (L14, at Layer 1): `schema_version` on the store; per-migration test opens a committed fixture at N−1, migrates, asserts integrity. Local-first apps die of schema drift.
  - **Accessibility tests** (L15) formalized: axe-core rules at Layer 3 (contrast, target size, labels, order); text-only completion and screen-reader walk-throughs at Layer 4.
  - **Governance distinction** (L13) added to Review authority: Fable's release-blocking power is a *project* rule for this pre-v1 repo; the *protocol* is governed by DD §26's RFC + rough-consensus + fork-right process. Outside contributors deserve the distinction stated plainly.
- **`SECURITY.md`** substantially revised (by the human designer with Fable) to address the second adversarial pass (DD §35): adversary classes A7 (interest-probing oracle), A8 (invite-tree captor), A9 (porch-node metadata observer), and A2′ (colluding non-adjacent hops) added; the social graph promoted to protected asset #1; device-key rule added (a porch node gets its own vouched keypair — the root is never copied); WebCrypto rationale sharpened; reporting path updated to prefer GitHub private vulnerability reporting; four release gates referenced throughout; minors gap catalogued explicitly.
- **`OBSERVABILITY.md`** revised (by the human designer with Fable): red-team test now includes *"reconstruct a graph edge"* per F1; route tokens, query ids, and vouch issuer↔subject pairs added to the never-log list per F1/F2; per-contact counter breakdowns explicitly banned; dev-tracer sim-only boundary hardened (must never be pointed at public relays carrying real users' traffic).

### Wire
- None. All changes in this Unreleased phase are process, documentation, and scaffold — no protocol bytes altered.

### Security
- Review-driven hardening across `SECURITY.md`, `OBSERVABILITY.md`, and `TESTING.md` in response to Fable's `weft-docs-review.md`. Two additional release gates codified (Gates 3 and 4). Three additional adversaries formally in scope. No known security regressions in this phase — all changes strengthen posture; none weaken it. Any subsequent silent weakening of a release gate is itself a security incident per `SECURITY.md` § *Incident response*.

---

## [0.0.1] — 2026-07-13 — Scaffold — reviewed by: pending

Initial repository setup. No application code yet; the shape is in place.

### Added
- `weft/` monorepo scaffold per build-list §3: pnpm workspaces, TypeScript strict, four packages (`core`, `sim`, `pwa`, `porch`) with `package.json` + `tsconfig.json` per package and pinned dependencies matching build-list §2. Nine empty sub-folders under `core/src` corresponding to the M0–M8 modules (`keys, codec, kinds, invite, wrap, store, routing, handshake, embed`). [correction 2026-07-13: the initial scaffold was missing `core/src/relay/`; the correct v0 core module set is **ten** folders + `health.ts`. Added in Unreleased under Fable review H4.]
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
