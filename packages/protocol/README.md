# `@p2pflow/protocol`

`2.0.0-local.2` is the immutable canonical boundary for the privacy-safe v2
Diamond source. Package version, numeric on-chain protocol version (`2`), and
storage-layout version (`2`) are independent and validated independently.

The bundled Base Sepolia fixture is deliberately **not deployed**. Its fake
addresses and zero deployment proof exist only for deterministic local/unit
tests. The manifest parser and preflight reject it in shared, Base Sepolia, or
production runtimes. A separately reviewed real deployment manifest must
replace it before any shared consumer can start.

All USDC amounts, fiat amounts, and prices are integer E6 `bigint` values.
BUY conversion rounds upward and SELL conversion rounds downward, matching
the Solidity v2 implementation. Prepared calls validate names, arguments,
manifest digests, and ABI digests; receipt decoding accepts exactly one
canonical `OrderCreated` event from a successful manifest-Diamond receipt.

Consumer applications still vendoring `0.1.0-local.2` are intentionally
incompatible until the Phase 5/6 coordinated revendor and runtime migration.
