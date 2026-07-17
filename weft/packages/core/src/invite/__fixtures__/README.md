# Invite-token fixture v1

`token-v1.hex` is the wire-format compatibility test for the invite token
(DD §30.2, build-list M1-T3).

## What it is

The exact CBOR bytes produced by encoding the token with these fixed inputs:

| Field | Value |
|---|---|
| `secret`   | 32 bytes, all `0x01` |
| `auxRand`  | 32 bytes, all `0x00` (deterministic BIP-340 signature) |
| `ver`      | 1 |
| `iid`      | 16 bytes, all `0xaa` |
| `inv`      | derived from `secret` |
| `vtpl`     | `{ tier: 2, ctx: "personal", vexp: 90 }` |
| `exp`      | `1_800_000_000` |
| `flags`    | `3` (single_use \| confirm_required) |
| `relays`   | `["wss://relay.example/1", "wss://relay.example/2"]` |
| `chp`      | 32 bytes, all `0xcc` |

Generator: `packages/core/scripts/generate-invite-fixture.mts`.

## Why it's a *forever* compatibility test

If this file ever needs to change, the invite wire format changed with it.
That is not a bug fix; it is a `Wire` entry in CHANGELOG.md and a
version bump under the phase model.

Concretely, this fixture protects against:

- **cbor-x behavior drift** on upgrade (map key ordering, integer encoding,
  byte-string tagging).
- **Silent option changes** in this repo's encoder configuration.
- **noble/curves changes to BIP-340** (the signature bytes are part of the
  fixture; any change to how noble signs would show up here).
- **Anyone reordering the `InviteTokenBody` fields** in a way that changes
  the CBOR insertion order and therefore the bytes.

The test in `../__tests__/token.test.ts` loads this hex, decodes it,
verifies every field matches the table above, and separately encodes the
same inputs and asserts the bytes match the fixture — closing the loop
in both directions.

## Re-generating (do not do this except under a wire-format bump)

```
cd packages/core
npx tsx scripts/generate-invite-fixture.mts > src/invite/__fixtures__/token-v1.hex
```
