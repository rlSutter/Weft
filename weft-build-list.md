# Weft v0 — Build List for Claude Code

This is an execution plan, not a design document. The design lives in `weft-design.md` (referenced below as **DD §n**). When this file and your own judgment disagree, follow this file. When this file is silent, follow the cited DD section. When both are silent, stop and ask the human.

---

## 0. Ground rules — read before every session

1. **Do milestones in order. Do tasks within a milestone in order.** Never start a task whose dependencies aren't merged and green.
2. **Every task ends with its acceptance command passing.** If you cannot make it pass, stop and report; do not redefine the test.
3. **Never hand-roll cryptography.** Only `@noble/curves`, `@noble/hashes`, `@noble/ciphers`, and `nostr-tools`'s NIP-44 helpers. If you find yourself writing XOR loops or inventing a KDF, stop.
4. **No servers.** This project has zero backend code. The only network calls anywhere are WebSocket connections to Nostr relays. If a task seems to need an HTTP API, you have misread it.
5. **No new dependencies** beyond the pinned list in §2 without asking the human first.
6. **TypeScript strict mode everywhere.** No `any` except in test fixtures. No `@ts-ignore`.
7. **Keep tasks small.** If a task is trending past ~300 lines of new source, stop and split it.
8. **Do not build deferred features** (§9 list) even if the design doc describes them and they seem easy. The doc describes v2; you are building v0.
9. **Wire formats are law.** The invite token (DD §30) and event kinds (DD §33) are implemented byte-for-byte as specified. Field names, integer keys, kind numbers, tag names: copy them, don't improve them.
10. **The social graph is never published.** No plaintext object linking two member pubkeys (a vouch, a contact edge) may ever be published to a relay. Vouch attestations (4902) are delivered wrapped to their subject and presented peer-to-peer; only hash-referencing voids (4903) touch relays. Any test or fixture that puts a plaintext vouch on a relay is a bug.
11. **Queries never carry an origin field.** This is DD invariant 4 enforced in code. Any struct, log line, or debug field that records "who authored this query" outside the author's own device is a bug, including in tests.

---

## 1. What v0 is (and is not)

**v0 is:** a working demo where 2–10 people (or simulated nodes) can — create identities, invite each other with real signed CBOR tokens, form a contact graph, send semantic queries that hop through contacts with TTL and detail-stripping, get match replies, complete the 5-stage consent handshake, and chat over an established pairwise channel. Runs as a PWA (text input, no voice) and as a headless porch node. Uses public Nostr relays.

**v0 is not:** voice, personas, travel modes beyond "through friends", anonymous credentials, group channels, beacons beyond local counters, push notifications, MLS, private matching, steward dashboards, standing asks. See §9.

---

## 2. Pinned stack

| Concern | Choice | Version policy |
|---|---|---|
| Language / runtime | TypeScript 5.x, Node 22 LTS, pnpm workspaces | lockfile committed |
| Crypto | `@noble/curves` (secp256k1 Schnorr), `@noble/hashes`, `@noble/ciphers` | latest stable |
| Nostr | `nostr-tools` (event shape, NIP-44, SimplePool) | latest stable |
| CBOR | `cbor-x` (deterministic/canonical mode ON) | latest stable |
| Tests | `vitest` | latest stable |
| PWA | Vite + React 18, `vite-plugin-pwa` | latest stable |
| QR | `qrcode` (generate), `@zxing/browser` (scan) | latest stable |
| Storage | Milestone 3: in-memory + IndexedDB (`idb`). SQLite-WASM is deferred. | — |
| Embeddings | Milestone ≤7: **StubEmbedder** (defined in M5-T1). Milestone 8: `@huggingface/transformers` with quantized all-MiniLM-L6-v2 | — |

## 3. Repo layout (create exactly this in M0)

```
weft/
  package.json            # pnpm workspace root
  packages/
    core/                 # pure TS protocol engine — NO browser, NO node APIs
      src/{keys,codec,kinds,invite,wrap,store,routing,handshake,embed}/
    sim/                  # in-memory multi-node network harness for tests
    pwa/                  # Vite React app (imports core)
    porch/                # headless Node runner (imports core)
  docs/                   # copy weft-design.md here in M0
```

`core` must compile with zero DOM and zero Node built-ins (crypto comes from noble, which is pure JS). Platform adapters live in `pwa/` and `porch/`. This separation is DD §32.4 and is non-negotiable.

---

## 4. Milestone M0 — Scaffold (½ day)

**M0-T0 Licensing.** Commit the dual-track license before any code (DD §26.2, §35 F14). Three files at repo root: `LICENSE` (a short plain-language explainer of the split and its reasoning), `LICENSE-APACHE-2.0`, `LICENSE-AGPL-3.0` (canonical texts). Split by path: `packages/core` and `packages/sim` → **Apache-2.0** (so any client, including third-party ones, can embed the protocol engine — DD §11.5 client-plurality defense); `packages/pwa` and `packages/porch` → **AGPL-3.0** (so a closed, data-harvesting fork of the reference client is not possible — DD §11.5 poison-the-well concern); `docs/` → Apache-2.0. Each package's `package.json` sets the matching SPDX `license` field.
*Accept:* all three license files present; a CI check asserts every `package.json` `license` field matches its path per the split above (core/sim/docs = `Apache-2.0`, pwa/porch = `AGPL-3.0`); the check fails if a field is missing or mismatched. Do not publish any package before the npm org is reserved (§2 / STRUCTURE dependency policy).

**M0-T1 Workspace.** pnpm monorepo per §3; root scripts: `pnpm build`, `pnpm test`, `pnpm lint` (eslint + prettier defaults, don't bikeshed). Strict tsconfig shared via `tsconfig.base.json`.
*Accept:* `pnpm -r build && pnpm -r test` exits 0 (with one placeholder test per package).

**M0-T2 Kind registry file.** `core/src/kinds/registry.ts`: export const objects for every kind in DD §33.2–33.3 — number, name, retention class (`'E' | 'D' | 'P'`), and `expirationSeconds` per class: E=6h, D=5d, P=null. Include the normative tag names (DD §33.4) as a const enum, including `grp` and `rt`. Include the group-mode kinds (4911 group-interest declaration) and the terms-vocabulary predicate list (kind 4927, DD §35 F11) as registry entries even though group *behavior* is v2 — the registry is the single source of truth and must be complete so nothing later mutates a number. Mark v2-only kinds with `v2Only: true` so the engines can assert they're never emitted in v0.
*Accept:* unit test asserts kind 4910 is class D, 4913–4916 are E, 4900 is P, 4902 is marked `privateOnly: true` (never published plaintext to relays — DD §35 F1), 4911 is marked `v2Only: true`, the tag enum contains `grp` and `rt`, and that no kind number is duplicated. A wrapper helper stamps every 1059 gift wrap with a `created_at` drawn uniformly from the past 48h (DD §35 F3); a test asserts the stamped time is in-range and never equals the true send time's second.

---

## 5. Milestone M1 — Keys, events, invite token (2–3 days)

**M1-T1 Keys.** `core/src/keys`: generate secp256k1 keypair; x-only pubkey hex; BIP-340 sign/verify over 32-byte digests (use noble; do not implement Schnorr yourself). Ephemeral key helper: `withEphemeral(fn)` that zeroes the secret after use.
*Accept:* sign→verify roundtrip test; verify fails on 1-bit tamper; test vector from noble's own suite passes.

**M1-T2 Nostr event codec.** `core/src/codec/event.ts`: build/serialize/hash/sign/verify NIP-01 events (id = sha256 of the canonical array — use `nostr-tools` helpers rather than reimplementing). Support `expiration` tag insertion from the kind registry automatically.
*Accept:* an event built here validates with `nostr-tools`' `verifyEvent`; a kind-4913 event automatically carries an expiration ≈ now+6h.

**M1-T3 Invite token, byte-exact.** `core/src/invite/token.ts` implementing DD §30.2 exactly: deterministic CBOR map with integer keys 0–8, BIP-340 signature over sha256 of the CBOR body with field 8 absent, base64url encode/decode, and the two carrier forms (`https://…/i#<tok>` fragment and `weft:i:<tok>`). Validation per DD §30.3 step 1 (version, expiry, signature). Include a `describeToken()` that renders inviter pubkey, tier, relays, charter id for UI use.
*Accept:* encode→decode roundtrip preserves all fields; token ≤ 450 base64url chars with 3 relay URLs; signature check fails if any field mutated; a committed hex fixture decodes to known values (write the fixture, commit it — it is now a compatibility test forever).

---

## 6. Milestone M2 — Wrapper and sealed transport (2 days)

**M2-T1 NIP-44 pairwise encryption.** Thin wrapper over `nostr-tools` NIP-44 v2: `sealTo(pubkey, bytes)`, `openFrom(pubkey, payload)`.
*Accept:* roundtrip; tamper fails; interop test against a `nostr-tools`-produced ciphertext.

**M2-T2 Gift wrap.** `core/src/wrap`: wrap any signed inner event into a kind-1059 outer event under a **fresh ephemeral key** per DD §33.1: inner (signed) → sealed → wrapped; outer carries only `p` tag (recipient), `expiration` from the *inner* kind's retention class, ciphertext. Unwrap verifies inner signature after decryption ("sign inside, encrypt outside", DD §9.1).
*Accept:* wrap→unwrap roundtrip for a 4910 and a 4913; outer event's ephemeral pubkey ≠ sender pubkey; two wraps of the same inner event produce different outer bytes; unwrap rejects an inner event with a bad signature.

---

## 7. Milestone M3 — Local store (2 days)

**M3-T1 Store interface + adapters.** `core/src/store`: `WeftStore` interface — `putEvent`, `getEvent(id)`, `queryEvents({kinds?, tags?, since?})`, plus typed tables: `contacts` (pubkey, displayName, relayHints), `vouches` (cache of 4902 by subject), `stampLedger` (per-contact numeric balance), `queryState` (in-flight queries: queryId, ephemeralSecret, ttlSeen, expiresAt), `reverseRoutes` (myRouteToken → {upstreamRouteToken, cameFromPubkey, expiresAt} — token-keyed, never query-keyed, DD §35 F2). Implement `MemoryStore` (core) and `IdbStore` (in `pwa/`, same test suite run against both).
*Accept:* shared conformance test suite passes on both adapters.

**M3-T2 The reaper.** `expireSweep(now)` on the store: deletes expired queryState, reverseRoutes, and any cached event past its expiration tag. DD §9.2 requires active deletion, not lazy.
*Accept:* test inserts records at t, advances clock, sweeps, asserts gone; asserts unexpired records untouched.

---

## 8. Milestone M4 — Relay client + outbox (2 days)

**M4-T1 Relay pool.** `core/src/relay` (interface) + implementations using `nostr-tools` SimplePool in pwa/porch: `publish(event, relays)`, `subscribe({p, kinds}, onEvent)`. Also a `MockRelay` in `sim/` implementing the same interface fully in-memory (delivers to subscribers, honors expiration on a fake clock).
*Accept:* sim test — node A publishes a wrapped event tagged to B via MockRelay; B's subscription receives and unwraps it.

**M4-T2 Offline outbox.** Queue of unpublished events in the store; `flush()` publishes and clears on success; callers never call `publish` directly, always `enqueue` (this is DD §32.3's offline-first posture).
*Accept:* enqueue with relay "down" (mock flag) → nothing sent, queue length 1; set relay up, flush → delivered, queue empty; queue survives store reload.

---

## 9. Milestone M5 — Protocol engines (the heart; 5–7 days)

Everything in M5 is pure logic in `core/`, tested against `sim/`'s MockRelay with a fake clock. No UI.

**M5-T1 Embedder interface + stub.** `core/src/embed`: `interface Embedder { embed(text: string): Promise<Float32Array> }` (length 384) and `cosine(a, b): number`. `StubEmbedder`: tokenize to lowercase words, hash each word to a bucket 0–383, +1 per hit, L2-normalize. Deterministic, fast, and similar texts overlap — good enough to test routing end-to-end.
*Accept:* `cosine(embed("koji fermentation"), embed("fermentation with koji")) > 0.8`; `cosine(embed("koji fermentation"), embed("mountain biking")) < 0.3`; identical input → identical vector.

**M5-T2 Invite engine.** `core/src/invite/engine.ts` — four functions with explicit state, per DD §30.3:
- `createInvite(me, tier, ctx, relays, charterId)` → token + ledger entry (status `sent`)
- `redeemInvite(tokenStr)` (on the invitee) → validates, generates root key, stores relays/charter ref, enqueues wrapped **4918** redemption to inviter, returns `pendingConfirmation`
- `handleRedemption(evt)` (on the inviter) → single-use check against ledger (`iid` seen → surface `replayAlert`, do not process), else status `awaitingConfirm`
- `confirm(iid, yes)` → yes: create the **4902** vouch attestation (tier/ctx/expiry from token), **deliver it wrapped to the new contact — never publish it** (DD §35 F1) + enqueue wrapped **4919** hello, add contact both directions, status `confirmed`; no: publish **4903** void referencing the invite `iid`, status `voided`
*Accept:* sim test, 2 nodes through MockRelay: full happy path ends with A and B in each other's contacts, B holding A's signed 4902 attestation locally (verify: signature valid, subject = B), **zero plaintext vouches on the relay** (assert by scanning MockRelay storage), stamp ledger initialized. Second redemption of same token → `replayAlert`, no second vouch. Void path → redeemer has zero vouches and A has no contact.

**M5-T3 Query engine.** `core/src/routing`:
- `ask(text, chips)` → embed, create **4910** {embedding (Float32Array serialized as int8-quantized bytes ×384), ttlRemaining (draw initial TTL uniformly from {3,4,5} — DD §17.2 randomization), termsOffered, ephemeralReplyPub, rt: fresh random 16-byte route token per first-hop copy (DD §35 F2; no stamp field exists — DD §35 F5)}, wrap separately to each chosen first-hop contact (max fanout 3), enqueue. Store queryState with the ephemeral secret. **The 4910 struct has no author field — enforce with a type test.**
- `onQuery(evt, fromPubkey)` → dedupe by queryId (locally only — queryId is inside the wrapped payload and never appears on wrappers); on forward, mint a fresh `rt` per downstream copy and record reverseRoute {newRt → {incomingRt, fromPubkey}}; match check: cosine(query, each of my declared interests) ≥ 0.75 → build **4912** match reply {scoreBucket: high/med, hopEstimate: initialTtlGuess − ttlRemaining, vouchSummary: count only in v0} wrapped to ephemeralReplyPub with the incoming `rt` as the wrapper's route tag, send along reverse route. Else if ttlRemaining > 1: decrement, strip (v0 stripping = drop any relay-hint metadata; embeddings pass through unchanged), forward to up to 2 contacts chosen by routing sketch, excluding `fromPubkey`; else drop. Debit stamp ledger for `fromPubkey`; if balance < 0, drop silently (DD §6 postage).
- Routing sketch: per-contact centroid, EMA update (α = 0.1) from queries they answered or that flowed toward them; `pickForwardTargets(embedding, k)` = top-k by cosine to centroids, falling back to random contacts when all centroids are empty.
- **Probe resistance (DD §35 F6 — required, not optional).** Auto-reply-on-match turns every device into an interest oracle a hostile contact can binary-search. Three local defenses: (1) **per-sender match-reply budget** — cap match replies emitted to any one `fromPubkey` per rolling window, independent of the forwarding stamp ledger; (2) **probe-pattern detection** — if one edge sends many high-similarity queries in a short window, stop auto-replying on that edge and mark it for user confirmation; (3) **threshold jitter** — perturb the 0.75 match threshold by a small per-query random ε so repeated near-threshold probes don't converge cleanly. (Reply-only-after-tap for sensitive interests is a v2 UI hook — the interest-marking UI doesn't exist in v0.)
- Reply relay: `onMatchReply` at intermediate hops = look up reverseRoute by the wrapper's `rt`, **relabel to the stored upstream token**, re-wrap toward `cameFrom`; at origin (rt matches one we minted at ask time) = decrypt with stored ephemeral secret, surface match. No queryId ever appears in wrapper plaintext.
*Accept (the big one):* sim with 6 nodes in a line+branch topology, interests planted at node F, ask from node A: match reply arrives at A within fake-clock budget; queryState reaper kills unanswered queries; a node with stamp balance 0 for its neighbor forwards nothing; byte-compare test proves an authored 4910 and a forwarded 4910 have identical schema (no distinguishing field); **collusion test**: two non-adjacent nodes on the same path record every wrapper field they see for a query and its reply — assert the intersection of identifying values is empty (route tokens differ per edge; no shared queryId — DD §35 F2); **probe-resistance test (DD §35 F6):** a node issues 200 crafted near-threshold queries from one edge and recovers no stable interest signal — assert the per-sender reply budget caps replies and that jitter prevents clean convergence.

**M5-T4 Handshake engine.** `core/src/handshake` — state machine over inner kinds **4913→4917** per DD §5, keyed by matchId, all messages wrapped to ephemeral keys and routed via reverse path until stage 5:
- states: `idle → pinged → termsAgreed → committed → revealed → channelOpen`, plus `expired` (every state has a TTL; reaper collapses stalled handshakes to nothing — DD §5's evaporation)
- **Terms are coded predicates, never free text (DD §35 F11).** The `terms` in 4913/4914 are drawn from the versioned predicate registry (kind 4927 entry: `reveal.name`, `reveal.vouches`, `reveal.city`, `reveal.after=1msg`, etc.), stored and compared as codes; the UI renders them locally. Reject any terms payload containing an unknown predicate — never guess. A test asserts two nodes "agreeing" always agree on an identical code set, and that a free-text terms value is rejected.
- Decline = do nothing. **There is no decline message. Do not add one, even internally as an enum value that could serialize.**
- commit/reveal: identity payload = {pubkey, displayName, **the vouch attestations themselves** (self-contained 4902 objects — DD §35 F1)}; commit = NIP-44 seal under a fresh symmetric key, send ciphertext (4915); on both-committed, exchange keys (4916); verify: each side checks each included attestation's signature, that its subject = revealed pubkey, and that no 4903 void of its hash exists on shared relays; mismatch → surface `impersonationAlert`, state `expired`.
- 4917 handoff: v0 "channel" = plain pairwise NIP-44 messaging between the two now-known pubkeys (no Matrix, no groups).
*Accept:* sim: full A↔B handshake through 2 intermediate hops ends `channelOpen` with both sides holding verified names; B never responds → A's state evaporates at TTL with no message emitted (assert zero events sent by B); tampered vouch id → `impersonationAlert`.

**M5-T5 Local counters.** `core/src/health.ts`: increment-only local counters (asksSent, asksMatched, handshakesCompleted, forwardsRelayed, deadQueries) — no publishing, no beacon event in v0.
*Accept:* counters correct after running the M5-T3 and M5-T4 sim scenarios.

---

## 10. Milestone M6 — PWA (4–6 days)

Reference for all UI: `weft-mockup.jsx` — copy its palette, fonts, copy tone, and card patterns. Implement only the screens listed; the mockup contains v2 features (personas, travel modes, escrow) that you must **not** wire up — where the mockup shows them, omit the control entirely.

**M6-T1 Shell.** Vite React PWA: manifest, installability, service worker precaching the app shell (`vite-plugin-pwa` defaults), IdbStore wired, key generation on first run, encrypted key export/import (passphrase → scrypt via noble → AES-GCM) as the backup path (DD §9.2 minimum).
*Accept:* Lighthouse PWA installable check passes; app loads with network disabled after first visit; export→wipe→import restores identity (manual script or playwright).

**M6-T2 Onboarding via invite.** Handle `/i#<token>` fragment and QR scan: show charter/inviter/tier **before** key generation (DD §30.3 step 2 — consent precedes existence), then run `redeemInvite`. Also "Invite & vouch" flow: contact-name entry (v0: type a name — no OS picker on web), token generation, QR display, share-sheet/copy for the URL form, invites-out list with revoke (4903) and the confirm/void card.
*Accept:* two browser profiles complete invite→redeem→confirm against a public relay (manual test script in `docs/manual-tests.md` — write it); revoked token shows clean error on redeem.

**M6-T3 Ask & matches.** Home (mic button replaced by a text field + "Ask" in v0), the three chip questions (hardcoded from mockup), confirm card, traveling state with statuses, match notification, match card with terms toggles, Connect/Pass (Pass = local state change only), reveal flip, message thread on channelOpen.
*Accept:* full loop between the two profiles over a public relay, matching on planted interests; Pass produces zero network events (assert via relay log in the manual test).

**M6-T4 Honest surfaces.** "Why it works this way" screen — port the mockup's copy minus the sections for unbuilt features (travel modes, personas, escrow, beacon — the local counters screen replaces the beacon JSON with "these numbers never leave this phone" and the live counter values).
*Accept:* copy review by human; no claims about features v0 lacks.

---

## 11. Milestone M7 — Porch node (1–2 days)

**M7-T1 Headless runner.** `porch/`: Node CLI — loads config (relays, contacts) from a JSON file, subscribes, runs `onQuery`/reply-relay/handshake-forwarding forever, prints the M5-T5 counters every minute. **Device-key model (DD §35 F10 — do NOT import the primary's root key):** the porch node generates its *own* keypair on first run; the owner pairs it by issuing a device vouch from their primary (a normal 4902 attestation whose subject is the porch key, tier "device"). This avoids same-key-on-two-devices, which would fork the stamp ledger and routing sketch, double-answer queries, and break pairwise ratchets in v2. Contacts route to the porch node as its own edge; it never impersonates the primary.
*Accept:* porch node comes up with a distinct pubkey; a primary can pair it via a device vouch; the primary and porch node never both answer the same query in a two-node sim (no duplicate 4912 for one 4910); no code path reads a root secret from disk.
*Accept:* three processes (two PWA profiles + one porch node between them as the only shared contact) route a query end-to-end via a public relay.

---

## 12. Milestone M8 — Real embeddings (2–3 days)

**M8-T1 MiniLM embedder.** `pwa/src/embed/MiniLMEmbedder.ts` implementing `Embedder` via `@huggingface/transformers`, quantized `all-MiniLM-L6-v2`, cached (browser cache / OPFS), WASM backend (WebGPU optional flag). Porch node uses the same model via the package's Node backend. StubEmbedder remains the test-suite embedder.
*Accept:* all M5 sim tests still pass with MiniLM substituted (raise thresholds if needed and note it); "koji techniques" ↔ "growing aspergillus on rice" cosine > 0.5 while ↔ "mountain biking" < 0.25; model loads offline on second run.

---

## 13. Deferred — do NOT build in v0

Voice/STT · travel modes (deniable/anonymous), LSH buckets, private matching (DD §17.3–17.5) · personas & anonymous credentials (DD §18) · rendezvous nodes · group channels, charters beyond displaying the invite's charter text, key rotation, MLS (DD §7/§9.1) · **group-as-respondent (kind 4911 group-interest declarations and `grp`-tagged 4912 group replies, DD §35 F9) — the spec exists so the registry is complete, but v0 matches person-to-person only; a group match must not be emitted or displayed in v0** · beacons/telemetry publishing (DD §10.2) · push notifications (DD §22) · escrow & meetup safety (DD §24) · standing asks (DD §25) · model registry (DD §19) · tombstones (4923) · steward dashboards beyond nothing · ejection attestations (4904) · SQLite-WASM · cover traffic · media/blob layer, shelves, media pointers (4926), multimodal embeddings (DD §34). Each exists in the DD; none exists in v0. If a v0 task appears to require one, you have misread the task.

## 14. Definition of done for v0

`pnpm -r test` green (core coverage ≥ 80% on `invite`, `routing`, `handshake`, `wrap`) · the M7 three-node manual test passes against a public relay · the M6 manual test script runs clean · the byte-identical authored/forwarded query test, the zero-events-on-decline test, the zero-plaintext-vouches-on-relay test, and the reply-path collusion test exist and pass (these four encode the design's soul; they are release gates, not nice-to-haves) · `docs/manual-tests.md` and a README with build/run instructions exist · the M0-T0 license CI check passes (every `package.json` `license` field matches its dual-track path).

## 15. Standing orders

- After each task: run the full test suite, commit with message `M{n}-T{m}: <summary>`.
- Never store an unencrypted secret key in the store or logs. Ephemeral secrets live only in `queryState`/handshake state and die with the reaper.
- Public relay etiquette: use 2–3 well-known open relays, keep event sizes ≤ 2 KB, respect NIP-40 by always setting expirations.
- When a DD section and this list conflict on scope, this list wins; on wire bytes, the DD (§30, §33) wins.
