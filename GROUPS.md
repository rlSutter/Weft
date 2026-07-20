# Weft — Groups

> **Canonical status.** *Governs:* the steward-facing synthesis of Weft's group/cell design and operations — what a cell is, how it sets up, and the pre-flight/launch/weekly cadence. Sits between the DD (specification) and the eventual `docs/groups-operations.md` (playbook). *Defers to:* `weft-design.md` §36 on protocol wire formats, `SECURITY.md` on threat model, `TESTING.md` on gates, `weft-build-list.md` §16 (M9–M13) on build order. *Last reviewed:* 2026-07-19 (post-v0.1.0-alpha, pre-M9 groups build); revised after Fable's critique cycle to correct scope_nym derivation and the small-group key scheme. Where this doc and the DD disagree, the DD wins.

This document synthesizes how communities ("cells") set themselves up in Weft. It draws from:

- **DD §7** — Community self-governance without a platform
- **DD §29** — The Steward Kit: a concrete checklist
- **DD §31** — Month one of a real seed cell, day by day
- **DD §36** — v2 specification of the group and persona layers
- **DD §12** — Cold-start playbook
- **Build list §16** — v2 milestones M9–M13

Where this doc and the design doc disagree, the design doc wins.

---

## Status

**Groups are v2 spec-complete but code-absent in v0.1.0-alpha.** They're fully specified in DD §36 — every kind number, every state transition, every ejection semantics — so nothing has to be renumbered or rewritten when we build them. But no code exists yet. What today's alpha gives you is a **1:1 vouch graph**, not first-class groups. See "What today's alpha gives you" below.

> **Revision (Fable review):** this doc has been corrected on the scope_nym derivation (it's a credential-bound ZK nullifier, not a raw `PRF(root_secret, cell_id)`), the small-group key scheme (shared key with per-member wrapping, not "sender keys"), and the 4911/roster details; and a "Sharp edges" section now captures the greeter bottleneck, the per-cell Sybil surface, the no-appeal property, the cold-join path, and the MLS threshold. See `weft-groups-critique.md` for the full critique and two proposed DD §36 amendments.

Groups depend on the BBS+ credential engine (M9). Without that machinery, groups either (a) require members to reveal their real identity to be counted, defeating pseudonymity, or (b) publish membership as plaintext, which puts the social graph on the wire and breaks Gate 3 (TESTING.md). So the honest sequence is: credential engine first, then groups.

---

## What today's alpha gives you

There is no `Group` object, no charter, no shared membership list, no group messaging, no "you're in the Koji Fermentation Circle now" pill. What exists is:

- **A 1:1 vouch graph.** Alice invites Bob, Bob invites Carol, and now the three of them can reach each other by hopping (Alice → Bob → Carol) when they ask questions. The "group" is emergent — visible only in the topology, not named.
- **De-facto communities.** If you want to run a community today, one person (call them the steward) invites everyone individually. Everyone else has that person plus their own invitees as contacts. Asks travel across the friend-of-friend graph.

**What you can do today to approximate a group:**

1. One person acts as steward. They invite each member individually.
2. Everyone declares related topics as their "What you're into" interests (e.g., "koji fermentation", "miso", "aspergillus").
3. When one member asks a matching question, the rest of the network's matchers fire.
4. Pairwise chats happen after reveals.

No group messaging, no shared roster, no charter, no ejection. But the discovery loop works — everyone who declared matching interests reachable through the vouch graph can find each other. It looks like a series of 1:1 conversations rather than a room.

---

## What groups look like when v2 ships (DD §36)

Groups become durable, self-governing channels with the following ingredients.

### The charter

A signed event (kind 4900) whose id **is** the cell's identity. Contents:

- **≤6 human-readable house rules** (UX convention — a "front porch" you can read on one screen)
- **Steward pubkey set** (usually 2–5 people)
- **Amendment rule** (e.g., "3-of-5 stewards required to change governance keys")
- **Ejection procedure** (whose signatures or jury decision boots someone)
- **Chosen embedding model** (a group can pick a model tuned to its vocabulary; see DD §19)
- **Media policy** (DD §34)
- **Credential constants**: `k` for k-show bounds, epoch length

Amendments chain via a `prev` reference. **Cell id = genesis charter id.** The current charter pointer is what invites carry (`chp` field, DD §30); verification walks the `prev` chain back to genesis. Steward rotation is an amendment. Nothing forces you to name your cell — the id is enough for the protocol; names are UI convention.

### Pseudonymous membership (scope_nyms)

A member's identifier inside a group is **not** their real pubkey. It is a **credential-bound nullifier**, proven in zero knowledge:

```
scope_nym = PRF(k_cred, cell_id)
```

where `k_cred` is a per-credential secret the holder proves knowledge of in ZK — **not** a raw function of the long-lived root secret presented in the clear. Why the distinction matters:

- **Deterministic within the cell** — the same credential always produces the same face in the same room, so ejection sticks.
- **Unlinkable across cells** — you can be in a professional cell and a recovery-group cell without either knowing the other exists.
- **Provably bound to a valid credential at first presentation** — the anonymous-credential machinery (§36.1) proves "the holder of this scope_nym holds a vouch within this cell's issuer scope" without saying which vouch. **The privacy comes from the ZK binding, not from the PRF** — a bare `PRF(root_secret, cell_id)` presented in the clear would be linkable by the issuer and would let a single root-secret compromise retroactively delink every pseudonym in every cell. The nullifier is keyed by the per-credential secret precisely so that compromise of the root does not unravel the user's whole pseudonymous history, and so the greeter who issues the credential cannot later correlate issuance to presence.

> **Correction note:** an earlier draft (and DD §36.1's compressed one-liner) wrote `scope_nym = PRF(root_secret, cell_id)`. That drops the exact property that makes the scheme safe. Fable has proposed a DD §36.1 amendment to the credential-bound form; this document uses the corrected version.

Governance operates entirely on scope_nyms — ejection names a scope_nym, not a person. That's what lets the ban stick against someone the group never identified.

### Joining a group

Five wire steps (DD §36.2):

1. Prospective member obtains an invite whose `chp` names the cell's current charter.
2. They present a **credential** (BBS+ zero-knowledge proof of "I hold a vouch within this cell's issuer scope") plus their fresh scope_nym and a **fresh ephemeral delivery pubkey `p_join_eph`** — inner kind **4932 group join request**. The request carries **no** joiner identity key.
3. A charter-designated **steward or greeter** verifies the presentation and the non-collision of the scope_nym (not already present, not previously ejected).
4. Greeter issues a **membership grant** — inner kind **4933** — wrapped to **`p_join_eph`** (not the joiner's identity key), containing the current group key, plus the joiner's scope_nym recorded in the group's roster (itself a **group-key-encrypted 4920-class record**, never public — the same message primitive, not a separate structure).
5. Joiner signs a **charter consent receipt** (kind 4922) with a **cell-scoped signing key** `k_sign = PRF(k_cred, scope_id ‖ "sign")`, not their identity key — the "agreed at the porch" record.

**Consent precedes key delivery** — mirrors the v0 invite pattern (DD §30.3 "consent precedes existence").

**Greeter blind issuance (DD §36.2, Amendment B — now landed).** Every field the greeter sees at join is blinded: an ephemeral `p_join_eph`, a ZK credential proof, a `scope_nym`, and a cell-scoped `p_sign`. **No wire field carries the joiner's real network pubkey through the greeter's view**, so a captured or curious greeter cannot build the real-identity → scope_nym table that scope_nyms exist to prevent. This is the group-layer form of §35 F7. *Residual:* the greeter still sees join *timing* and the *relay* that carried the 4932 — publishing from a fresh/shared relay reduces this probabilistic link (the join-path instance of §35 F8); no wire blinding removes it entirely.

### Group messaging

Kind **4920**, encrypted under the current group key, published with a hashed-channel `h` tag members subscribe to. A relay sees only "traffic on channel h" — never who's in the group, never how many, never what's said. Sender identified by their scope_nym inside the ciphertext.

Media in groups uses the DD §34 pointer (kind 4926) with the blob key wrapped under the group key. Blobs live on shelves (dumb encrypted blob stores, Blossom-style); the group key gates access.

### Ejection = key rotation

Sanction is exclusion, exclusion is key rotation. Per charter rule (e.g., 3-of-5 stewards, or a jury verdict):

1. Stewards publish a **4904 ejection attestation** naming the ejected scope_nym, the charter clause cited, and an evidence *hash* only (evidence itself stays with the ejecting group).
2. Immediately, a **4921 rotation** issues a new group key wrapped to every member *except* the ejected scope_nym.
3. The ejected member retains messages they already decrypted (no reaching into devices) but receives nothing further. Their scope_nym for this group is deterministic and now known-ejected. Re-presenting a credential yields the same scope_nym, which the roster rejects.

**The ban holds against someone the group never identified.** This is the load-bearing property that makes anonymous membership + accountable governance both possible.

### Group-as-respondent (F9)

A charter-designated greeter publishes a **4911 group-interest declaration**, **encrypted under the group key** (so the group's interest profile is not exposed to relays), containing the group's declared-interest embeddings + the list of scope_nyms authorized to answer on the group's behalf. A member's client only auto-answers in group mode if it holds a *current* 4911 authorizing its scope_nym. When someone asks "anyone doing koji?" that matches the declaration:

- An authorized member's client emits a `grp`-tagged **4912** carrying a group-scoped credential presentation ("this reply speaks for {cell_id}, and the answerer is an authorized member") without revealing which member.
- The seeker's match card reads *"a small group, per Koji Circle charter"* rather than a personal identity.
- The reveal, if the handshake proceeds, unmasks "a member of {group}, per charter" — not the member's own name.
- Attaching a personal identity requires a **subsequent pairwise handshake inside the group**, at the member's option.

This is what makes the mockup's *"a small group, 5 people, meets monthly"* match type actually work at the wire level. Without it, "group" is just a folk term for a topology cluster.

### Charters, admin capture, and federated moderation

- Charter amendments that change governance keys require m-of-n signatures (from the steward set as declared in the current charter). A single-steward amendment is rejected.
- **Groups may subscribe to another group's ejection-attestation stream** — a moderation subscription that treats another cell's signed 4904s as weighted input. Federated moderation, per DD §7's "chosen, plural, fireable" rule. Attestations are weighted by the subscriber's trust in the issuer, never summed into a global score.
- **Cheap exit and forking** are the backstop against bad governance. A charter isn't binding; a member can leave any time, and members who disagree with a steward decision can fork the charter (with `prev` pointing at the last shared version) and take whoever comes with them.

### Small vs. large groups

Two key-management regimes, switched by size (per DD §9.1):

- **Small groups (≤150 members): a shared group key with per-member key-wrapping, naively rotated.** A single symmetric group key; each member also holds a per-member wrapping key established at join. (This is *not* "sender keys" in the Signal/MLS sense — every member decrypts with the same shared key; the per-member keys only wrap the shared key for delivery.) Rotation (4921) publishes the new group key wrapped once per *remaining* member — O(n) ciphertexts, fine at Ostrom scale. This is the v2-initial implementation.
- **Large groups (>150): MLS (RFC 9420).** The group becomes an MLS group; ratchet-tree operations give O(log n) rotation, forward secrecy, and post-compromise security. Charter-flagged migration: the group publishes an MLS `Welcome` to current members and thereafter uses MLS `Commit` messages (carried inside 4921) for all membership changes.

Groups that never cross 150 never pay MLS's complexity. **The sociology and the cryptography agree** — Ostrom's small-group findings and the O(log n) crossover coincide.

---

## How a real cell actually sets up

The design is opinionated: **seed one existing community of 50–150 people who already know each other** (Dunbar-scale). Below 50 the graph is too sparse to route anything and the experiment is uninformative. Above 150 you're past Ostrom's small-group governance sweet spot.

### Pre-flight (two weeks out, per DD §29)

- **Fit check.** Are these actually 50–150 people who mostly know each other, with real sub-interest diversity? (A fermentation group has koji people, natto people, cheese people — good. A random Discord of strangers — bad.)
- **Recruit 1–2 co-stewards.** Plural signers on the charter, plural porch nodes for availability, and nobody's vacation stalls the cell.
- **Install desktop client** on an always-on machine per steward. Enable "Steward mode" (v2 UI) which turns on porch-node forwarding, the invite ledger, and the local health dashboard.
- **Pick a charter template**, edit to ≤6 lines of house rules, co-sign with co-stewards, publish as the pinned charter event. Record its event id — this becomes the charter pointer every invite carries.
- **Relay decision.** Start on 2–3 public relays from the fallback set (fine at ≤30 members). Calendar a reminder to stand up the cell's own relay when membership crosses ~30. A cell relay is a $5–$10/month VPS or a Raspberry Pi running one container.
- **Generate the first invite batch** — one token per founding member. Print QR cards for launch day (strongest binding per DD §15.2). Never a reusable link; every invite is single-use per DD §30.
- **Choose which ejection-attestation feeds** (if any) the cell subscribes to. Or explicitly none. Write the choice into the charter.
- **Beacon conversation.** In v2, seed cells are laboratories; plan to *ask* members to opt into beacon telemetry (never default them in) per OBSERVABILITY.md.

### Launch day

- **Onboard in person at a regular gathering** (a monthly meetup, a Sunday service, a club meeting). QR invites — the strongest binding (DD §15.2). Two stewards scanning in parallel clears a room of 30 in about half an hour (90 seconds per person per DD §14.1).
- **Founding ritual: every new member speaks one real ask before leaving.** Routing sketches take their first imprint from 30 real queries in one evening. Normalizes the app's one verb.
- **Same-day confirmation of every redemption** ("yes, that's my Sam") while faces are fresh (§15.3 defense against link-theft).

### Weekly (steward time budget: ~4–6 hours, shrinking)

- Post the weekly ask prompt.
- Clear the invite ledger: confirm redemptions, revoke stale tokens.
- Read the local dashboard: dead-query ratio, hops-to-match, handshake funnel (DD §10.5 alarm table is the interpretation guide).
- Greet at the rendezvous if the cell runs a front-porch program (DD §20.3 "greeter stewardship").

### Milestones

- **~30 members:** stand up the cell's own relay (one container; Pi or $5 VPS); add to the charter's relay hints; members multi-home automatically via re-issued invites and a charter update event.
- **Week 8:** run the DD §12.5 gate review with co-stewards. Iterate in place vs. begin bridge scouting to a second cell (DD §12.6).
- **Any time — succession:** Steward mode exports the role, not the person. Charter co-signing keys are already plural; a departing steward's exit is one charter-update event naming the new signer set. If all stewards vanish, the cell still runs (forwarding, matching, and channels need no steward); only charter changes and new-member greeting stall — which is the correct failure mode.

### Success gates before considering a second cell (DD §12.5)

| Gate | Initial target |
|---|---|
| Query survival | >60% of queries matched within 48h |
| Hop routing share | Hop-routed matches > rendezvous matches |
| Handshake completion | >70% of mutually-interested handshakes complete |
| Retention | >50% of onboarded members active (querying or relaying) at week 8 |
| Qualitative | Members report matches they would not have found in their existing channel |

If gates fail, **iterate in place** — thresholds, dialogue design, terms UX — rather than adding people to a broken loop.

### Month-one blueprint

DD §31 walks through a concrete month day-by-day for a hypothetical "Cascade Fermentation Collective" — 62 people, one steward, two co-stewards. Realistic shape: ~30 onboard on Day 1, ghost-town risk in the cold week (Days 2–7), first hop-routed match around Days 8–14, first friction around Days 15–21, the surprise-lateral-match story around Days 22–30. **Every early failure signal has a social intervention before a technical one** — seed flow before tuning thresholds, check porch uptime before blaming matching, tell the surprise-match story before quoting the beacon.

---

## Why groups aren't in the alpha yet

They need the **BBS+ credential engine** to work correctly — that's the whole point of scope_nyms and k-show bounds. Building groups without that machinery would either:

- Require members to reveal their real identity to be counted, defeating the pseudonymity property that makes ejection stick against unknown-identity members, **or**
- Publish membership as plaintext, putting the social graph on the wire and breaking **Gate 3** ("no plaintext object linking two member pubkeys may ever appear on a relay", TESTING.md and CHANGELOG's disposition of DD §35 F1).

Build-list §16 has the v2 milestones ordered as:

- **M9** Credential engine (`core/src/cred`) — the gate; BBS+ over BLS12-381, k-show nullifiers, scoped pseudonyms, issuance flow
- **M10** Group layer (`core/src/group`) — charter/membership/messaging/ejection/MLS-transition
- **M11** Persona layer (`core/src/persona`) — hardened derivation, anonymous standing, lifecycle
- **M12** Rendezvous — vouched-anonymous entry (`core/src/group` reuse)
- **M13** Invariant re-audit — the two v2 release gates (Gate 5: plurality bounded; Gate 6: accountability scoped)

None are inert — the specs are complete so nothing needs to be renumbered. But no code exists yet. Rough estimate: ~15–25 days of focused work per §16, with one sanctioned new dependency (BBS+/BLS12-381).

---

## Two paths for shipping groups

### A. Full v2 per DD §36

The design's intent. Ships all five milestones (M9–M13). Preserves every privacy property: pseudonymous membership, anonymous credentials, k-show-bounded plurality, scope-exclusive pseudonyms that make ejection stick without identifying who was ejected. Reuses the same credential machinery for personas and anonymous rendezvous — one investment, three uses.

Cost: BBS+/BLS12-381 dependency (one library, well-audited), significant crypto engineering, MLS integration for large groups, careful invariant-5 test suite (Gates 5 and 6).

Timeline: ~15–25 days. See build-list §16 for per-task estimates.

### B. Minimum-viable groups (a proposed departure from DD §36)

Charter + membership + group messaging under a shared key, **skipping the anonymous-credential machinery**. Membership would be real-pubkey-based; the roster would be encrypted under the group key but participants would know each other's real identity. Ejection would still work via key rotation but would use real pubkeys not scope_nyms.

Cost: Much smaller — maybe 5–7 days. No new dependency. But:

- **Loses pseudonymity within the group.** Every member sees every other member's real pubkey. Fine for a fermentation club; not fine for a support group.
- **Breaks the property that makes rendezvous work.** Rendezvous (DD §17.4) needs the credential machinery too.
- **Postpones personas.** Personas share the same credential machinery.
- **Is a genuine spec departure.** Not just "v0 tolerates a residual"; would need a DD §36 amendment recording the deliberate reduction.

**When it might be right:** if we want to prove the group model works with real communities before committing to the full credential build. Test the sociology (do stewards actually work? does m-of-n governance stay usable? does federated moderation via attestation subscription mean anything to real users?) before spending three weeks on cryptography.

**When it's the wrong choice:** if we plan to invite any of the audiences the credential machinery exists for (support groups, anyone under duress, anyone for whom "membership visible to other members" is itself a threat). Then B is a footgun and A is the only honest option.

---

## Sharp edges the design answers (don't rediscover these as open questions)

Five properties an implementer or steward will hit that are already resolved in the design — stated here so they aren't re-litigated:

**The greeter is a liveness *and* privacy bottleneck (not just a labor question).** Every join blocks on a greeter being online to verify a ZK presentation (4932) and issue a wrapped key (4933): a cell whose greeters are all offline cannot admit anyone. Mitigation is already in the design — **plural, charter-authorized greeters** (the charter's authorized-answerer list is a scope_nym set; add greeters the same way) and rotation (DD §20.3 "greeter stewardship"). Sharper: the join flow **must not let the greeter learn the map between a joiner's network pubkey and their new scope_nym** — otherwise the greeter can build a real-identity→pseudonym table, which is the group-layer form of invite-tree capture (§35 F7). Blind issuance is required; this deserves an explicit M10 spec line.

**Groups concentrate issuance authority — a new Sybil surface.** k-show bounds plurality *per root*, not *per cell*. A captured or careless steward can issue in-scope vouches liberally and flood their own cell with credentialed scope_nyms. The network-level Sybil defense (paths through real people) is weaker inside a single cell whose issuer is one steward set. Mitigations are the §6 compromised-voucher toolkit (local trust, expiry, revocation) **plus m-of-n issuance** for cells that need it — but stewards should know a cell's issuer is its own trust root.

**There is no appeal — exit-and-fork *is* the appeal.** Ejection is cryptographically irreversible for a given scope_nym; you cannot un-ring it. A wrongly-ejected member can be re-admitted only as a *new* scope_nym (a charter/roster action), and if they disagree with the decision they can fork the charter (`prev` at the last shared version) and take whoever comes. Ejection evidence is a **hash only**, held by the ejecting group and **not independently verifiable by subscribers** — a cell weighting another cell's 4904 is trusting the issuer's judgment, not checking proof (the negative-attestation-as-harassment-vector concern, DD §7/§35). State this to stewards plainly.

**Group discovery for a *non-member* is the cold-join / equity problem, not a wire gap.** The group-as-respondent flow already brings a seeker into a handshake with the group; the join flow (4932/4933) is the natural continuation *once the seeker holds an in-scope vouch*. The genuinely open piece is narrow: **how does an unvouched seeker obtain a credential to present?** That routes through the equity ladders (DD §20 — institutional vouching, provisional vouches at rendezvous), not through a new protocol object. A "request to join" affordance triggers the 4932 flow once the seeker can present a credential.

**MLS crossover at 150 is a real threshold, not a config flag.** Two costs the smooth phrasing hides: (a) MLS leaf nodes carry credentials, and **wiring scope_nyms into MLS leaf identities is non-trivial and not yet fully specified** (DD §36.2 flags this) — pseudonymity across the migration needs design work; (b) the migration is a **one-way ratchet** — you don't easily shrink back. A cell approaching 150 should treat crossing it as a deliberate governance decision.

---

## Open questions worth Fable's review

The design has answers for most of these; the questions are about what to *build*, in what order. **Several of the original open questions are answered by the "Sharp edges" section above and by Fable's review (folded into this document); the genuinely open build-order questions remain below, annotated with Fable's current recommendation.**

1. **Is Path B (minimum-viable groups) worth the risk of a spec departure?** Ships faster and could validate the "does a cell actually work" hypothesis before we commit to the credential build. But it also risks people building on it, then breaking their identity models when we later insist on the pseudonymous version. What does Fable think about the DD §36 tradeoff?

   > **Fable:** Skip B as a shipped identity model. M9 (credential engine) is the gate for personas *and* rendezvous anyway, so building it first is sequenced work, not extra work. If you want to validate cell sociology *now*, do it on the existing 1:1 vouch graph (invite a real 40-person community, watch the discovery loop) rather than building a throwaway real-pubkey group primitive people will form ties around and then have to migrate off.

2. **Steward workflows aren't in the alpha UI at all.** The PWA currently has no "Steward mode" concept — no invite ledger UI beyond the individual user's own outgoing invites, no cell dashboard, no charter viewer. If we want to test cell dynamics before v2 groups ship, do we need Steward mode in v0.1.x? Or does that muddle the story ("here's a cell dashboard for a group primitive that doesn't exist yet")?

   > **Fable:** No Steward mode in v0.1.x — your instinct is right, it muddles the story. The one thing worth building now is bulk-invite / bulk-confirm (Q5), which helps the 1:1-vouch-graph "de-facto community" pattern today.

3. **The 50–150 seed size constraint is opinionated.** Real communities routinely land at 30 (a book club) or 300 (a mutual aid network). DD §12.1 says "below ~50 the graph is too sparse to route anything." Is that empirically true? Should we relax the guidance for cells that have unusually high query density, or unusually good sub-interest diversity? Fable's originality assessment says the 50–150 range is Ostrom applied — worth revisiting for Weft specifically.

   > **Fable:** Keep 50–150 as *default guidance*, but make the real gate a *measured* one — dead-query ratio, not head-count. High interest-diversity / high query-density cells can route fine below 50 (a tight 30-person book club may work). Reword §12.1 guidance to "measure query survival; don't assume a floor."

4. **Charter templates.** DD §29 references "template charters" repeatedly but doesn't ship any. If a steward doesn't have a template, they'll invent house rules from scratch — probably badly. Should the v2 build include a small library of charter templates (fermentation club, book group, mutual aid network, support group, professional community) with different tradeoffs? Or is that a governance-shaped mistake — the whole point being that charters are locally-written?

   > **Fable:** Ship 4–5 templates (fermentation club, book group, mutual aid, support group, professional) *as examples in the steward kit*, each foregrounding a different tradeoff, with a loud "edit these, don't adopt verbatim." A steward inventing rules badly from scratch is the worse failure. The §35 F16 discipline applies: templates that quietly become defaults are soft central governance — so present them as starting points, never defaults.

5. **The confirmation-card pattern doesn't scale to steward-driven joins.** DD §30.3's "is this really your Bob?" step is one-to-one. When Alice invites 20 people to a group launch, she can't sit through 20 confirmation cards. Do we need a bulk-confirm UI? A "trust these 20 QRs I scanned in person" mode? Or is the friction the point (§15.4 "inviting is cheap in taps and expensive in social capital")?

   > **Fable:** Build bulk-confirm. The friction argument is about *inviting*, not *confirming* — confirming 20 people you scanned in person in the room is not where social-capital friction belongs, and in-person QR *is* the strong binding (§15.2), so a "trust these N QRs I just scanned" batch mode doesn't weaken the link-theft defense. Useful today for the 1:1 graph, not only for v2 groups.

6. **Group discovery.** Nothing in the current design tells someone "there's a Koji Circle in your extended network — want to know about it?" The group is opaque to non-members by construction (that's the point). But if a member asks a matching question, the group can reply. Should there be a UX affordance for the seeker to say "I'd like to *join* rather than get an answer" — and if so, what does that wire look like beyond the current match card?

   > **Fable:** The wire already exists — a "request to join" affordance triggers the existing 4932 flow *once the seeker can present an in-scope credential*. The real open question is narrower (see Sharp edges §4): how does an unvouched seeker *obtain* that credential? Answer via the equity ladders (DD §20: institutional / provisional vouches), not a new object.

7. **The greeter role is critical and undefined.** DD §29 and §36.2 both name a "greeter" role that verifies incoming credentials and issues membership grants. But it's more work than "steward" — probably weekly hours per member joining. Who does this? Is it always the steward? Do cells rotate the greeter role? Is greeter-load a scaling limit before member-count is?

   > **Fable:** Yes — greeter-load can bind before member count (Sharp edges §1). Answer: plural, charter-authorized, rotated greeters, and a join flow specified so the greeter cannot learn the joiner's real-pubkey→scope_nym linkage (blind issuance). Worth a dedicated M10 spec pass; it's a liveness *and* privacy constraint, not just labor.

---

## Where this document belongs in the repo

This is a design-and-operations doc, not a spec. It's at repo root alongside README, STRUCTURE, TESTING, SECURITY, OBSERVABILITY, CHANGELOG. If it grows past a certain point, it splits into `docs/groups-spec.md` (protocol reference, distilled from DD §36) and `docs/groups-operations.md` (steward-facing playbook, distilled from DD §29 and §31).

For now, one file.
