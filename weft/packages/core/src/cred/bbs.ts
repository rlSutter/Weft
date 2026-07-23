// Typed re-exports of @digitalbazaar/bbs-signatures.
//
// The upstream package ships plain ESM .js files with no type declarations,
// so a raw import elsewhere in the workspace produces a TS7016 error under
// strict mode. This file is the single point where we cross that boundary:
// we `@ts-ignore` the two untyped imports, add explicit types derived from
// reading the library's algorithm docs, and re-export.
//
// Result: cred.ts (and any future consumer) imports from './bbs' with full
// types, and downstream packages that transitively depend on @weft/core do
// not need their own ambient shim.
//
// The library is BSD-3, ~3200 lines of IETF BBS-draft-06 aligned crypto over
// @noble/curves BLS12-381. We consume it via the rlSutter/bbs-signatures
// fork (upstream PR digitalbazaar/bbs-signatures#22 pending) — the fork
// adds `./blind` and `./pseudonym` subpath exports.

// Base API — key generation only; blind operations live in the /blind subpath.
// The library ships no .d.ts files, so TypeScript treats these as `any`. We
// isolate that widening to this file only; every other module in the workspace
// sees the typed re-exports below.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @digitalbazaar/bbs-signatures ships no .d.ts (TS7016).
import { CIPHERSUITES as RAW_CIPHERSUITES, generateKeyPair as rawGenerateKeyPair } from '@digitalbazaar/bbs-signatures';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @digitalbazaar/bbs-signatures/blind ships no .d.ts (TS7016).
import { Commit as rawCommit, BlindSign as rawBlindSign, BlindVerify as rawBlindVerify, BlindProofGen as rawBlindProofGen, BlindProofVerify as rawBlindProofVerify } from '@digitalbazaar/bbs-signatures/blind';

// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — @digitalbazaar/bbs-signatures/pseudonym ships no .d.ts (TS7016).
import { NymCommit as rawNymCommit, BlindSignWithNym as rawBlindSignWithNym, BlindVerifyWithNym as rawBlindVerifyWithNym, ProofGenWithPseudonym as rawProofGenWithPseudonym, ProofVerifyWithPseudonym as rawProofVerifyWithPseudonym } from '@digitalbazaar/bbs-signatures/pseudonym';

// ---------------------------------------------------------------------------
// Type shapes — narrower than reality by design; only expose what cred.ts uses
// ---------------------------------------------------------------------------

export interface CiphersuiteConstants {
  readonly BLS12381_SHAKE256: string;
  readonly BLS12381_SHA256: string;
}

export interface KeyPair {
  secretKey: Uint8Array;
  publicKey: Uint8Array;
}

export interface CommitmentAndBlind {
  commitment_with_proof: Uint8Array;
  secret_prover_blind: bigint;
}

// ---------------------------------------------------------------------------
// Typed re-exports
// ---------------------------------------------------------------------------

 
export const CIPHERSUITES: CiphersuiteConstants = RAW_CIPHERSUITES;

 
export const generateKeyPair: (opts: { ciphersuite: string }) => Promise<KeyPair> = rawGenerateKeyPair;

 
export const Commit: (opts: {
  committed_messages: Uint8Array[];
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<CommitmentAndBlind> = rawCommit;

 
export const BlindSign: (opts: {
  SK: bigint;
  PK: Uint8Array;
  commitment_with_proof?: Uint8Array;
  header?: Uint8Array;
  messages?: Uint8Array[];
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<Uint8Array> = rawBlindSign;

 
export const BlindVerify: (opts: {
  PK: Uint8Array;
  signature: Uint8Array;
  header: Uint8Array;
  messages: Uint8Array[];
  committed_messages: Uint8Array[];
  secret_prover_blind?: bigint;
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<boolean> = rawBlindVerify;

 
export const BlindProofGen: (opts: {
  PK: Uint8Array;
  signature: Uint8Array;
  header?: Uint8Array;
  ph?: Uint8Array;
  messages?: Uint8Array[];
  disclosed_indexes?: number[];
  committed_messages?: Uint8Array[];
  disclosed_committed_indexes?: number[];
  secret_prover_blind?: bigint;
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<Uint8Array> = rawBlindProofGen;

 
export const BlindProofVerify: (opts: {
  PK: Uint8Array;
  proof: Uint8Array;
  header?: Uint8Array;
  ph?: Uint8Array;
  L?: number;
  disclosed_messages: Uint8Array[];
  disclosed_committed_messages: Uint8Array[];
  disclosed_indexes: number[];
  disclosed_committed_indexes: number[];
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<boolean> = rawBlindProofVerify;

// ---------------------------------------------------------------------------
// Pseudonym-BBS surface (M9-T3)
// ---------------------------------------------------------------------------

export const NymCommit: (opts: {
  prover_nym: bigint;
  committed_messages?: Uint8Array[];
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<CommitmentAndBlind> = rawNymCommit;

export const BlindSignWithNym: (opts: {
  SK: bigint;
  PK: Uint8Array;
  commitment_with_proof?: Uint8Array;
  header?: Uint8Array;
  messages?: Uint8Array[];
  signer_nym_entropy: bigint;
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<Uint8Array> = rawBlindSignWithNym;

/**
 * Verifies a pseudonym-capable credential signature AND returns the combined
 * `nym_secret` (the k_cred from Weft's perspective) that the holder must
 * store to later derive per-scope pseudonyms.
 */
export const BlindVerifyWithNym: (opts: {
  PK: Uint8Array;
  signature: Uint8Array;
  header: Uint8Array;
  messages: Uint8Array[];
  committed_messages: Uint8Array[];
  prover_nym: bigint;
  signer_nym_entropy: bigint;
  secret_prover_blind?: bigint;
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<{ verified: boolean; nym_secret: bigint }> = rawBlindVerifyWithNym;

/**
 * Produce a scope-bound ZK presentation. `context_id` (a.k.a. Weft
 * `scope_id`) determines the derived `pseudonym` — same credential + same
 * context = same pseudonym; different context = unlinkable pseudonym.
 */
export const ProofGenWithPseudonym: (opts: {
  PK: Uint8Array;
  signature: Uint8Array;
  header?: Uint8Array;
  ph?: Uint8Array;
  nym_secret: bigint;
  context_id: Uint8Array;
  messages?: Uint8Array[];
  disclosed_indexes?: number[];
  committed_messages?: Uint8Array[];
  disclosed_committed_indexes?: number[];
  secret_prover_blind?: bigint;
  api_id?: Uint8Array;
  ciphersuite: string;
}) => Promise<{ proof: Uint8Array; pseudonym: Uint8Array }> = rawProofGenWithPseudonym;

export const ProofVerifyWithPseudonym: (opts: {
  PK: Uint8Array;
  proof: Uint8Array;
  header?: Uint8Array;
  ph?: Uint8Array;
  pseudonym: Uint8Array;
  context_id: Uint8Array;
  L?: number;
  disclosed_messages: Uint8Array[];
  disclosed_committed_messages: Uint8Array[];
  disclosed_indexes: number[];
  disclosed_committed_indexes: number[];
  api_id?: Uint8Array;
  ciphersuite: string;
}) => boolean = rawProofVerifyWithPseudonym;
