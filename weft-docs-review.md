# Review: CHANGELOG.md · README.md · STRUCTURE.md · TESTING.md

**Verdict: strong process work, but stale against the current design.** The layering in TESTING, the phase model in CHANGELOG, and the package-boundary law in STRUCTURE are all correct and well-judged. The problems are (a) these were written before the §35 adversarial pass and the F1/F2/F5 fixes landed, (b) three real omissions that will bite during M0–M1, and (c) one blocker on a *public* repo.

Findings are ordered by severity. Each gives the exact fix.

---

## BLOCKER

### B1 — The repository has no LICENSE, and it is public.
`github.com/rlSutter/Weft` is public with no license file → default copyright, all rights reserved. That directly contradicts DD §26.2 (libre licensing, separable trademark) and *nullifies the designed-in fork right*, which is the check that disciplines protocol stewards (DD §26.2). It also means nobody can legally run a relay client or fork a cell. This is exactly §35 F14, which flagged that the license was promised and never picked.

**Fix now:** choose and commit a license before any code lands. The choice is a governance decision, not paperwork:
- **AGPL-3.0** — protects against a closed, data-harvesting fork of the client (which DD §11.5 names as the poison-the-well risk); costs some adoption.
- **MIT/Apache-2.0** — maximizes client plurality (DD §11.5's substitutability defense) and adoption; permits a proprietary client.
- **Recommendation:** dual-track — **AGPL-3.0 for the reference client (`pwa`, `porch`), Apache-2.0 for `core`** (so the protocol engine can be embedded anywhere, including by other clients, while the reference client stays open). Add an `M0-T0 License` task to the build list; record the reasoning in a new DD §26 paragraph.

---

## HIGH — factually wrong or dangerously incomplete

### H2 — TESTING.md names TWO release gates; there are now FOUR.
Build list §14 (post-fix) names four: byte-identical authored/forwarded query, zero-events-on-decline, **zero-plaintext-vouches-on-relay**, and **reply-path collusion**. The last two came from §35 F1/F2 and are just as load-bearing.

**Fix — add to TESTING "Release-gate tests":**
- **Gate 3 — No plaintext vouch reaches a relay.** *Location:* `core/invite/__tests__/vouch.private.test.ts` (per M5-T2 acceptance). *Assertion:* after a full invite→redeem→confirm cycle, scanning MockRelay storage yields **zero** plaintext 4902 events; B holds A's signed attestation locally; only a 4903 void (hash-referencing) may ever appear. *Why:* the trust graph **is** the social graph — publishing vouches publishes the warp while §17 protects only the weft (DD §35 F1). It also makes the manifesto's "empty shelves" claim true.
- **Gate 4 — Reply paths cannot be correlated.** *Location:* `core/routing/__tests__/route.blinding.test.ts` (per M5-T3 acceptance). *Assertion:* two non-adjacent nodes on a query's path record every wrapper field they observe for the query and its reply; the intersection of identifying values is **empty** (per-edge route tokens `rt` differ at every hop; no `queryId` ever appears in wrapper plaintext). *Why:* a plaintext queryId visible at every hop lets colluding nodes trace the full path, partially defeating origin ambiguity (DD §35 F2).

Also update the closing rule to *"any of the four gates failing blocks the release"* and the "Review authority" line ("Neither Fable nor Claude Code may waive the **four** release gates").

### H3 — README's invariant #2 is now wrong on the wire.
> *"Persistence is inversely proportional to sensitivity (vouches live forever; **handshakes evaporate in hours**)"*

Post-F1, vouches **do not live on relays at all** — they are private attestations delivered to and cached by their subject, presented inside match tokens and reveal payloads. A reader (or Claude Code) taking this literally will build the exact bug §35 F1 identified.

**Fix:** *"Persistence is inversely proportional to sensitivity (vouch attestations are durable but private, held by their subject; handshakes evaporate in hours; relays hold only sealed, expiring envelopes)."*

### H4 — The `core/relay/` module is missing from STRUCTURE and CHANGELOG.
Build list **M4-T1** creates `core/src/relay` (the relay interface), and STRUCTURE's own milestone map says *"M4 | `core/relay`, `sim/`"* — but the folder list enumerates only nine folders and omits it. CHANGELOG repeats the nine. `core/src/health.ts` (M5-T5 local counters) is also absent from both.

**Fix:** the core module list is **eleven** entries: `keys, codec, kinds, invite, wrap, store, relay, routing, handshake, embed` + `health.ts`. Add `relay/  relay interface (transport-agnostic; adapters in pwa/porch, MockRelay in sim) [M4-T1]` and `health.ts  local-only counters, never published [M5-T5, DD §10.1]` to STRUCTURE's tree and correct CHANGELOG's "Nine empty sub-folders" to ten (+ one file).

### H5 — The copy lint as specified will not work.
TESTING §Layer 3: *"grep the built PWA bundle for banned words… Any hit fails CI."* Grepping a **built bundle** for `post`, `network`, `user`, `content`, `request` will fire on React internals, `postMessage`, `fetch` options, CSS `content:`, minified identifiers, and every dependency — thousands of false positives on day one, and the team will disable the lint within a week.

**Fix:** lint **user-facing strings only, at source**:
1. Centralize all UI copy in `pwa/src/copy/*.ts` (which the UX spec's normative strings want anyway — it makes copy reviewable and later translatable).
2. The lint parses only those modules' exported string literals, matching **whole words, case-insensitive**, with an allowlist for legitimate compounds (`postage`, `posted` in charter text if a cell writes it).
3. Banned list per UX §3/§17: `request`, `profile`, `post`, `feed`, `followers`, `network`, `user`, `content`.
This also makes UX §23's "grep the build for banned words as a CI lint" actually satisfiable.

---

## MEDIUM — omissions that will cause rework

### M6 — README omits `weft-ux-spec.md` entirely.
It is missing from both the "Start here" reading order and the repository map — yet STRUCTURE correctly calls it *normative for M6, byte-for-byte binding*, and CHANGELOG lists it as added. Claude Code reading only the README would build M6 from the mockup and miss every acceptance checkbox.

**Fix:** insert as reading-order item 5 (after the build list, before STRUCTURE): *"**`weft-ux-spec.md`** — the UX specification. Normative for M6: Part IV's per-screen BUILD sections (copy strings, states, acceptance checklists) are binding the way DD §30/§33 are for wire formats."* Add to the repo map.

### M7 — README's section/problem counts are stale.
"34 sections" and "the twelve open problems" — the design document now runs **§0–§35**, and §35 adds **sixteen** further findings from the second adversarial pass (three of which are folded; the rest are open).

**Fix:** *"…36 sections covering discovery, hop routing, the consent handshake, trust and vouching, governance, wire formats, media, and two adversarial passes: twelve open problems in §16 (each now with a worked design response) and sixteen further findings in §35 (F1/F2/F5 folded into the spec; the rest open, F13 — minors — being the largest)."*

### M8 — Nothing anywhere covers minors (DD §35 F13).
The single largest omission in the whole project, and none of these four documents mentions it. A public repo that introduces strangers to strangers needs a posture *stated before code ships*, not after.

**Fix:** add to README (Status or a short "Scope and safety" section) and to CHANGELOG's `Unreleased`: *"**Not designed for minors.** Weft v0 is not built for, tested for, or offered to users under 18; age assurance conflicts with the no-documents identity architecture and the design work (DD §35 F13 — cells/institutions as age-context bearers, charter-level minor-safe modes) has not been done. This is a stated gap, not an oversight."*

### M9 — Three UX acceptance criteria are safety-critical and are only manual-tested.
TESTING pushes all UX §§9–15 checkboxes into Layer 4 (human, at phase boundary). Three of them encode *safety* and will silently regress:
- **Consent precedes existence** (UX §9): no keypair may exist before the charter is agreed. Automate: `assert(identity.hasKey === false)` through onboarding steps 1–2; abort path leaves zero stored state.
- **Pass emits zero events** (UX §12): already Gate 2 at the engine layer — add the **UI-level** assertion that tapping Pass triggers no enqueue.
- **Impersonation never reveals a name** (UX §12): assert the failure state renders the danger card and the reveal component never mounts with a name.

**Fix:** add a "Layer 3.5 — component tests (`vitest` + Testing Library)" row covering these three, run in CI. Manual review still confirms the *feel*; CI confirms the *invariants*.

### M10 — npm scope `@weft/*` is unverified and probably contested.
STRUCTURE pins `@weft/core`, `@weft/sim`, etc. Per §35 F15, `weft` is already taken on PyPI and used by at least two active dev tools; the `@weft` npm org may well be unavailable, and discovering this at publish time means renaming every import in the codebase.

**Fix:** verify the org **before M0-T1** creates the packages. If unavailable, use `@weft-protocol/*` (and reserve `weft-protocol` on PyPI/crates preemptively). Note the decision in STRUCTURE's dependency policy.

---

## LOW — precision nits

- **L11 — STRUCTURE's WebCrypto rationale is imprecise.** *"no WebCrypto (DD §32.2: the required curve isn't in WebCrypto)"* conflates two things: WebCrypto lacks **secp256k1** (so signing uses noble), but it *does* have AES-GCM and PBKDF2 and could legitimately do key-wrapping. Reword: *"Signing uses noble because WebCrypto lacks secp256k1; key-wrapping also uses noble (`scrypt` + AES-GCM) to keep one audited crypto surface rather than two."*
- **L12 — CHANGELOG references `OBSERVABILITY.md` and `SECURITY.md`** that weren't provided for review. One caution: in v0 there are **no beacons** — observability is local counters only (M5-T5), never published. If OBSERVABILITY.md describes DD §10's beacon system as if it exists, it will mislead. It should state plainly: *v0 publishes nothing; §10's beacon design is v2.*
- **L13 — Fable's blocking authority vs. DD §26 governance.** TESTING grants Fable release-blocking power — fine and sensible for a pre-v1 repo, but it's a *project* rule, not the *protocol* governance of DD §26 (RFC + rough consensus + the invariants as constitution). Add one line distinguishing them so the two don't get conflated when outside contributors arrive.
- **L14 — Missing store-migration test (DD §35 F12).** Local-first apps die of schema drift. Add to TESTING Layer 1: *open a fixture DB at `schema_version` N−1, migrate, assert integrity* — and add `schema_version` to M3-T1.
- **L15 — Accessibility is under-tested.** Layer 4 covers reduced-motion only. UX §19 also requires: every flow completable **text-only** (no mic), 4.5:1 contrast, 44px targets, screen-reader order. Add these four to the Layer 4 checklist; contrast and target size can be automated (axe-core) in Layer 3.

---

## What is right and should not change

- The **five-layer test model** and the rule that sim-testable things never touch a real socket.
- **Gates as unwaivable**, called out by file path, with "never patch the test to make it pass; fix the drift."
- The **`core/`-no-DOM-no-Node law** in STRUCTURE, stated as architectural law with a dependency table.
- The **wire-format-change-requires-version-bump** rule in CHANGELOG, and the invite-token hex fixture as a *forever* compatibility test.
- **No checked-in secret keys**, with `.gitignore` enforcement and per-test keypairs.
- The honest **"Not yet done"** section in CHANGELOG. Keep that habit.

---

## Suggested order of operations

1. **B1** (license) — before any code.
2. **H2** (four gates in TESTING) and **H3** (README invariant) — before M1, because both describe behavior M5 must implement.
3. **H4, M6, M7, M10** — housekeeping, do together in one docs commit.
4. **H5, M9, L14, L15** — fold into the M6 and M3 task definitions so the tests exist when the code does.
5. **M8** (minors posture) — state it in the README now; the design cycle it deserves comes later.
