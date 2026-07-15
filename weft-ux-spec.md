# Weft — UX Design Specification

**Audience:** this document serves two readers at once.
- **The human designer** needs the *why* — principles, rationale, emotional intent, edge-case reasoning.
- **Claude Code** needs the *what* — exact tokens, component contracts, every state, and testable acceptance criteria.

Each screen section is split: **`DESIGN`** (prose, for humans) and **`BUILD`** (specs + acceptance, for the AI). When they seem to conflict, BUILD wins for implementation and DESIGN wins for judgment calls not covered by BUILD. Reference implementation of the visual language: `weft-mockup.html` / `weft-mockup.jsx`. Protocol reference: `weft-design.md` (cited as **DD §n**). This spec covers **v0 scope only** (DD §9 build list); v2 surfaces are noted where they'll attach but are not built.

---

## Part I — Foundations

### 1. The one-sentence spec

Everything below serves a single feeling: **leaving a note with a trusted friend — brief to write, safe to wait on, and warm when an answer comes back.** When any decision is ambiguous, choose the option that better fits that sentence.

### 2. The five UX laws (non-negotiable)

1. **Voice in, cards out.** Speaking is the primary input (v0: text co-equal, voice deferred). Every system response is a short card with ≤2 actions.
2. **Crypto is invisible.** No keys, hashes, DIDs, hop counts, kind numbers, or TTLs ever appear on screen. Trust and privacy render as plain sentences.
3. **Two taps to any decision.** Every consent moment is a pre-filled card with sensible defaults, editable by toggle/chip, confirmed in one tap.
4. **Silence is designed, not apologized for.** Dead queries, declines, and waiting are first-class states with calm, honest copy — never spinners-as-anxiety, never guilt.
5. **No feed. Ever.** The home surface is only your asks and your conversations. Empty is a valid, comfortable state. The absence of infinite scroll is the product's spine.

### 3. Anti-patterns (banned; a build that includes these is wrong)

- Unread badges on anything except real matches and messages.
- Streaks, engagement counters, "people also asked," re-engagement pushes, notifications designed to pull the user back.
- Any visible number that ranks people: reputation scores, vouch *counts*, follower counts, response-rate percentages, member counts beyond a group's rough size band.
- A global search box or people directory (their absence *is* the mental model).
- The words **"request"** (transactional), **"profile"** (there isn't one), **"post"**, **"feed"**, **"followers"**, or **"network"** in user-facing copy — the correct word for a user's contacts is **"your people."**
- Red used for anything but genuine danger (impersonation, failed verification). Never for a decline, an expiry, or an empty state.

### 4. Emotional intent per moment (for the human designer)

| Moment | Feeling to produce | Feeling to avoid |
|---|---|---|
| Opening the app | calm, unhurried, "nothing is demanding me" | FOMO, obligation, noise |
| Asking | like speaking to a friend | like filling a form / posting publicly |
| Waiting | patient trust | anxiety, abandonment |
| A dead query | gentle acceptance, a door still open | failure, rejection |
| A match arriving | quiet delight | dopamine spike / slot-machine |
| Deciding to connect | in control, safe | pressure, exposure |
| The reveal | ceremony, warmth | transaction |
| Passing | frictionless, private | guilt, confrontation |
| Being passed on | (nothing — it's invisible) | — |

---

## Part II — Visual Language

### 5. Design tokens (BUILD — copy exactly)

```
COLOR — main persona (default)
  --paper:        #DFE5DC   (app background, outside the phone frame)
  --card:         #FBFBF7   (surface)
  --ink:          #21302B   (primary text)
  --muted:        #6B7A72   (secondary text)
  --accent:       #2F6B58   (pine — primary actions, active states)
  --accent-soft:  #DDE8E1   (accent backgrounds, quiet buttons)
  --amber:        #B9812E   (TRUST ONLY — vouch seals, trust lines)
  --amber-soft:   #F3E8D4   (trust card backgrounds)
  --line:         #D5DCD4   (borders, dividers)
  --danger:       #9C3D2E   (DANGER ONLY — impersonation, verification failure)
  --danger-soft:  #F2E0DB

COLOR — quiet persona (v2; token set present in mockup, feature deferred)
  overrides accent→#5C4676 (plum), card→#F7F4FA, etc. See weft-mockup CSS `.quiet`.

TYPE
  Display face:  'Young Serif', serif   (headings only)
  Text face:     'Karla', sans-serif    (everything else)
  h1: 25px / Young Serif;  h2: 19px / Young Serif
  body: 14–15px / Karla;  sub: 14px / Karla / --muted
  eyebrow: 11px / Karla / 700 / letter-spacing .14em / uppercase / --muted

SHAPE
  card radius: 18px;  button radius: 14px;  chip/pill radius: 999px
  card padding: 15px;  screen padding: 18px 20px 90px
  phone frame: max-width 400px, radius 34px

MOTION
  standard transition: 200ms; reveal flip: 800ms; ripple: 3.2s loop
  ALL motion must respect `prefers-reduced-motion: reduce` (disable ripple, flip, dot pulse)

AMBER RULE (enforced): amber/amber-soft may only style vouch seals and trust lines.
DANGER RULE (enforced): danger/danger-soft may only style impersonation & verification-failure states.
```

### 6. Core components (BUILD — component contracts)

- **Card** — white surface, `--line` border, 18px radius. Variants: default; `trust` (amber-soft bg, amber border, for vouch content); `danger` (danger-soft bg, danger border). Props: variant, children.
- **Button** — full-width, 14px radius, 700 weight. Variants: `primary` (accent bg / white), `quiet` (accent-soft bg / accent), `ghost` (transparent / muted / 500). `:active` scales to .985.
- **Chip** — pill, 1.5px accent border, accent text; `picked` inverts to accent bg / white. Used for clarifying answers and multi-select.
- **Toggle** — 42×24 pill switch; off `#C9D2CA`, on `--accent`.
- **RadioCard** — full-width selectable card; `sel` state = accent border + accent-soft bg. Used for mutually exclusive choices (travel modes).
- **Seal** — 11px amber radial dot with amber-soft ring; the *only* trust glyph. Precedes every vouch line.
- **Toast** — ink pill, bottom, auto-dismiss 2.8s, one line.
- **Eyebrow** — section label (see type token).
- **BackButton** — muted "← Back", top-left, no chevron elsewhere.
- **DemoPill** *(dev/mockup only — MUST NOT ship in the real client)* — dashed gray pill used to simulate time passing; in production these transitions are driven by real network events.

---

## Part III — Information Architecture & Navigation

### 7. Screen map (v0)

```
Onboarding (first run only)
  ├─ Invite landing  → Charter consent → Name → Speak interests → Home
Home  (the hub — persona pill · mic · asks · conversations · your people · footer links)
  ├─ Ask flow        (speak → chips → [travel: v2] → confirm → back to Home)
  ├─ Match           (masked card → terms → reveal → [escrow: v2] → conversation)
  ├─ Conversation    (message thread)
  ├─ Invite & vouch  (start → picker/compose → invites-out → confirm/void)
  ├─ Why it works    (philosophy & privacy)
  └─ Steward mode    (v2 — cell health & tools; hidden unless steward)
```

**Navigation rules:** Home is the only hub; every other screen is one level deep and returns to Home via BackButton. No bottom tab bar in v0 (the mic *is* the primary verb; secondary destinations are footer links on Home). No nested stacks deeper than 2. No modal-on-modal except the persona sheet (v2).

### 8. State the UI must reflect (BUILD — the view-model)

The UI is a pure function of this state (names align with build-list engines):
```
identity:      { hasKey: bool, displayName: string }
onboarding:    'invite' | 'charter' | 'name' | 'interests' | 'done'
asksOut:       Array<{ id, summary, status: 'traveling'|'matched'|'dead', standing: bool }>
activeMatch:   null | { masked: {...}, revealed: null | {name, vouches[]}, terms, verifyState }
conversations: Array<{ id, name, lastLine, unread: bool }>
invitesOut:    Array<{ to, state: 'sent'|'awaitingConfirm'|'confirmed'|'voided' }>
counters:      { asksSent, asksMatched, handshakesDone, forwardsRelayed, deadQueries }  // local only
```
Every screen below declares which slice it reads and which transitions it triggers.

---

## Part IV — Screen Specifications

> Format for each screen: **DESIGN** (rationale, for humans) then **BUILD** (layout, states, copy, acceptance — for Claude Code). Copy strings in BUILD are **normative**: ship them verbatim unless a human overrides.

### 9. Onboarding

**DESIGN.** The first 90 seconds decide whether the mental model lands. Three ideas must arrive *by experience, not explanation*: (1) you got here because someone vouched for you — trust is personal; (2) there is no account, no password, no profile to build — identity is quiet; (3) you participate by *speaking what you're into*, not by filling out who you are. Consent must precede existence: the user sees who invited them and the community's house rules *before* any key is generated (DD §30.3). Typing is minimized to a single field (a name). Backup is **not** a day-one gate — nagging about key loss before the user cares is friction that kills activation; nudge it the next day (DD §14.1).

**BUILD.**
Reads: `onboarding`. Triggers: `redeemInvite` (DD §30.3), key generation, `setInterests`.

Sequence (4 steps, each a full screen):

1. **Invite landing** — reached via `weft.link/i#<token>` fragment or QR scan.
   - Parse token locally (DD §30.3 step 1). On invalid/expired: danger card, copy: *"This invite has expired or isn't valid. Ask your friend for a fresh one."* + single `OK`.
   - On valid: Card showing inviter name, tier phrased warmly, and community name. Copy: *"{InviterName} invited you — and vouches for you. That means people here can trust you're real, because they know you."* Button `primary`: **See the house rules**.
   - **No key exists yet at this step.** (Acceptance-critical.)
2. **Charter consent** — scrollable card, ≤6 lines of house rules from the fetched charter (verify charter hash = `chp`, DD §30.3 step 2), steward names at the bottom. Button `primary`: **Agree & join**. Ghost button: **Not now** (aborts, no key created).
3. **Name** — single text field, label *"What should people call you?"*, placeholder *"first name is fine"*. Button `primary`: **Continue** (disabled until non-empty). Key generation happens silently on Continue (DD §30.3 step 3). Copy beneath field, small/muted: *"No account, no password. Just a name your people will recognize."*
4. **Speak interests** — large mic button (v0: also a text field + "Add"), prompt *"Tell me a couple of things you're into — just talk."* User input → up to 3 interest chips shown with an ✕ each. Button `primary`: **Done** (enabled with ≥1 interest).
   - Land on Home. Fire the redemption event (DD §30.3 step 4) now.

Post-onboarding (next app open, once): dismissible banner, copy: *"If you lose this phone, you lose your identity here. Take a minute to back it up?"* → links to backup export.

Acceptance:
- [ ] No keypair is generated before step 3's Continue (assert: `identity.hasKey === false` through steps 1–2).
- [ ] Charter with a hash ≠ `chp` shows the danger card, never the Agree button.
- [ ] "Not now" on charter leaves no key and no stored state.
- [ ] Completing step 4 lands on Home with ≥1 interest and a pending redemption enqueued.
- [ ] Backup banner appears on 2nd app open, not the 1st; dismissible; never blocks.

### 10. Home

**DESIGN.** The hub must feel like a quiet room, not a dashboard. The mic is the one verb. Asks-in-flight are reassuring, not nagging — a soft ripple that says "your question is out there, carried by people." Conversations sit below. "Your people" (invite) is present but never nags. When everything is empty, the screen is *calm*, not sad — emptiness is the resting state of a tool you pick up when you need it. The persona pill (v2) rides at the very top; in v0 it can be omitted or show a static "You".

**BUILD.**
Reads: `asksOut`, `conversations`, `identity`. Triggers: navigate(ask/match/invite/phil).

Layout, top→bottom:
- *(v2 slot: persona pill — omit in v0)*
- H1 *"Ask your people"* + sub *"Hold the button and say what you're looking for. Your ask travels friend to friend — never a feed, never a database."*
- **Ripple + Mic** region (height ~140px): 8 ambient dots; when any ask is `traveling`, dots pulse + 3 expanding rings animate (respect reduced-motion). Mic button centered, opens Ask flow.
- **Match notification** (only if an ask is `matched`): accent-soft card, copy *"A match came back."* + one-line masked descriptor. Tap → Match screen.
- **Asks out** (each `traveling`/`matched` ask): slim card, summary line + living status line (`traveling`→ *"Traveling… reached friends of friends"*; `standing` adds *"· asks again in {N} days"*). `dead` asks show *"This one didn't find anyone — networks have gaps. Ask again anytime."* then fade after acknowledged.
- Eyebrow **Conversations** → conversation cards (name + last line).
- Eyebrow **Your people** → single card **Invite & vouch** / *"Bringing someone in means standing behind them."*
- Footer links: **Why it works this way** (always); **Steward mode** (only if `identity.isSteward`, v2).

Acceptance:
- [ ] With no asks and no conversations, Home renders calmly (no error, no "nothing here!" language, no CTA pressure).
- [ ] Ripple animates iff ≥1 ask is `traveling`; disabled entirely under reduced-motion.
- [ ] No numeric badges anywhere on this screen.
- [ ] A `dead` ask uses the exact copy and never uses red or the word "failed".

### 11. Ask flow

**DESIGN.** This is the heart. It must feel like talking, then two or three quick taps to sharpen — never like a search form. Clarifying questions are *lazy*: only ask what the utterance left ambiguous (DD §2). The confirm card restates the ask in plain words and — critically — states the privacy promise *inline, every time* ("your name stays hidden until you both agree"), because that promise is the product's core claim and belongs where the user acts on it, not buried in settings. (Travel modes and the standing-ask toggle are DD §17/§25 — present in the mockup, **deferred in v0**: v0 ships "through friends" only and no standing toggle.)

**BUILD.**
Reads: interests, draft ask. Triggers: `ask()` (DD build M5-T3).

Steps:
1. **Speak** — mic (v0: + text field). Prompt *"Just talk. Say it the way you'd say it to a friend."* Transcript/typed text appears editable.
2. **Chips** — up to 3 questions, each answered by tapping one chip; skip any the utterance already answered. v0 question set (hardcoded): *"Looking to…"* [`learn`|`swap as peers`|`trade materials`]; *"Location…"* [`anywhere`|`prefer nearby`|`must be local`]; *"Hoping for…"* [`a person or two`|`a small group`]. Show progress *"Question {i} of {n}"* and, when skipping, why (*"your level was already heard, so it won't be asked"*).
3. *(v2 slot: travel-mode RadioCards + "Never through…" toggles — omit in v0)*
4. **Confirm** — card restating the ask in a plain sentence built from chips. Divider. Privacy line (normative): *"Your name stays hidden until you both agree to connect. To anyone who receives this, it looks passed-along — never yours."* Buttons: `primary` **Send it**; `ghost` **Edit** (→ back to chips). On send: create the ask, set status `traveling`, return to Home, toast *"Your ask is traveling. Answers usually come within a day or two, as friends come online."*

Acceptance:
- [ ] A chip question whose answer is inferable from the utterance is skipped, with the skip reason shown.
- [ ] The confirm card always shows the privacy line verbatim.
- [ ] "Send it" transitions the ask to `traveling` and shows the exact toast.
- [ ] No travel-mode or standing controls render in v0.
- [ ] Text-only path (no mic) can complete the entire flow (accessibility floor, DD §16.8).

### 12. Match & Reveal

**DESIGN.** The most emotionally charged screen, and the one where trust and safety are *felt*. A match starts masked: you see what the other *is*, never who. The trust line is the soul of it — rendered as a human sentence with an amber seal, never a score (DD §35 F1 note: trust chains are self-contained, but the user just sees "through people Maya trusts"). The exchange terms are shown as plain toggles defaulting to what the user offered. Two buttons only: Connect / Pass. **Pass must feel frictionless and be truly invisible** — the copy teaches the harassment-proofing in one line ("passing is invisible"), which does more for user safety understanding than any settings page. The reveal is the app's *one ceremony*: a single deliberate card-flip (respect reduced-motion → cross-fade instead) from silhouette to real name + vouches. If verification fails, the flip never happens; a flat danger card explains impersonation plainly and closes the connection.

**BUILD.**
Reads: `activeMatch`. Triggers: `intentPing`, `termsResponse`, reveal handshake (DD §5, build M5-T4), `pass` (local only).

Masked state:
- Card: avatar "?", title *"Someone, a few hops away"*, descriptor line (level / region — whatever the match token carries, all non-identifying).
- **v0 scope (DD §35 F9):** v0 matches are **person-to-person only**. The "a small group" chip may be *offered* as a preference, but a v0 build must not emit or render a group-as-respondent match — group replies (kind 4911 / `grp`-tagged 4912) are v2. The "5 people, meets monthly" group descriptor seen in the mockup is a v2 surface; in v0 the descriptor never claims to be a group.
- **Trust line** (trust card + Seal): *"Arrived through people {Name} trusts. Their endorsements will be checked the moment names unlock."* For distant/anonymous matches: *"A vouched member of this community — identity sealed."* Distant = cooler tone, **never danger red** (distance is information, not threat).
- **Terms card**: toggles for each shareable attribute (name, vouches, city…), defaulting to the user's offer. Copy header: *"If you both agree, you exchange — at the same moment, or not at all:"*
- Buttons: `primary` **Connect** (→ intent ping / await mutual); `quiet` **Pass**. Sub-line under Pass (normative): *"Passing is invisible. The protocol has no 'no' — silence is indistinguishable from an ask that faded."*

Connect → mutual-consent → **Reveal**:
- Single flip animation (800ms; reduced-motion: 200ms cross-fade). Front = masked silhouette; back = trust-bordered card with real name + each vouch as a Seal line: *"Vouched by {Name} ({context}, since {year})"*.
- Copy above the flipped card: *"Both of you said yes, so both cards flipped at once — and the endorsements checked out against their real identity."*
- Continue → opens Conversation. *(v2 slot: meetup escrow flow attaches here — omit in v0.)*

Verification-failure state (impersonation, DD §5 stage 4):
- No flip. Danger card, copy: *"This person's vouches don't check out — the endorsements were for someone else. This looks like impersonation, so we've closed the connection."* One button **OK**. *(v2: "Tell {Inviter}?" option.)*

Pass:
- Local state change only. **Zero network events emitted** (release-gate test). Return to Home, toast *"Passed quietly — there is no message for declining, so nothing can reach them."*

Acceptance:
- [ ] Masked card shows no identifying info (no name, exact address, precise age).
- [ ] Distant/anonymous matches never render in danger colors.
- [ ] Pass emits zero events (assert via relay log) and shows the exact toast.
- [ ] Reveal only flips after *mutual* consent; a one-sided Connect shows a waiting state, not a reveal.
- [ ] Verification failure shows the danger card and never reveals a name.
- [ ] Under reduced-motion, reveal cross-fades and no flip/ripple runs.

### 13. Conversation

**DESIGN.** Deliberately plain — this is where Weft's job ends and ordinary human conversation begins. No read receipts by default (they manufacture obligation), no typing indicators, no reactions in v0. Media (DD §34) is v2. The point is calm one-to-one or small-group text.

**BUILD.** Reads: `conversations[id]`. Standard message thread: bubbles, text input, send. v0: text only; no receipts, no typing state, no attachments. Group conversations render the same with a member-count band (rough, never exact-to-the-person if small). Acceptance: [ ] messages send/receive over the established channel; [ ] no read receipts or typing indicators exist in v0.

### 14. Invite & Vouch

**DESIGN.** Inviting *is* vouching — the copy must make bringing someone in feel like an act of standing behind them, not "growing your network" (banned framing). The address-book-never-leaves-the-phone promise is stated where the user acts. The confirmation step ("is this your Bob?") is where link-theft becomes a no-op; frame it as care, not security ceremony.

**BUILD.**
Reads: `invitesOut`. Triggers: `createInvite`, `confirm`, `void` (DD §30.3, build M5-T2).

- **Start**: three buttons — **Choose from contacts** (v0 web: type a name; native: OS picker), **Type an email or number**, **Show a QR in person**. Info card: *"Your address book never leaves this phone. In person, two QRs can finish the whole thing with no signal at all."*
- **Compose**: shows the message with `weft.link/i#…` link; note *"The token rides after the #, which browsers never send to any server — even our website can't see it pass."* Button **Send via Messages** (hands to OS share sheet).
- **Invites out**: each with state label + **Revoke** (while `sent`). 
- **Confirm card** (on redemption): trust-bordered, copy *"Someone joined with your invite to {Name}. Their name reads '{TypedName}' — is this your {Name}? Links travel like postcards, so your vouch waits for your word."* Buttons: `primary` **Yes, that's my {Name}** → publish vouch (privately, DD §35 F1); `quiet` **That's not them** → void, toast *"Voided. Whoever joined holds a key with no vouches — and here, that means no reach."*

Acceptance:
- [ ] Copy never says "grow your network" / "add friends"; uses "invite & vouch" / "your people".
- [ ] Revoke on a `sent` invite kills the token (subsequent redeem shows expired card).
- [ ] Confirm publishes the vouch via private delivery (no plaintext vouch on relay — DD §35 F1).
- [ ] Void leaves the joiner with zero vouches.

### 15. Why It Works This Way (philosophy & privacy)

**DESIGN.** This screen is a trust instrument, not marketing. Its power move is *radical legibility*: it shows the actual outbound telemetry beacon verbatim, so "here's exactly what leaves your phone" beats any privacy policy. Plain-language sections, one idea each, in the product's voice. It's reachable from Home and linked contextually at the moments each idea matters (after a reveal, in the invite flow).

**BUILD.** Static content screen. Sections (port copy from `weft-mockup` Phil screen; v0 omits sections for unbuilt features — travel modes, personas, escrow): *A channel, not a place · Asking, not broadcasting — and never signed · Rejection can't leak · Trust is people, not points · What leaves this phone · Invites never touch a server · Forgetting is the default.* The "what leaves this phone" section shows the local counters (v0) or the beacon JSON (v2) with the caption *"no topics, no names, no places, no graph."* Closing card (accent-soft): the one-sentence spec. Acceptance: [ ] no section describes a feature v0 lacks; [ ] the "what leaves" section shows real values, not a mockup.

### 16. Steward Mode (v2 — spec for continuity, not built in v0)

**DESIGN.** A working surface for community stewards: cell health in plain-language dials (not raw metrics), gentle nudges (e.g., "time for your own mailbox"), the weekly ask prompt, the charter, and a plain succession note. Health is described, never surveilled — computed locally from opt-in beacons. Deferred entirely in v0; documented so the IA has a home for it.

**BUILD (deferred).** See `weft-mockup` Steward screen for the reference layout. Not implemented in v0.

---

## Part V — Cross-Cutting Behaviors

### 17. Copy voice rules (BUILD — lint-able)

- Second person, warm, plain. Contractions welcome. Sentences short.
- Never: "request", "profile", "post", "feed", "followers", "network" (→ "your people"), "user", "content".
- Prefer verbs of *asking* and *carrying*: ask, travel, reach, come back, vouch, stand behind.
- Waiting copy is patient and specific ("as friends come online"), never "please wait" or a bare spinner.
- Decline/expiry copy is gentle and door-open; never "failed", "rejected", "error" (except true system errors and impersonation).
- One idea per card. If copy needs a second paragraph to explain a feature, the feature is probably wrong.

### 18. Motion & feedback (BUILD)

- The reveal flip is the *only* showy animation; everything else is ≤200ms functional transition.
- Ripple runs *only* while an ask is `traveling`. Never decorative elsewhere.
- Toasts confirm state changes in one line, 2.8s, non-blocking.
- **Every animation gated by `prefers-reduced-motion`.** Under reduce: no ripple, no dot pulse, flip→cross-fade. This is an accessibility requirement, not a nicety.

### 19. Accessibility (BUILD — required for v0)

- **Text is co-equal to voice everywhere.** No flow may require speaking (DD §16.8). Every mic has a text alternative in the same view.
- Voice-derived *intent inference* is limited to filling explicit slots; **never infer emotional state from voice** (DD §16.8 — a refused capability).
- Contrast: body text ≥ 4.5:1 on its surface (verify --ink on --card, --muted on --card).
- All interactive elements ≥ 44×44px touch target.
- Every control has an accessible label; the mic button announces its state (idle/listening).
- Screen-reader order follows visual order; the reveal flip announces the revealed identity via live region.
- Respect OS text-size scaling; cards must reflow, not clip.

### 20. Error, empty, and offline states (BUILD)

- **Offline** (DD §32.3): asks compose and queue; a calm banner *"Offline — your ask will travel when you reconnect."* No blocking, no data loss. Conversations read from local store.
- **Empty Home**: calm resting state (§10). No illustration-with-CTA guilt.
- **Dead query**: §10 copy; door-open; never red.
- **Invalid/expired invite**: danger card, §9 copy.
- **Impersonation**: danger card, §12 copy — the *only* other danger surface.
- **Genuine system error** (storage failure, etc.): plain apology + retry; never blame the user; log locally, never phone home.

### 21. Privacy surfacing principle (DESIGN + BUILD)

Privacy is stated **at the moment of the relevant action**, not centralized in a policy: the ask-confirm card states name-hiding; Pass states invisibility; Invite states the address-book promise; the philosophy screen shows the actual outbound data. **BUILD rule:** any new screen that sends something off-device must state, on that screen, what leaves and what doesn't — in one plain sentence.

---

## Part VI — Handoff

### 22. Build order (aligns with `weft-build-list.md`)

UI is build-list milestone **M6** and depends on engines M1–M5. Recommended screen order (each shippable/testable against the sim before real relays):
1. Home shell + navigation (empty states first — prove calm-empty).
2. Onboarding (consent-before-key is the acceptance-critical path).
3. Ask flow (text path first, mic second).
4. Match & Reveal (the four soul behaviors live here + in engines: masked→mutual reveal, invisible Pass, verification-failure, reduced-motion).
5. Invite & Vouch (private-vouch delivery, confirm/void).
6. Conversation (plain thread).
7. Why It Works (real values, not mockup).

### 23. Definition of done for the UX (v0)

- [ ] Every screen in Part IV implemented with its normative copy.
- [ ] All acceptance checkboxes in §§9–15 pass.
- [ ] The five UX laws hold; none of the §3 anti-patterns are present (grep the build for banned words as a CI lint).
- [ ] `prefers-reduced-motion` fully honored (§18); text-only completion of every flow (§19).
- [ ] Amber appears only on trust; danger only on impersonation/verification failure (visual audit).
- [ ] Privacy stated at each off-device action (§21).
- [ ] No feed, no scores, no badges beyond real matches/messages (visual + code audit).
- [ ] Matches the visual language of `weft-mockup.html` (side-by-side review).

### 24. For the human designer — where judgment is yours

This spec pins the *invariants* (the five laws, the emotional intents, the safety-critical copy, the token system). It deliberately leaves you room on: exact micro-copy tone within the voice rules; illustration/iconography beyond the Seal (keep it minimal); the precise ripple/dot aesthetic; onboarding pacing; and how Steward mode (v2) grows. When you change something, test it against the one sentence (§1) and the emotional table (§4). When Claude Code changes something, it must not touch anything with an acceptance checkbox without a human sign-off — those encode either safety (consent-before-key, invisible Pass, impersonation handling) or the product's soul (no feed, trust-as-sentences, calm-empty).
