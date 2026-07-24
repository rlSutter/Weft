import { describe, it, expect } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import {
  buildCharterEvent,
  parseCharterEvent,
  signCharterPayload,
  verifyAmendmentChain,
  cellId,
  canonicalCharterHash,
  CHARTER_WIRE_VERSION,
  type Charter,
  type CharterPayload,
  type SignatureEntry,
} from '../charter';
import { generateKeypair } from '../../keys/keys';
import type { NostrEvent } from 'nostr-tools/pure';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Steward {
  secret: Uint8Array;
  pubkey: Uint8Array;
  hex: string;
}

function makeStewards(n: number): Steward[] {
  return Array.from({ length: n }, () => {
    const kp = generateKeypair();
    return { secret: kp.secret, pubkey: kp.pubkey, hex: bytesToHex(kp.pubkey) };
  });
}

function basePayload(stewards: Steward[], prev: string | null, overrides: Partial<CharterPayload> = {}): CharterPayload {
  return {
    v: CHARTER_WIRE_VERSION,
    title: 'Koji Fermentation Circle',
    steward_pubkeys: stewards.map((s) => s.hex),
    amendment_rule: { m: 2, n: stewards.length },
    ejection_procedure: { m: 2, n: stewards.length },
    embedding_model: 'MiniLM-L6-v2',
    media_policy: 'text-only',
    credential_constants: { k_show: 3, epoch_length_days: 91 },
    issuer_bbs_pubkey: '00'.repeat(96),
    house_rules: ['Ask before sharing outside', 'No selling'],
    prev,
    ...overrides,
  };
}

function makeGenesis(stewards: Steward[]): { event: NostrEvent; charter: Charter } {
  const payload = basePayload(stewards, null);
  // Genesis needs no `sigs` (the outer event signature by any steward is
  // sufficient — genesis defines the initial steward set). But we can
  // include them harmlessly, and the verifier treats an empty sigs on
  // genesis as valid.
  const charter: Charter = { payload, sigs: [] };
  const event = buildCharterEvent(charter, stewards[0]!.secret);
  return { event, charter };
}

function makeAmendment(
  stewards: Steward[],
  approvers: Steward[],
  prevEvent: NostrEvent,
  publisher: Steward,
  overrides: Partial<CharterPayload> = {},
): { event: NostrEvent; charter: Charter } {
  const payload = basePayload(stewards, prevEvent.id, overrides);
  const sigs: SignatureEntry[] = approvers.map((s) =>
    signCharterPayload(payload, s.secret, s.pubkey),
  );
  const charter: Charter = { payload, sigs };
  const event = buildCharterEvent(charter, publisher.secret);
  return { event, charter };
}

// ---------------------------------------------------------------------------
// M10-T1 acceptance
// ---------------------------------------------------------------------------

describe('charter / M10-T1 acceptance', () => {
  it('parses a genesis charter event', () => {
    const stewards = makeStewards(3);
    const { event } = makeGenesis(stewards);
    const parsed = parseCharterEvent(event);
    expect(parsed).not.toBeNull();
    expect(parsed!.payload.title).toBe('Koji Fermentation Circle');
    expect(parsed!.payload.steward_pubkeys).toHaveLength(3);
    expect(parsed!.payload.prev).toBeNull();
  });

  it('cell id equals the genesis event id', () => {
    const stewards = makeStewards(3);
    const { event } = makeGenesis(stewards);
    expect(cellId(event)).toBe(event.id);
  });

  it('rejects a genesis with a non-null prev', () => {
    const stewards = makeStewards(3);
    const payload = basePayload(stewards, 'ff'.repeat(32));
    const evt = buildCharterEvent({ payload, sigs: [] }, stewards[0]!.secret);
    // Single-charter chain — verify returns null because prev !== null on genesis.
    expect(verifyAmendmentChain([evt])).toBeNull();
  });

  it('accepts an amendment signed by exactly m of n stewards', () => {
    const stewards = makeStewards(3);
    const { event: gen } = makeGenesis(stewards);
    // Amendment: 2 of 3 stewards approve. Publisher is stewards[0], approvers
    // are stewards[0] and stewards[1]. Amendment changes a benign field.
    const { event: amend } = makeAmendment(
      stewards,
      [stewards[0]!, stewards[1]!],
      gen,
      stewards[0]!,
      { title: 'Renamed cell' },
    );
    const final = verifyAmendmentChain([gen, amend]);
    expect(final).not.toBeNull();
    expect(final!.payload.title).toBe('Renamed cell');
  });

  it('rejects an amendment signed by fewer than m stewards', () => {
    const stewards = makeStewards(3);
    const { event: gen } = makeGenesis(stewards);
    // Only 1 approver, but the rule requires 2.
    const { event: amend } = makeAmendment(
      stewards,
      [stewards[0]!],
      gen,
      stewards[0]!,
      { title: 'Renamed cell (below threshold)' },
    );
    expect(verifyAmendmentChain([gen, amend])).toBeNull();
  });

  it('rejects an amendment whose signer is NOT in the previous steward set', () => {
    const stewards = makeStewards(3);
    const outsider = makeStewards(1)[0]!;
    const { event: gen } = makeGenesis(stewards);
    const { event: amend } = makeAmendment(
      stewards,
      [stewards[0]!, outsider],
      gen,
      stewards[0]!,
      { title: 'Bogus' },
    );
    expect(verifyAmendmentChain([gen, amend])).toBeNull();
  });

  it('rejects an amendment whose signer duplicates within one amendment', () => {
    const stewards = makeStewards(3);
    const { event: gen } = makeGenesis(stewards);
    // Same steward signs twice — must not count as two.
    const { event: amend } = makeAmendment(
      stewards,
      [stewards[0]!, stewards[0]!],
      gen,
      stewards[0]!,
      { title: 'Fake m-of-n' },
    );
    expect(verifyAmendmentChain([gen, amend])).toBeNull();
  });

  it('rejects an amendment with a tampered signature', () => {
    const stewards = makeStewards(3);
    const { event: gen } = makeGenesis(stewards);
    const { event: amend } = makeAmendment(
      stewards,
      [stewards[0]!, stewards[1]!],
      gen,
      stewards[0]!,
    );
    // Tamper: parse, flip one byte of a signature, rebuild the event.
    const parsed = parseCharterEvent(amend)!;
    const badSig = Array.from(parsed.sigs);
    const s0 = badSig[0]!;
    const flipped = s0.sig.slice(0, 8) + (s0.sig[8] === 'a' ? 'b' : 'a') + s0.sig.slice(9);
    badSig[0] = { signer: s0.signer, sig: flipped };
    const rebuilt = buildCharterEvent(
      { payload: parsed.payload, sigs: badSig },
      stewards[0]!.secret,
    );
    expect(verifyAmendmentChain([gen, rebuilt])).toBeNull();
  });

  it('walks a two-amendment chain to the current charter', () => {
    const stewards = makeStewards(3);
    const { event: gen } = makeGenesis(stewards);
    const { event: amend1 } = makeAmendment(
      stewards,
      [stewards[0]!, stewards[1]!],
      gen,
      stewards[0]!,
      { title: 'First rename' },
    );
    const { event: amend2 } = makeAmendment(
      stewards,
      [stewards[1]!, stewards[2]!],
      amend1,
      stewards[1]!,
      { title: 'Second rename' },
    );
    const final = verifyAmendmentChain([gen, amend1, amend2]);
    expect(final).not.toBeNull();
    expect(final!.payload.title).toBe('Second rename');
  });

  it('rejects a broken prev link', () => {
    const stewards = makeStewards(3);
    const { event: gen } = makeGenesis(stewards);
    // Amendment points at a random hash, not gen.id.
    const { event: amend } = makeAmendment(
      stewards,
      [stewards[0]!, stewards[1]!],
      { ...gen, id: 'ff'.repeat(32) } as NostrEvent,
      stewards[0]!,
    );
    expect(verifyAmendmentChain([gen, amend])).toBeNull();
  });

  it('canonical hash is deterministic regardless of JSON key order', () => {
    const stewards = makeStewards(2);
    const payloadA = basePayload(stewards, null);
    // Different insertion order at the top level should not affect the hash.
    const payloadB: CharterPayload = {
      house_rules: payloadA.house_rules,
      prev: payloadA.prev,
      issuer_bbs_pubkey: payloadA.issuer_bbs_pubkey,
      credential_constants: payloadA.credential_constants,
      media_policy: payloadA.media_policy,
      embedding_model: payloadA.embedding_model,
      ejection_procedure: payloadA.ejection_procedure,
      amendment_rule: payloadA.amendment_rule,
      steward_pubkeys: payloadA.steward_pubkeys,
      title: payloadA.title,
      v: payloadA.v,
    };
    expect(Array.from(canonicalCharterHash(payloadA))).toEqual(
      Array.from(canonicalCharterHash(payloadB)),
    );
  });
});

// ---------------------------------------------------------------------------
// Sanity guardrails
// ---------------------------------------------------------------------------

describe('charter / structural sanity', () => {
  it('parseCharterEvent returns null on wrong kind', () => {
    const stewards = makeStewards(1);
    const { event } = makeGenesis(stewards);
    const wrongKind = { ...event, kind: 4999 } as NostrEvent;
    expect(parseCharterEvent(wrongKind)).toBeNull();
  });

  it('parseCharterEvent returns null on wire version mismatch', () => {
    const stewards = makeStewards(1);
    const payload = basePayload(stewards, null, { v: 999 });
    const event = buildCharterEvent({ payload, sigs: [] }, stewards[0]!.secret);
    expect(parseCharterEvent(event)).toBeNull();
  });

  it('verifyAmendmentChain returns null on empty chain', () => {
    expect(verifyAmendmentChain([])).toBeNull();
  });
});
