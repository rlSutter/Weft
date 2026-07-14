# Observability

**The one rule this document exists to enforce: measure the system, never the people** (DD §10). Observability that violates that rule is worse than none — it becomes the surveillance chokepoint the whole design refuses. Every log line, counter, dashboard, and debug print in this repo must pass a red-team test before it lands: *"could this signal, alone or joined with others, deanonymize a person, reveal an interest, or reconstruct an edge of the social graph?"* If plausibly yes, it doesn't ship.

This document covers what developers can see **during implementation**, what the shipping software may emit, what it must never emit, and how new signals get added. Observability review is co-owned with **Fable** — any new counter, log field, or dashboard added after M0 requires Fable's sign-off recorded in the CHANGELOG entry for its phase.

> **Revision note (2026-07-13).** Updated for DD §35. Material changes: the red-team question now includes *graph reconstruction* (F1); route tokens and query ids join the never-log list (F2); per-contact breakdowns of any counter are banned; the dev tracer is barred from running against public relays carrying real users' traffic.

---

## What v0 emits (the whole list)

Very little, on purpose.

### Local counters only
Per build-list M5-T5, v0 ships **local, increment-only counters** stored in each device's own store:

| Counter | Increments on | Visible to |
|---|---|---|
| `asksSent` | Every ask the user originates | User only |
| `asksMatched` | Every match reply arriving at the user's ephemeral key | User only |
| `handshakesCompleted` | Every handshake reaching `channelOpen` | User only |
| `forwardsRelayed` | Every query this device forwards for others | User only |
| `deadQueries` | Every outbound ask whose TTL expired without a match | User only |

That's it. No publishing, no beacon event, no aggregator, no dashboard, no server. They surface on the "What leaves this phone" screen (UX §15) captioned *"these numbers never leave this phone."*

**Aggregate only — never per-contact.** *(New, DD §35 F1.)* These counters are device-wide scalars. No counter may ever be broken down per contact, per path, or per interest in any exported, logged, or published form — a per-contact forward count *is* an edge of the social graph, which is protected asset #1 (`SECURITY.md`). The private routing sketch (per-contact centroids) is likewise never logged, never exported, and never displayed as a ranking of people.

### Beacon publishing is DEFERRED
The beacon design (DD §10.2 — signed, bucketed, noised, k-anonymity-floored, opt-in) does **not** ship in v0 (build-list §13). Zero telemetry leaves the device. This is enforced **by not writing the beacon-publishing code**, not by a feature flag — there is no flag to flip, no endpoint to point at.

### Relay ops metrics are DEFERRED
DD §10.4's relay-side kind (4906) is not implemented in v0. Relays log whatever their operators choose; our code neither reads nor writes those metrics. We run no relays as part of the product.

---

## Development-time observability (what devs get)

Building this without visibility would be reckless — DD §10.5's alarm conditions (sketch drift, handshake regressions, vouch anomalies) matter *more* during development than in production. So there is real dev-time telemetry, gated so it cannot ship.

### Structured logging (`@weft/core`'s `logger`)
- One tiny logger in `core/src/log.ts`. Levels: `error | warn | info | debug | trace`. No third-party logging library.
- **Production builds strip `debug` and `trace` at compile time** via a bundler define (`WEFT_LOG_LEVEL`); they cannot be re-enabled at runtime by a user or an attacker.
- Every record is a plain object: `ts`, `level`, `mod`, `event` (short kebab code), typed fields. Never free-text messages with interpolated secrets.

### Log-content rules (enforced by review; violations are bugs, not style)
For every log line ask: *"is this safe if a developer screenshots it, and safe if the device is seized?"*

**Never log:**
- Any secret key, ephemeral secret, decrypted embedding, plaintext handshake payload, decrypted identity payload, or plaintext of a redeem/reveal event.
- **The origin of any query, anywhere, ever.** Not in logs, not in structs, not in debug prints, not in error messages. This is invariant 4 in code; see `TESTING.md` Gate 1.
- **Route tokens (`rt`) in any way that correlates them across hops.** *(New, F2.)* Logging an incoming and outgoing token in the same record rebuilds the swap table — the exact linkage the blinding exists to destroy. Log at most one token, hashed, under `trace`.
- **Query ids at the wrapper layer.** They live inside the sealed payload and must never appear beside routing metadata.
- **Vouch issuer ↔ subject pairs.** *(New, F1.)* An issuer/subject tuple is a social-graph edge — protected asset #1. Log the attestation hash if you must log anything.
- Contact pubkeys alongside interest data (linkage). Contact pubkeys alone with routing counts are borderline: module `debug` only, never `info`.
- Query embeddings in the clear. Log an L2 norm and a 4-byte fingerprint at most, and only under `trace`.
- User-typed text (ask utterances, display names, message bodies). Log lengths and presence, never contents.

**OK to log:**
- Wire-shape summaries: kind number, event id (hex), size in bytes, expiration.
- Protocol counters (the five above) as `info` deltas.
- State-machine transitions by state name (`idle → pinged`), no payloads.
- Error causes at the type level (`"NIP-44 decrypt failed"`), never ciphertext.
- Fake-clock timestamps in tests.

### Dev-time tooling (does not ship)
Under `weft/packages/sim/`, each marked `// DEV ONLY — must not be imported by @weft/pwa or @weft/porch`:
- **Event tracer** — subscribes to MockRelay, prints a live protocol trace (kind, direction, size, event id).
- **Sketch inspector** — prints each contact's centroid summary from a `MemoryStore`.
- **Handshake ladder** — ASCII diagram of a handshake's stages across nodes.

**Sim-only, and that is a security boundary, not a convenience.** *(New.)* These tools must never be pointed at a public relay carrying other people's traffic: the tracer against a live relay is a traffic-analysis instrument, and the design does not exempt its own authors. Layer-5 manual tests (`TESTING.md`) observe only our own throwaway nodes' behavior, never third-party traffic. A CI check (M6) asserts these modules are unreachable from the `pwa` and `porch` bundle graphs.

### `console.log` policy
No `console.log` in shipped code, ever. Use the logger. A pre-commit lint (M6) greps for `console\.(log|debug|info|warn|error)`. The sole exception: a top-level uncaught-exception handler in `pwa/` and `porch/` printing one line, so a crash isn't silent.

---

## User-facing observability (UX §15's "What leaves this phone")

In v0 that screen shows:
- The five local counters, live.
- The caption *"no topics, no names, no places, no graph."*
- The sentence *"these numbers never leave this phone"* (verbatim).

When beacons ship (v2), the screen additionally shows the exact outbound beacon JSON — the *trust move* (DD §10.2): radical legibility beats a privacy policy. That is a v2 UI change accompanying a v2 protocol change. In v0 there is nothing outbound to show, and the screen must not imply otherwise (F16: public claims never outrun the code).

---

## Adding a new metric or log field

Every proposal follows this checklist. Fable and the human designer both sign off; the CHANGELOG entry names them.

1. **Red-team test.** *Could this signal, alone or joined with any other logged/emitted signal, deanonymize a person, reveal an interest, or reconstruct a graph edge?* If plausibly yes, redesign or discard.
2. **Graph test.** *(New, F1.)* Does the signal, or any join of signals, link two pubkeys? If so it does not ship in any form that leaves the device — not bucketed, not noised, not hashed. The graph is not a metric.
3. **Bucketing and noise.** Anything that survives red-teaming *and* is published to more than one party ships bucketed and noised (calibrated randomized response), per DD §10.2. Publishing a raw count is a wire-format regression.
4. **k-anonymity floor.** For per-interest or per-cell metrics, emit nothing when the population below the metric is smaller than k (initial k = 20 — a repo-chosen starting value, tuned per metric with Fable's review). Rare things are identifying by existence.
5. **Documented here.** The signal appears in this file with its definition, retention, and red-team notes. If it isn't documented here, it isn't shipped.
6. **User-visible in UX §15.** Anything that leaves the device is shown to the user verbatim, as-emitted.

Silent additions are treated as security incidents (`SECURITY.md` § *Incident response*).

---

## Alarm conditions (planned, not built)

DD §10.5 names six health signals (rising dead-query ratio, hop inflation, falling handshake completion, vouch-anomaly clustering, beacon-participation decline). In v0 they are computable from the local counters but not visualized beyond the "What leaves" screen. The alarm dashboard is a v2 artifact tied to the beacon layer.

Two future signals are already specified and worth naming here so they are not forgotten: **entry-tier mobility** (the equity audit — what fraction of open-entry identities earn a relationship vouch within 8 weeks; DD §20.5) and **re-ask-after-match** (the shame metric — if people re-ask for what the system already "found" them, matching is confidently mediocre; DD §27.1). Both are v2 beacon counters, both bucketed and noised, both subject to the graph test above.

---

## Sentinel pairs (v2)

DD §10.3's sentinel/cover-traffic scheme gets *active* end-to-end measurement without exposing real queries — synthetic queries between consenting volunteer nodes that double as chaff. Not built in v0. When it lands it gets its own section here plus a full red-team review, because sentinels *are* traffic, and traffic patterns are the subtlest leak in the system.

---

## Anti-patterns (banned, no exceptions)

- **Analytics SDKs of any kind** in `pwa/` or `porch/`: no Google Analytics, Sentry, PostHog, Mixpanel, Amplitude, Datadog RUM. If a stack trace must leave a device, it does so through a **user-initiated export** that shows the payload first, then hands it to the OS share sheet — never automatically.
- **Automatic crash reporting.** Automatic means the user did not choose.
- **Server-side logs of relayed ciphertext.** We run no relays as part of the product. If a foundation relay ever exists, its logs follow DD §10.4 exactly: public metrics about the *relay*, never about traffic.
- **Correlated identifiers across sessions.** No device ID, no install ID, no anonymous-analytics ID. The pubkey suffices where identity is needed; nothing else is added.
- **Per-contact or per-path counters** in anything that leaves the device. *(New, F1.)* That is the social graph wearing a metric's clothes.
- **"Just for debugging" toggles that ship.** If it's for debugging, strip it from the production bundle — and test that it's stripped.

---

## Review

Fable reviews this document at every phase boundary against the code that actually ships. The question is always the same: *does what we ship match what this file says?* If not, either the code changes or this file changes — and the CHANGELOG records which.
