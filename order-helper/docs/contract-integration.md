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

## Public explorer observation

On 2026-07-29 UTC the Base Sepolia Blockscout API identified the architecture
target as an EIP-2535 Diamond with six facet addresses. The proxy, cut facet,
and ownership facet had partial verification metadata. Four application facet
addresses had no verified ABI. The proxy ABI contains only constructor,
fallback, and receive entries.

Public evidence:

- <https://base-sepolia.blockscout.com/address/0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A>
- <https://base-sepolia.blockscout.com/api/v2/addresses/0xF40AD901CCfB5E5EdC5162D6Ac7DDd5Ed5899F3A>

This is enough to confirm that code exists at the Diamond address, but not
enough to prove the application ABI, storage layout, assignment selector,
eligibility semantics, or a safe cut.

## Closed integration gates

Transaction sending and live readiness remain closed until all of the
following artifacts are reviewed together at a pinned Base Sepolia block:

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
