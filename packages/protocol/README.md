# `@p2pflow/protocol`

This package is the single typed protocol boundary for P2PFlow. Version
`0.1.0-local.2` deliberately contains a deterministic **local/test fixture**
generated from the pre-v2 facets. It is not a Base Sepolia deployment record
and is rejected for shared or production runtime modes.

Phase 4 will replace the fixture ABI and manifest input with the compiled v2
facets and a safe deployment pipeline. Until then, consumers may use the
fixture for builds, unit tests, compatibility checks, prepared-call shapes and
receipt decoding only.

All amounts and prices are integer E6 `bigint` values. The package never uses
JavaScript floating-point arithmetic for protocol calculations.
