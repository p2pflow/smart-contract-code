# Contract integration evidence

This service does not claim a working assignment contract integration.

## Repository evidence

- Worker baseline: `bef6955` on `codex-worker-helper-20260729`.
- The checked-in baseline has no `OrderFacet`, assignment facet, generated ABI,
  deployment manifest, or verified selector map.
- Local forensic ref `origin/dev` is `a6808ff`. It contains an ABI-correlated
  `OrderFacet` and a later `AppStorage`, but its checked-in Base Sepolia
  deployment manifest identifies Diamond
  `0xd4aD9FeC221FD2EC980E56104437D90b5635a973`.
- The architecture target is a different Diamond,
  `0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A` on chain `84532`.
  Therefore the `origin/dev` ABI cannot be treated as the target ABI.

## Pinned live-baseline observation

On 2026-07-29 UTC the Base Sepolia Blockscout API identified the architecture
target as an EIP-2535 Diamond with six facet addresses. The proxy, cut facet,
and ownership facet had partial verification metadata. Four application facet
addresses had no verified ABI. The proxy ABI contains only constructor,
fallback, and receive entries.

The current Council bill admits a read-only provenance workstream report (not
reproduced or bundled by this package) pinned at Base Sepolia block
`44,795,919` and reproduced all six live facet runtimes, including metadata,
from repository commit `aa6f802a9e233e9d9ed101b1d4a5209d25cc1d2a`
with Solidity `0.8.24+commit.e11b9ed9`, optimizer 200, and EVM Paris. Its
OP-aware fork reproduced 63 routed selectors and current reads. The exact
recovered `AppStorage` occupies roots 0 through 21; any proposed new top-level
root must start at 22. Treat those exact claims as Council-admitted external
evidence until their machine-readable manifest and commands are independently
attached to this package and rerun.

That baseline is still the legacy synchronous `OrderFacet`: it has no
`OrderHelperFacet`, exact-four helper assignment transaction, assignment
round, policy hash, authoritative helper eligibility view, or signer-rotation
interface. Later `origin/dev` commit `a6808ff` is not the live OrderFacet
generation. Therefore there is no deployed helper write ABI to integrate.

Public evidence:

- <https://base-sepolia.blockscout.com/address/0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A>
- <https://base-sepolia.blockscout.com/api/v2/addresses/0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A>

At block `44,795,931` (hash
`0x44c6326da3fa815bfa2516124e83cf8370b6a2f2ebbaa000b07ac4a0959c752b`),
the Council-admitted public snapshot contained 2 merchants, 2 channels, and 19
orders. It reconciled `588,000,000` USDC atoms of observed custody to merchant
liquidity liabilities with zero delta, zero reserved USDC, and zero open SELL
escrow. This is not bank evidence, ownership evidence, a cut-time snapshot, or
migration authority; both channels remain reconciliation-required.

The target-configured checked-in subgraph is also not usable as-is. Its
eight-field `OrderCreated` topic
`0xfc46abc20de537ef9bcee69c7bdd579a48747a658e430c99817e955675b63c37`
does not match the live seven-field topic
`0xa4987aaabfd00247972c458bbf7a5183bae686b39c2d77a1c70f9a84497d5dec`,
and it expects a 21-field `getOrder` result where the live target returns 20.
No hosted subgraph artifact identity was proven.

The pinned evidence is enough to constrain today's ABI and storage baseline.
It does not prove that the proposed append, accounting migration, assignment
facet, initializer, future selector cut, or indexer correction is safe or
deployed.

## Contract-specific subset of closed reconsideration gates

The bill's complete ordered 14 gates, followed by a new vote with no critical
objection, are mandatory. The following contract-specific subset is necessary
but not sufficient and is never transaction authorization. It must be reviewed
together at a pinned Base Sepolia block:

1. complete verified facet source and compiler settings;
2. loupe facet/selector inventory and ABI tuple definitions;
3. runtime-bytecode/source matches for every application facet;
4. exact storage-layout provenance and an append-only layout diff;
5. deployed and verified assignment interface;
6. contract/helper differential eligibility vectors;
7. published policy hash and council-authorized scope;
8. explicit canary approval and exercised pause/revoke/rotation runbooks.

The helper exposes interfaces and deterministic in-memory test doubles only.
It does not include a fabricated chain, subgraph, Redis, PostgreSQL, or KMS
connection.
