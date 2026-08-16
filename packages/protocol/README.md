# `@p2pflow/protocol`

`2.0.0-local.3` is the immutable canonical boundary for the privacy-safe v2
Diamond source. Package version, numeric on-chain protocol version (`2`), and
storage-layout version (`2`) are independent and validated independently.

The Base Sepolia fixture is deliberately **not deployed** and is available only
through the explicit `@p2pflow/protocol/test-fixture` subpath. Its fake addresses
and zero deployment proof exist only for deterministic local/unit tests. The
production package root neither imports nor exports it and accepts only a
reviewed `base-sepolia-deployment` manifest. Shared preflight rejects the fixture.

All USDC amounts, fiat amounts, and prices are integer E6 `bigint` values.
BUY conversion rounds upward and SELL conversion rounds downward, matching
the Solidity v2 implementation. Prepared calls validate names, arguments,
manifest digests, and ABI digests; receipt decoding accepts exactly one
canonical `OrderCreated` event from a successful manifest-Diamond receipt.

The executor, subgraph, and three UIs vendor the exact reproducible `local.3`
tarball. Coordinated verification rejects stale versions, byte drift, or a
production UI bundle containing the test-fixture marker.
