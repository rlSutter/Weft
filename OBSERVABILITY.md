# Observability

**The one rule this document exists to enforce: measure the system, never the people** (DD §10). Observability that violates that rule is worse than none — it becomes the surveillance chokepoint the whole design refuses. Every log line, counter, dashboard, and debug print in this repo must pass a red-team test before it lands: *"could this metric, alone or joined with others, deanonymize a person or reveal an interest?"* If plausibly yes, it doesn't ship.

This document covers what developers can see **during implementation**, what the shipping software may emit, what it must never emit, and how new metrics get added. Observability review is co-owned with **Fable** — any new counter, log field, or dashboard added after M0 requires Fable's sign-off recorded in the CHANGELOG entry for its phase.

---

## What v0 emits (the whole list)

Very little, on purpose.

### Local counters only
Per build-list M5-T5, v0 ships **local, increment-only counters** stored in each device's own store. They are:

| Counter | Increments on | Visible to |
|---|---|---|
| `asksSent` | Every ask the user originates | User only |
| `asksMatched` | Every match reply that arrives at the user's ephemeral key | User only |
| `handshakesCompleted` | Every handshake that reaches `channelOpen` | User only |
| `forwardsRelayed` | Every query this device forwards for others | User only |
| `deadQueries` | Every outbound ask whose TTL expired without a match | User only |

That's it. No publishing, no beacon event, no aggregator, no dashboard, no server. The counters are surfaced to the user on the "What leaves this phone" screen (UX §15) with the caption *"these numbers never leave this phone."* They can be shown at will; they cannot be exported to anyone.

### Beacon publishing is DEFERRED
The beacon design (DD §10.2 — signed, bucketed, noised, k-anonymity-floored, opt-in) does not ship in v0 (build-list §13). Zero telemetry leaves the device. This is enforced by not writing the beacon-publishing code, not by a feature flag.

### Relay ops metrics are DEFERRED
DD §10.4's relay-side kind (4906) is not implemented in v0. Relays log whatever they log per their operator's choice; our code does not read or write those metrics.

---

## Development-time observability (what devs get)

Building this thing without any visibility would be reckless — the design's alarm conditions (DD §10.5: sketch drift, handshake stage regressions, vouch anomalies) matter during development *more* than in production. So there is real dev-time telemetry, gated so it cannot ship.

### Structured logging (`@weft/core`'s `logger`)
- One tiny logger in `core/src/log.ts` (added when first needed). Levels: `error | warn | info | debug | trace`. No third-party logging library.
- **Production build strips `debug` and `trace` at compile time** via a bundler define (`WEFT_LOG_LEVEL`); they cannot be re-enabled at runtime by a user or an attacker.
- Every log record is a plain object with: `ts`, `level`, `mod` (module name), `event` (short kebab code), and typed fields. Never free-text log messages with interpolated secrets.

### Log-content rules (enforced by review; violations are bugs, not style)
For every log line, ask "is this safe if a random developer sees it in a screenshot, and safe if the device is seized?" If not, it doesn't get logged.

**Never log:**
- Any secret key, ephemeral secret, decrypted embedding, plaintext handshake payload, decrypted identity payload, or plaintext of a redeem/reveal event.
- Contact pubkeys with associated interest data (linkage). Contact pubkeys alone with routing counts are borderline — use module `debug`, never `info`.
- The **origin** of any query, anywhere, ever. Not in logs, not in structs, not in debug prints, not in error messages. This is DD invariant 4 in code; see also `TESTING.md` Gate 1.
- Query embeddings in the clear. Log embeddings as their L2 norm and 4-byte fingerprint hash at most, and only under `trace`.
- User-typed text (ask utterances, display names, message bodies). Log lengths and whether present, not contents.

**OK to log:**
- Wire-shape summaries: kind number, event id (hex), size in bytes, expiration.
- Protocol counters (the same five above) as `info` deltas.
- State-machine transitions with the state names (`idle → pinged`, no payloads).
- Error causes at the type level (`"NIP-44 decrypt failed"`, no ciphertext).
- Fake-clock timestamps in tests.

### Dev-time tooling (does not ship)
Under `weft/packages/sim/` and marked with a top-of-file `// DEV ONLY — must not be imported by @weft/pwa or @weft/porch`:
- **Event tracer:** subscribes to MockRelay and prints a live protocol trace (kind, direction, size, event id). Sim-only.
- **Sketch inspector:** given a `MemoryStore`, prints each contact's centroid summary (top-3 nearest words if StubEmbedder, dim norms if MiniLM). Sim-only.
- **Handshake ladder:** ASCII diagram of a handshake's stages across nodes. Sim-only.

These are convenient during M5 and useless in production. A CI check (added in M6) asserts that none of these files are reachable from the PWA or porch bundle graphs.

### `console.log` policy
No `console.log` in shipped code. Ever. Use the logger. Grep for `console\.(log|debug|info|warn|error)` in a pre-commit lint (M6). The exception is a top-level uncaught-exception handler in `pwa/` and `porch/` that prints a single line so a crash isn't silent.

---

## User-facing observability (UX §15's "What leaves this phone")

The "Why It Works This Way" screen (UX §15, build-list M6-T4) is where the user sees observability. In v0 that screen shows:
- The five local counters, live.
- The caption *"no topics, no names, no places, no graph."*
- The sentence *"these numbers never leave this phone"* (verbatim).

When beacons ship (v2), that screen will additionally show the exact outbound beacon JSON — that's the *trust move* (DD §10.2): radical legibility beats a privacy policy. But that is a v2 UI change accompanying a v2 protocol change; in v0 there is nothing outbound to show.

---

## Adding a new metric or log field

Every proposal follows this checklist. Fable and the human designer both sign off; the CHANGELOG entry names them.

1. **Red-team test.** *Could this signal, alone or joined with any other logged/emitted signal, deanonymize a person or reveal an interest?* If plausibly yes, redesign or discard.
2. **Bucketing and noise.** Any signal that survives red-teaming and *is* published to more than one party ships bucketed (coarse counts) and noised (calibrated randomized response), per DD §10.2. Publishing a raw count is a wire-format regression.
3. **k-anonymity floor.** For per-interest or per-cell metrics, emit nothing when the population below the metric is smaller than k (initial k = 20, per DD §10.2's spirit — tune per metric with Fable's review). Rare things are identifying by existence.
4. **Documented in `OBSERVABILITY.md`.** The new signal appears in this file, with its definition, retention, and the red-team notes. If it isn't documented here, it isn't shipped.
5. **User-visible in UX §15.** Any signal that leaves the device is shown to the user verbatim, as-emitted, in the "What leaves this phone" screen.

Silent additions are treated as security incidents (see `SECURITY.md` § *Incident response*).

---

## Alarm conditions (planned, not built)

DD §10.5's alarm table names six health signals (rising dead-query ratio, hop inflation, falling handshake completion, etc.). In v0 these are computable from the local counters but not visualized beyond the "What leaves" screen. The alarm-condition dashboard is a v2 artifact tied to the beacon layer — this document flags it here so future phases know where it lands.

---

## Sentinel pairs (v2)

DD §10.3's sentinel/cover-traffic scheme is the mechanism that gets *active* end-to-end measurement without exposing real queries — synthetic queries between consenting volunteer nodes that also serve as chaff. Not built in v0. When it lands, it gets its own section here and a full red-team review, because sentinels *are* traffic and traffic patterns are the subtlest leak.

---

## Anti-patterns (banned, no exceptions)

- **Analytics SDKs of any kind** in `pwa/` or `porch/`. No Google Analytics, no Sentry, no PostHog, no Mixpanel, no Amplitude, no Datadog RUM. If a stack trace needs to leave a device for debugging, it does so through a *user-initiated* export (a "share diagnostic" button that shows the payload first, then hands it to the OS share sheet), never automatically.
- **Automatic crash reporting.** Same reason: automatic means the user did not choose.
- **Server-side logs of ciphertext relayed by our own infrastructure.** We do not run relays as part of the product; the reference public relays we test against are third-party. If we later run a foundation relay, its logs follow DD §10.4 exactly (public metrics about the *relay*, never about traffic).
- **Correlated identifiers across sessions.** No device ID, no install ID, no anonymous-analytics ID. The pubkey is enough where it's needed; nothing else is added.
- **"Just for debugging" toggles that ship.** If it's for debugging, strip it in the production bundle. Test that it's stripped.

---

## Review

Fable reviews this document at every phase boundary against the actual code that ships. The review question is always the same: *does what we ship match what this file says?* If not, either the code changes or this file changes — and the CHANGELOG records which.
