# Weft manual test protocol

This document contains the human-operated test scripts that back the build
list §14 definition of done. Automated tests (`pnpm -r test`) cover protocol
correctness; the tests here cover the browser experience and confirm the
release gates hold on **real public Nostr infrastructure**.

Every phase boundary runs these scripts. Waivers are recorded in
`CHANGELOG.md` with the reason.

---

## 0. Preconditions

- Node 22+ and `pnpm` (via `corepack enable`) installed.
- Public network access to `wss://relay.damus.io` and `wss://nos.lol`. If
  either is temporarily down, substitute another well-known open relay in
  `packages/pwa/src/weft-client.ts` (`DEFAULT_RELAYS`).
- Two browser profiles (Chrome/Firefox private windows work; Safari private
  windows share storage so use a real second profile there).
- Terminal open at `weft/`.

```
pnpm install
pnpm -r build
pnpm -r test          # must be green
pnpm -r lint          # must be clean
node scripts/check-licenses.mjs   # must exit 0
```

If any of those four is not green, stop and fix before starting the manual
protocol.

---

## Test 1 — Headless E2E on public relays (5 minutes)

Verifies the protocol end-to-end (Gates 2 & 3 on the real wire) without any
UI in the loop.

```
cd packages/porch
npx tsx scripts/e2e-public-relay.mts
```

Expected output tail:

```
✓ Alice received the 4918 redemption event
✓ Alice's invite ledger status = confirmed
✓ Alice added Bob as a contact
✓ Bob has exactly 1 cached vouch (private)
✓ Bob's vouch is issued by Alice
✓ Bob added Alice as a contact
✓ Gate 3: no plaintext 4902 from Alice or Bob observed on public relays
✓ Gate 2: no additional events from Alice after Pass (0 → 0)
✓ Gate 3 (final): no plaintext 4902 ever published by either party
=== all gates PASSED against public relays ===
```

**If this fails, do not proceed to the browser tests.** Investigate publish
acks (`0 fail` on every publish) and the relay set first.

---

## Test 2 — Two-profile browser flow (15 minutes)

Verifies M6-T2 (invite → redeem → confirm) and M6-T3 (ask → match → reveal
→ chat, plus Pass emits zero wire events) with real browsers.

### Setup

Terminal 1 — start dev server:
```
cd packages/pwa
pnpm dev
```
Should print `Local: http://localhost:5173/`.

Two browser windows: **Alice** in a normal window, **Bob** in a *separate*
profile (not just a private tab in the same profile — they need independent
IndexedDB stores).

### 2a — Onboarding (each profile, ~30 seconds)

For each profile:
1. Open `http://localhost:5173/`.
2. Should see: "Weft — Ask your people. Find your people." card.
3. Click **Continue**.
4. Enter a name (Alice, Bob) → **Continue**.
5. Land on Home. Should read "You are Alice / Bob" at the top and "Ask your
   people" card below.

**Fail cases:**
- Blank screen or stack trace in DevTools console → broken build; stop.
- Onboarding loops after Continue → localStorage misconfigured; check
  DevTools > Application > Local Storage for `weft:secret:hex` and
  `weft:displayName`.

### 2b — Alice invites Bob (~1 minute)

**Alice's window:**
1. On Home, scroll to "Your people" → click **Invite & vouch**.
2. Type `Bob` in the field.
3. Click **Create invite**.
4. A trust-bordered card appears with a URL like
   `http://localhost:5173/#/i/qQAB...`. Click **Copy link**.

**Bob's window:**
5. Paste the URL into the address bar and hit Enter.
6. Should see: "Someone invited you." card showing Alice's key prefix and
   the vouch tier text.
7. **Alice already has an identity note appears.** *(Skip this step if
   you're using a fresh Bob profile; if Bob went through onboarding first,
   this warning is expected.)*
8. Enter Bob's name in "What should people call you?" and click
   **Agree & join**.
9. Should see: "You're in. Waiting for your friend to confirm the invite."
10. Click **Continue to home**.

**Alice's window (may need to wait ~5–15 seconds for the wire round-trip):**
11. A trust-bordered "Someone joined with your invite to Bob" card appears
    at the top of Home.
12. Click **Yes, that's my Bob**.

**Verification:**
- Alice's "Invites out" list should show Bob as `Confirmed — vouched`.
- Bob's Home should not (yet) show any active matches or asks — but he now
  has Alice as a contact under the hood.

**Fail cases:**
- Confirmation card never appears on Alice → check DevTools > Network for
  WSS connections to Damus / nos.lol. Reload Alice's page and wait again
  (subscriptions can take 5-10s to bind).
- 4902 vouch visible on relay traffic → **Gate 3 violation**. Stop and
  investigate; do not release.

### 2c — Bob asks, Alice matches (~2 minutes)

**Bob's window:**
1. On Home, click the **Ask** button.
2. Type `koji fermentation` (or any short text).
3. Click **Send it**.
4. See "Your ask is traveling" confirmation → click **OK**.
5. Home now shows "Asks out in the world" with Bob's text and a
   "Traveling…" status.

**Alice's window (before Bob asks):**
- On Home, scroll to "What you're into".
- Type `koji fermentation` in the "e.g. koji fermentation" input.
- Click **Add**. A chip should appear with the interest.
- Add 1–2 more if you want (they'll union into the same routing sketch).

**Then Bob asks** (as above). Within ~10–20 seconds Alice's Home should show
a "A match came back" card.

### 2d — Match card, Connect, Reveal, chat (~2 minutes)

**Alice's window:**
1. Click the "A match came back" card. See the masked match card:
   "Someone, a few hops away" + score bucket + amber-bordered trust line
   "A vouched member of this community — identity sealed."
2. Click **Connect**. See "Waiting for both cards to flip…"
3. After ~2–5 seconds the amber "Both of you said yes…" card appears with
   Bob's name and pubkey prefix.
4. Click **Say hello**. Lands on the chat thread with Bob.
5. Type "hi" → **Send**. Message appears in the thread.

**Bob's window:**
6. Home now shows a conversation with Alice. Click it. See Alice's "hi".
7. Type "hey" → **Send**. Alice sees it in her thread within ~5s.

### 2d — Pass emits zero events (Gate 2)

When a match card DOES appear on one of the profiles (via Test 1's parallel
setup or a future declared-interests UI):

1. Open DevTools > Network > WS on the profile that just received a match.
2. Note the current message count on the Damus and nos.lol connections.
3. Click **Pass**.
4. Wait 5 seconds.
5. Verify the message count did NOT increase (only inbound frames, no
   outbound). If any outbound frame occurred after Pass, this is a **Gate 2
   violation** — do not release.
6. Home should show no active match, and the "Passing is invisible" toast
   should have appeared.

### 2e — Post-run verification

- Alice's DevTools > Application > Local Storage should show
  `weft:secret:hex` and `weft:displayName`. Both persist across reload
  (identity survives).
- Alice's DevTools > Application > IndexedDB > `weft` database should show
  populated `contacts`, `vouches`, `invites`, and `events` stores.
- The relay-side view (browser Network > WS frames) should show only kind
  1059, kind 4903 (voids, if any), and no kind 4902 anywhere. Any plaintext
  4902 is a **Gate 3 violation**.

---

## Test 3 — Three-node scenario with a porch (30 minutes, v0.1.1)

Two browser profiles + one porch node between them as the only shared
contact. Verifies M7-T1's routing over a porch relay.

This test is **deferred to v0.1.1**. The porch CLI works (`packages/porch/
src/index.ts`) but the workflow to bootstrap a porch from a PWA invite
without any UI shortcuts is a follow-up. Test 1 exercises the routing
behavior in-process; a full three-terminal test comes with the next release.

---

## Release gate summary

Before tagging a release, all of the following must be true:

| Gate | How verified in this protocol |
|---|---|
| **1** Byte-identical authored/forwarded query | `pnpm -r test` (sim) |
| **2** Zero events on decline | Test 1 (initiator, real wire) + `pnpm -r test` (responder, sim) |
| **3** No plaintext vouch reaches a relay | Test 1 (real wire) + Test 2b (real wire, browser observed) + `pnpm -r test` (sim) |
| **4** Reply paths cannot be correlated | `pnpm -r test` (sim) |
| M0-T0 license CI | `node scripts/check-licenses.mjs` |

Record the manual-test result in `CHANGELOG.md` under an entry like
"Verified (Layer 5) — YYYY-MM-DD" naming which relays and profiles were
used.

## Known limitations for v0.1.0-alpha (recorded so testers don't chase phantoms)

- **Key storage is plaintext in localStorage.** Passphrase-wrapped storage
  is a v2 IOU (`SECURITY.md` known gaps).
- **No key backup UX.** Losing local storage = losing the identity.
- **No QR scan in-browser.** Invites shared as URLs only (works fine for
  same-device or messaging).
- **No push notifications.** UI must be open to receive events; refresh
  after being closed for a while resubscribes to relays.
- **`relay.primal.net` is incompatible** with our filter format (rejected
  as "not an object"); excluded from `DEFAULT_RELAYS`.
- **Interests are session-only** — declared interests are held in memory,
  not persisted across page reloads. Re-add after refresh. (A localStorage
  or IdbStore persistence layer for interests is a v0.1.1 IOU.)
- **Interests aren't visible on the interests UI after reload** for the same
  reason.
- **Vouch chain in the reveal shows key prefixes, not names.** Contact-name
  resolution in the reveal card is a UX polish item for v0.1.1.
