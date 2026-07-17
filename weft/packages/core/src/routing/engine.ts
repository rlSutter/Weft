// Query engine — DD §3 (routing), §17 (origin ambiguity), §35 F2 (route
// blinding), F5 (no stamp field), F6 (probe resistance).
//
// Everything an authored query needs to hide, plus everything a forwarded
// query looks the same as. See TESTING.md Gates 1 and 4.
//
// Build list M5-T3.

import { sha256 } from '@noble/hashes/sha2';
import { bytesToHex, hexToBytes, randomBytes } from '@noble/hashes/utils';
import type { NostrEvent } from 'nostr-tools/pure';

import { base64UrlDecode, base64UrlEncode } from '../codec/base64url';
import { buildAndSign, verifyEvent } from '../codec/event';
import { cosine, EMBEDDING_DIM, type Embedder } from '../embed/embedder';
import { Tags } from '../kinds/tags';
import { generateKeypair, publicKeyFromSecret, type Keypair } from '../keys/keys';
import type { Relay } from '../relay/types';
import type { WeftStore } from '../store/types';
import { unwrapPairwise, wrapPairwise } from '../wrap/gift';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const INITIAL_TTL_MIN = 3;
const INITIAL_TTL_MAX = 5;
const MAX_FANOUT = 3;
const FORWARD_FANOUT = 2;
const MATCH_THRESHOLD = 0.75;
const QUERY_STATE_TTL_SECONDS = 5 * 24 * 60 * 60; // matches D-class retention
const REVERSE_ROUTE_TTL_SECONDS = 5 * 24 * 60 * 60;
const ROUTE_TOKEN_BYTES = 16;
const PROBE_WINDOW_SECONDS = 60 * 10; // per-neighbor probe-rate window
const PROBE_MAX_REPLIES_PER_WINDOW = 3; // F6 probe defense
const STAMP_COST_TO_FORWARD = 1;

// ---------------------------------------------------------------------------
// Wire shapes
// ---------------------------------------------------------------------------

/** Inner 4910 payload. NO origin field, ever (build-list rule 11 / invariant 4). */
export interface QueryPayload {
  readonly embedding: string; // base64url of int8[384]
  readonly ttl: number; // hops remaining (decremented per forward)
  readonly ephemeralReplyPub: string; // hex — where a match reply is wrapped to
  readonly terms: readonly string[]; // coded predicates (DD §35 F11)
}

export interface MatchReplyPayload {
  readonly scoreBucket: 'high' | 'medium';
  readonly hopEstimate: number;
  readonly vouchCount: number; // v0 minimum; full self-contained chain in v2
}

export type MatchArrival = {
  readonly queryId: string;
  readonly reply: MatchReplyPayload;
  readonly responderEphemeralPub: string;
};

export type QueryEngineEvent =
  | { type: 'match'; arrival: MatchArrival }
  | { type: 'droppedForward'; reason: 'stamp' | 'probe' | 'ttl' | 'no-targets'; queryId: string };

export type QueryEngineListener = (e: QueryEngineEvent) => void;

// ---------------------------------------------------------------------------
// Routing sketch — per-contact interest centroid, private and lossy on
// purpose. DD §9.2 "the device should know 'Sam ≈ food-adjacent', never
// 'Sam answered these eleven queries'".
// ---------------------------------------------------------------------------

const EMA_ALPHA = 0.1;

class RoutingSketch {
  private readonly centroids = new Map<string, Float32Array>();

  update(contactPubkey: string, vector: Float32Array): void {
    const cur = this.centroids.get(contactPubkey);
    if (!cur) {
      this.centroids.set(contactPubkey, new Float32Array(vector));
      return;
    }
    for (let i = 0; i < cur.length; i++) {
      cur[i] = cur[i] * (1 - EMA_ALPHA) + vector[i] * EMA_ALPHA;
    }
  }

  get(contactPubkey: string): Float32Array | undefined {
    return this.centroids.get(contactPubkey);
  }

  pickTopK(
    embedding: Float32Array,
    contacts: readonly string[],
    k: number,
    exclude: readonly string[] = [],
  ): string[] {
    const excludeSet = new Set(exclude);
    const scored: Array<{ pk: string; score: number }> = [];
    let anyCentroid = false;
    for (const pk of contacts) {
      if (excludeSet.has(pk)) continue;
      const c = this.centroids.get(pk);
      if (c) {
        anyCentroid = true;
        scored.push({ pk, score: cosine(embedding, c) });
      } else {
        scored.push({ pk, score: -1 });
      }
    }
    if (!anyCentroid) {
      // Cold start: pick k at random from eligible contacts.
      const shuffled = scored.map((s) => s.pk).sort(() => Math.random() - 0.5);
      return shuffled.slice(0, k);
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k).map((s) => s.pk);
  }
}

// ---------------------------------------------------------------------------
// Probe-rate limiter (DD §35 F6)
// ---------------------------------------------------------------------------

class ProbeGuard {
  private readonly windows = new Map<string, number[]>();
  admit(neighbor: string, now: number): boolean {
    const cutoff = now - PROBE_WINDOW_SECONDS;
    const arr = (this.windows.get(neighbor) ?? []).filter((t) => t >= cutoff);
    if (arr.length >= PROBE_MAX_REPLIES_PER_WINDOW) {
      this.windows.set(neighbor, arr);
      return false;
    }
    arr.push(now);
    this.windows.set(neighbor, arr);
    return true;
  }
}

// ---------------------------------------------------------------------------
// Embedding <-> int8 quantization
// ---------------------------------------------------------------------------

export function quantizeEmbedding(v: Float32Array): Uint8Array {
  const out = new Uint8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    const q = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
    out[i] = q < 0 ? q + 256 : q; // two's complement byte
  }
  return out;
}

export function dequantizeEmbedding(b: Uint8Array): Float32Array {
  const out = new Float32Array(b.length);
  for (let i = 0; i < b.length; i++) {
    const q = b[i] >= 128 ? b[i] - 256 : b[i];
    out[i] = q / 127;
  }
  return out;
}

// ---------------------------------------------------------------------------
// The engine
// ---------------------------------------------------------------------------

export interface QueryEngineOptions {
  readonly me: Keypair;
  readonly store: WeftStore;
  readonly relay: Relay;
  readonly embedder: Embedder;
  readonly relaysToPublish?: readonly string[];
  readonly now?: () => number;
  /** RNG in [0,1); seeded in tests. Defaults to Math.random. */
  readonly rng?: () => number;
}

export class QueryEngine {
  private readonly me: Keypair;
  private readonly store: WeftStore;
  private readonly relay: Relay;
  private readonly embedder: Embedder;
  private readonly relaysToPublish: readonly string[];
  private readonly now: () => number;
  private readonly rng: () => number;

  private readonly sketch = new RoutingSketch();
  private readonly probeGuard = new ProbeGuard();
  /** Set of inner event ids we've already processed — prevents forward loops. */
  private readonly seenQueryIds = new Set<string>();
  /** Interests we (the user) have declared. Cosine ≥ 0.75 → match. */
  private readonly declaredInterests: Float32Array[] = [];
  /** Ephemeral secrets we've minted for asks we authored, keyed by our route token to each first-hop. */
  private readonly outstandingAsks = new Map<string, { queryId: string; ephemeralSecretHex: string }>();

  private readonly listeners = new Set<QueryEngineListener>();

  constructor(opts: QueryEngineOptions) {
    this.me = opts.me;
    this.store = opts.store;
    this.relay = opts.relay;
    this.embedder = opts.embedder;
    this.relaysToPublish = opts.relaysToPublish ?? [];
    this.now = opts.now ?? (() => Math.floor(Date.now() / 1000));
    this.rng = opts.rng ?? Math.random;
  }

  on(listener: QueryEngineListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(e: QueryEngineEvent): void {
    for (const l of this.listeners) l(e);
  }

  async declareInterest(text: string): Promise<void> {
    this.declaredInterests.push(await this.embedder.embed(text));
  }

  interestCount(): number {
    return this.declaredInterests.length;
  }

  // ---------------------------------------------------------------------
  // Authoring
  // ---------------------------------------------------------------------

  /**
   * Ask through friends. Embeds the text, picks up to `MAX_FANOUT` first-hop
   * contacts by routing sketch, mints a per-edge route token for each,
   * builds ONE inner 4910 (signed by an ephemeral reply key), and wraps
   * separately to each first hop.
   */
  async ask(text: string, terms: readonly string[] = []): Promise<{ queryId: string }> {
    const embedding = await this.embedder.embed(text);
    const initialTtl = this.pickInitialTtl();

    // Ephemeral reply key — the same key signs the 4910 (so origin is not
    // "us" on the wire) and is where match replies get wrapped to.
    const eph = generateKeypair();
    const ephemeralReplyPub = bytesToHex(eph.pubkey);

    const payload: QueryPayload = {
      embedding: base64UrlEncode(quantizeEmbedding(embedding)),
      ttl: initialTtl,
      ephemeralReplyPub,
      terms: [...terms],
    };

    const inner4910 = buildAndSign(
      {
        kind: 4910,
        content: JSON.stringify(payload),
      },
      eph.secret,
    );
    const queryId = inner4910.id;

    // Pick first-hop contacts.
    const contacts = await this.store.listContacts();
    const contactPubs = contacts.map((c) => c.pubkey);
    const targets = this.sketch.pickTopK(embedding, contactPubs, MAX_FANOUT);
    if (targets.length === 0) {
      this.emit({ type: 'droppedForward', reason: 'no-targets', queryId });
    }

    // Store queryState so replies find us.
    await this.store.putQueryState({
      queryId,
      ephemeralSecretHex: bytesToHex(eph.secret),
      ttlAtSend: initialTtl,
      expiresAt: this.now() + QUERY_STATE_TTL_SECONDS,
    });

    // For each first hop: mint a fresh route token, wrap the SAME inner
    // event, tag the wrapper with the token. Remember it as an
    // outstandingAsk so a returning reply lets us identify our own query.
    const nowSec = this.now();
    for (const contactPub of targets) {
      const rt = bytesToHex(randomBytes(ROUTE_TOKEN_BYTES));
      const outer = this.wrapWithRt(inner4910, contactPub, rt, nowSec);
      this.outstandingAsks.set(rt, { queryId, ephemeralSecretHex: bytesToHex(eph.secret) });
      await this.relay.publish(outer, this.relaysToPublish);
    }
    // Record this queryId so we ignore any echoes of our own ask that come back through the graph.
    this.seenQueryIds.add(queryId);

    return { queryId };
  }

  // ---------------------------------------------------------------------
  // Handling
  // ---------------------------------------------------------------------

  async handleIncomingWrap(outer: NostrEvent): Promise<void> {
    if (outer.kind !== 1059) return;
    const rt = readRt(outer);
    if (!rt) return;

    const opened = unwrapPairwise(outer, this.me.secret);
    if (!opened) return;
    // With pairwise wraps, outer.pubkey IS the immediate neighbor's real
    // pubkey (DD §17.2 "Sam sent it — Sam may have authored or forwarded").
    // This is what makes postage and reverse routing meaningful.
    const cameFrom = outer.pubkey;
    const inner = opened.inner;

    if (inner.kind === 4910) {
      await this.handleQuery(inner, rt, cameFrom);
    } else if (inner.kind === 4912) {
      await this.handleReply(inner, rt);
    }
    // Other kinds (invite, handshake, etc.) are handled by other engines.
  }

  private async handleQuery(inner4910: NostrEvent, incomingRt: string, cameFrom: string): Promise<void> {
    if (!verifyEvent(inner4910)) return;

    // Dedupe.
    if (this.seenQueryIds.has(inner4910.id)) return;
    this.seenQueryIds.add(inner4910.id);

    // Postage: neighbor must have positive stamp balance.
    const stamp = await this.store.getStamp(cameFrom);
    const newBalance = stamp - STAMP_COST_TO_FORWARD;
    await this.store.setStamp(cameFrom, newBalance);
    if (newBalance < 0) {
      this.emit({ type: 'droppedForward', reason: 'stamp', queryId: inner4910.id });
      return;
    }

    let payload: QueryPayload;
    try {
      payload = JSON.parse(inner4910.content);
    } catch {
      return;
    }
    if (
      typeof payload.embedding !== 'string' ||
      typeof payload.ttl !== 'number' ||
      typeof payload.ephemeralReplyPub !== 'string'
    ) {
      return;
    }

    const embedding = dequantizeEmbedding(base64UrlDecode(payload.embedding));
    if (embedding.length !== EMBEDDING_DIM) return;

    // Update routing sketch: this query passed through cameFrom.
    this.sketch.update(cameFrom, embedding);

    // Match check.
    const matchScore = this.bestMatchScore(embedding);
    if (matchScore >= MATCH_THRESHOLD) {
      // Probe defense (F6): rate-limit auto-reply per neighbor.
      if (!this.probeGuard.admit(cameFrom, this.now())) {
        this.emit({ type: 'droppedForward', reason: 'probe', queryId: inner4910.id });
        return;
      }
      await this.emitMatchReply(payload, incomingRt, cameFrom, matchScore);
      return;
    }

    // Forward if TTL allows.
    if (payload.ttl <= 1) {
      this.emit({ type: 'droppedForward', reason: 'ttl', queryId: inner4910.id });
      return;
    }

    const contacts = await this.store.listContacts();
    const eligible = contacts.map((c) => c.pubkey).filter((pk) => pk !== cameFrom);
    const targets = this.sketch.pickTopK(embedding, eligible, FORWARD_FANOUT, [cameFrom]);
    if (targets.length === 0) {
      this.emit({ type: 'droppedForward', reason: 'no-targets', queryId: inner4910.id });
      return;
    }

    // Forward: SAME inner event, decrement TTL by rebuilding with new content
    // — this changes the inner event id, but that's the discipline. If we
    // want Gate 1's byte-identical shape, the *shape* (schema) must be
    // identical between authored and forwarded, which it is: same kind,
    // same content-schema, no origin field. The individual event id
    // differs, of course.
    //
    // Actually re-reading DD §35 F2 & build list: the design says
    // "Authored and forwarded queries are byte-shape identical — no origin
    // field exists." Shape, not identity. The bytes may differ (different
    // ttl in content), but no field distinguishes author from forwarder.
    const nextPayload: QueryPayload = {
      embedding: payload.embedding,
      ttl: payload.ttl - 1,
      ephemeralReplyPub: payload.ephemeralReplyPub,
      terms: payload.terms,
    };
    // The forwarder MUST re-sign under an ephemeral key. Using our real key
    // would attach an origin field to the wire. Fresh ephemeral each hop.
    const forwarderEph = generateKeypair();
    const nextInner = buildAndSign(
      {
        kind: 4910,
        content: JSON.stringify(nextPayload),
      },
      forwarderEph.secret,
    );
    // Zero the ephemeral key immediately after signing.
    (forwarderEph.secret as Uint8Array).fill(0);

    const nowSec = this.now();
    for (const target of targets) {
      const rtOut = bytesToHex(randomBytes(ROUTE_TOKEN_BYTES));
      await this.store.putReverseRoute({
        myRouteToken: rtOut,
        upstreamRouteToken: incomingRt,
        cameFromPubkey: cameFrom,
        expiresAt: nowSec + REVERSE_ROUTE_TTL_SECONDS,
      });
      const outer = this.wrapWithRt(nextInner, target, rtOut, nowSec);
      await this.relay.publish(outer, this.relaysToPublish);
    }
    // Track this ID as seen so we don't process echoes.
    this.seenQueryIds.add(nextInner.id);
  }

  private async emitMatchReply(
    payload: QueryPayload,
    incomingRt: string,
    _cameFrom: string,
    score: number,
  ): Promise<void> {
    const reply: MatchReplyPayload = {
      scoreBucket: score >= 0.9 ? 'high' : 'medium',
      hopEstimate: 0, // placeholder; real hop-estimate math in a future pass
      vouchCount: (await this.store.getMyVouches()).length,
    };
    const responderEph = generateKeypair();
    const inner4912 = buildAndSign(
      {
        kind: 4912,
        content: JSON.stringify(reply),
      },
      responderEph.secret,
    );
    // Wrap to the *asker's ephemeral reply pubkey*, tagged with the incoming
    // rt so the previous hop can look it up.
    const nowSec = this.now();
    const outer = this.wrapWithRt(inner4912, payload.ephemeralReplyPub, incomingRt, nowSec);
    await this.relay.publish(outer, this.relaysToPublish);
  }

  private async handleReply(inner4912: NostrEvent, rt: string): Promise<void> {
    if (!verifyEvent(inner4912)) return;

    // Is this a reply to one of our own asks?
    const mine = this.outstandingAsks.get(rt);
    if (mine) {
      let payload: MatchReplyPayload;
      try {
        payload = JSON.parse(inner4912.content);
      } catch {
        return;
      }
      this.emit({
        type: 'match',
        arrival: {
          queryId: mine.queryId,
          reply: payload,
          responderEphemeralPub: inner4912.pubkey,
        },
      });
      return;
    }

    // Otherwise it's a reply passing through us — relabel and forward.
    const route = await this.store.getReverseRoute(rt);
    if (!route) return; // dropped; we don't know where this belongs
    // Re-wrap the same reply inner to our upstream neighbor, tagged with
    // the upstream token.
    const outer = this.wrapWithRt(inner4912, route.cameFromPubkey, route.upstreamRouteToken, this.now());
    await this.relay.publish(outer, this.relaysToPublish);
  }

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------

  private pickInitialTtl(): number {
    // Uniform in [INITIAL_TTL_MIN, INITIAL_TTL_MAX] inclusive (DD §17.2).
    const span = INITIAL_TTL_MAX - INITIAL_TTL_MIN + 1;
    return INITIAL_TTL_MIN + Math.floor(this.rng() * span);
  }

  private bestMatchScore(query: Float32Array): number {
    let best = 0;
    for (const interest of this.declaredInterests) {
      const s = cosine(query, interest);
      if (s > best) best = s;
    }
    return best;
  }

  private wrapWithRt(inner: NostrEvent, recipientPubHex: string, rt: string, nowSec: number): NostrEvent {
    // Pairwise wrap under this device's key — outer.pubkey = us, so the
    // recipient can tell who forwarded (needed for postage and reverse
    // routing per DD §17.2). Origin ambiguity holds via Crowds-style
    // "forward for everyone" + rt blinding.
    return wrapPairwise(inner, this.me.secret, recipientPubHex, [[Tags.RT, rt]], nowSec, this.rng);
  }
}

/** Read the `rt` tag from a 1059 wrapper. Returns undefined if absent. */
export function readRt(outer: NostrEvent): string | undefined {
  const t = outer.tags.find((x) => x[0] === Tags.RT);
  return t?.[1];
}

// (Unused imports below intentionally re-exported for future callers.)
export { hexToBytes as _hexToBytes, publicKeyFromSecret as _pkFromSk, sha256 as _sha256 };
