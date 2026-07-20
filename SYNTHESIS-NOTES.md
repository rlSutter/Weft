# How I'd do the next synthesis differently

> **Canonical status.** *Governs:* the discipline for paraphrasing any spec into a derived doc — READMEs, landing pages, steward guides, marketing copy, RFC excerpts. *Defers to:* nothing (meta-process note). *Last reviewed:* 2026-07-19 (post-v0.1.0-alpha, pre-M9 groups build). Consulted before writing any doc that restates a construction from `weft-design.md`; changes require a real failure or success case to justify.

*A short note-to-self prompted by Fable's review of `GROUPS.md` — one real technical error (E1), three subtle drifts, and several substantive gaps. Aimed at any future task where I paraphrase `weft-design.md` (or any other spec) into a derived doc: README copy, landing pages, a steward guide like GROUPS.md, marketing text, RFC excerpts.*

The critique was warm on the overall synthesis and honest on the alpha's scope. The one real technical error (E1: `scope_nym = PRF(root_secret, cell_id)`) was not a careless typo — I copied the spec's own compressed one-liner faithfully. That's what made it a useful lesson: **faithful paraphrase of a compressed crypto formula can inherit and propagate a leak, because the safety-carrying detail lives in the surrounding words, not in the formula.** Below is what I'd change about my own process next time.

---

## 1. Write "why is this safe" before writing the formula

Every crypto construction has a set of properties it's supposed to give you. For `scope_nym` those are (roughly): deterministic within scope; unlinkable across scopes; unlinkable from issuance; bounded compromise. If I'd tried to write those four sentences *before* copying `PRF(root_secret, scope_id)`, I would have noticed that the formula as written doesn't deliver (3) or (4) — because a fixed function of a long-lived secret and a public value can't. The spec's paragraph *around* the formula carried the ZK-binding property that made the whole thing work; the formula alone did not.

**Rule for next time:** for any crypto construction I'm paraphrasing, the derived doc must contain the "why is this safe" sentences *first*, and I must read my proposed formula against them one by one. If the formula's plain reading fails a property, the formula is wrong for the derived doc even if it's a verbatim copy from the spec.

## 2. Enumerate what each side sees

For any protocol step, ask: **what can the observer/counterparty compute from what they see, and what can they NOT compute?** In G1 (the greeter blind-issuance gap) I hadn't asked this question about the greeter. Once you ask "what does the greeter see at 4933 delivery time?" the missing wire-level requirement (delivery to a joiner-ephemeral pubkey, not the joiner's identity key) becomes obvious.

**Rule for next time:** for each actor named in a paraphrased protocol step, one bullet: what they see, what they can derive, what they cannot. If I can't fill in the third column, I don't understand the step.

## 3. Root-secret compromise is a real threat model

The design as a whole treats device compromise, subpoena, and endpoint capture as first-class threats. When I quoted `PRF(root_secret, scope_id)`, I implicitly assumed root secrecy as a background axiom, which contradicts the spec's own posture. Any construction whose safety reduces to "the root doesn't leak" is weaker than the design otherwise claims to be, and the derived doc should either flag that or, if the underlying construction is stronger than that (as `scope_nym` actually is with the ZK binding), state it correctly.

**Rule for next time:** compromise scenarios are on the checklist alongside passive observers. If the paraphrase treats "eve doesn't have root" as sufficient, either the paraphrase is wrong or the design has a bug — and either way I should say so, not paper over it.

## 4. Adjacent-system vocabulary is a trap

I wrote "sender-keys with naive rotation" for the ≤150 regime. In Signal's lexicon "sender keys" means each sender has their own ratcheted key; DD's construction is a single shared symmetric group key with per-member key-wrapping. That's D3 in the critique — a small drift with real consequences for anyone implementing from the derived doc.

**Rule for next time:** if I reach for a term from a well-known adjacent system (Signal, MLS, Matrix, IPFS, ActivityPub, TLS, JWTs), stop and check whether the term means the same thing in this spec. Rename to something spec-native rather than borrowing an established term with its own baggage.

## 5. If the body assigns a role, that role isn't an open question anymore

GROUPS.md's body assigned the greeter concrete responsibilities (publish 4911, verify every 4932, issue every 4933) and then its own open-questions section asked "who does the greeter role?" as if unspecified. That's internally inconsistent. If the body commits, the open question section should either not ask, or should ask something more specific (like "plural greeters — how many? how rotated?").

**Rule for next time:** cross-check open questions against the body. Anything the body commits to should be removed from open questions, or the open question sharpened to the actually-unresolved edge.

## 6. Cite the source section next to the paraphrase

DD §36.1's compressed form is what I inherited. If the paraphrase had been `scope_nym = PRF(root_secret, scope_id)` (§36.1) with the section number visible, a reviewer (or later me) could go read the full paragraph and catch that the ZK-binding language was lost. Citation isn't just for provenance; it's a re-entry point when the paraphrase turns out to have compressed too far.

**Rule for next time:** every technical claim in a derived doc carries the section number of its source. Cheap for the writer, priceless for the reviewer.

## 7. Name one-way transitions as one-way

The MLS transition (>150 members) was described smoothly in GROUPS.md; it's actually a one-way ratchet — you can't easily shrink back — and the wiring of scope_nyms into MLS leaf identities is explicitly non-trivial and unspecified. Smooth phrasing hides real discontinuities and misleads whoever is planning around them.

**Rule for next time:** if a transition, migration, or upgrade is not reversible, say so, in that word. If a piece of the transition is unspecified, carry that caveat forward; don't lose it in the paraphrase.

## 8. Re-derive at least one safety property from scratch, don't just copy the claim

Rules 1 and 6 combined: cite the source section *and* re-derive at least one safety property in your own words rather than copying its statement. Copying the *property claim* ("unlinkable across scopes") preserves the claim while losing the reason — and it was the reason that mattered in E1. Re-deriving forces the compressed detail back into view, because you can't derive a property from a formula that doesn't actually deliver it.

**Rule for next time:** for any restated construction, pick at least one non-trivial safety property and walk the derivation in the derived doc — even a paragraph is enough. If the derivation stalls, the paraphrase is compressed too far and the formula (or the surrounding words) needs to grow back to the point where the derivation works.

---

## Checklist for the next paraphrase task

When I'm about to synthesize part of `weft-design.md` (or any spec) into a derived doc, before I write:

- [ ] What are the safety properties this construction is supposed to give? Write them as sentences first.
- [ ] For each actor in a paraphrased protocol step: what do they see, derive, and NOT compute?
- [ ] Does my proposed paraphrase's plain reading deliver every safety property? If not, the paraphrase is wrong even if it's a verbatim copy from the source.
- [ ] Am I reusing a term from Signal/MLS/Matrix/etc.? Does it mean the same thing here?
- [ ] Have I cross-checked my "open questions" section against my body — does the body already commit to answers?
- [ ] Are section citations on every technical claim?
- [ ] For every transition described smoothly: is it actually one-way? Is any piece of it unspecified?
- [ ] Have I re-derived at least one safety property in my own words, rather than copying the claim from the source?

Any "no" is an edit to make before publishing.

---

## Applied here

The read-back pattern that produced the DD §36.1 and §36.2 amendments used this discipline explicitly: each amendment led with "safety story (write this first)," derived the construction after, and enumerated remaining uncertainties as questions for Fable to sanity-check rather than as claims. Both amendments landed in `weft-design.md` unchanged from the read-back — the discipline worked as intended.
