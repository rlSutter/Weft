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
- `CHANGELOG.md`, `TESTING.md`, `OBSERVABILITY.md`, `SECURITY.md` — pre-implementation process documents establishing how the phased build will be recorded, tested, observed (without surveilling users), and audited for security.
- Dual-track `LICENSE` (Apache-2.0 for `core`/`sim`/docs, AGPL-3.0 for `pwa`/`porch`), recorded in DD §26.3 and enforced by a new build-list task **M0-T0** (per-package `license` field CI check). Resolves DD §35 F14. — reviewed by: Fable

### Changed
- Aligned `SECURITY.md`, `OBSERVABILITY.md`, `TESTING.md`, `README.md`, `STRUCTURE.md` to DD §35 (second adversarial pass): four release gates (was two), social graph promoted to protected asset #1, adversaries A7/A8/A9 added, copy-lint moved to source-only, Layer 3.5 component tests, store-migration and accessibility tests. — reviewed by: Fable

### Wire
- **DD §33 registry additions (pre-code, so no released wire to bump yet):** kind **4911** group-interest declaration and `grp`-tagged **4912** group reply (group-as-respondent, F9; v2 behavior, registry-complete now); kind **4927** terms-predicate registry (F11 — terms are coded predicates, not free text); normative randomized `created_at` on all 1059 wrappers (F3); `grp` tag added to the normative vocabulary. Invite token `chp` clarified as the current-charter pointer, cell id derived from genesis (F4).

### Fixed (spec)
- DD §35 disposition: F1–F6, F9–F12, F14 now closed in the specification; F13 (minors) carries a stated v0 posture pending a dedicated design cycle; F7/F8/F15/F16 stand as documented operational residuals. Build-list M5-T3 gains probe-resistance (F6) and M7-T1 gives porch nodes their own device key (F10).

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
