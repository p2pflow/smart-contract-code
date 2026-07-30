# Fairness and deterministic shadow simulation

## Authority boundary

The 2026-07-29 Council bill has verdict **REJECT**. This package therefore
produces transaction-disabled shadow traces only. It does not sign, broadcast,
reserve, assign, or authorize an order. Every exported trace contains:

```text
capability = TRANSACTION_DISABLED_SHADOW_ONLY
actionAuthorization = false
forecastOnly = true
```

Values in `explicitUnapprovedSimulationFixture()` are test fixtures. They are
not governance-approved policy or financial-risk parameters.

## Fairness unit and accepted-service ledger

The fairness unit is an opaque economic operator, not a wallet or channel.
Wallet rotation and multiple channels map to one `operatorId`; one
`failureDomainId` is also carried for readiness and correlated-failure checks.
The selector never gives extra weight to a split wallet.

Accepted service is updated only from a canonical acceptance:

```text
acceptedUsdc' = acceptedUsdc + U
ViQ'          = max(current ViQ, governed domainFloorQ) + 4*U
```

`Q` is an integer quarter scale, so the update has no floating-point input.
Acceptance identifiers live in a persistent immutable AVL index. Lookup and
insertion are `O(log N)`, duplicate acceptance is a no-op, conflicting reuse
fails, and branches structurally share the old root without mutating it.

Assignment computes only this audit forecast:

```text
baseQ            = max(ViQ, domainFloorQ)
offerLoadQ       = ceil(4 * openOfferUsdc * weightNumerator
                        / weightDenominator)
rankingFinishQ   = baseQ + offerLoadQ + 4*U
forecastFinishQ  = baseQ + 4*U
```

`forecastFinishQ` is never written into accepted service. This prevents the
documented concurrent `48m -> 40m` regression; accepting 12 and then 10 from
the same base ends at `88m` in either order and accepted service is 22.

## Offers, eligibility, and canonical universe

Open offers are exact slot records, separate from accepted service and hard
collateral. An offer opens once and releases once on acceptance, cancellation,
expiry, ineligibility, or canonical reorg replacement. An offer affects the
configured ranking heuristic but never proves acceptance capacity.

The caller must provide complete pagination at one finalized block number and
hash. The selector:

1. merges identical duplicate page rows and rejects conflicting duplicates;
2. canonically sorts wallets and channels;
3. maps every wallet to exactly one opaque operator;
4. evaluates all channels and records every exclusion;
5. collapses eligible channels to one canonical operator-level candidate; and
6. commits the complete universe count/root and eligibility-prestate root.

Local filtering fails closed for account status, availability, exit/removal,
allowlist, domain, channel state, reconciliation, deficit, limits,
operator-level offers/concurrency, BUY capacity, SELL principal, and SELL
physical fiat. An injected adapter supplies the pinned read-only result. The
offline simulator labels its injected result as a fixture, never as contract
authority.

## Deterministic ranking and recovery

Primary ordering is integer WFQ finish. Operator-level concentration,
inventory imbalance, failure tier, oldest activity, and a domain-separated
Keccak tie-break follow. Concentration state is event-sourced and applied
before the final order-ID-dependent hash, limiting hash grinding under the
explicit fixture bound.

Rank-zero assignment and miss events drive a bounded recovery cohort. A
cooling nonresponsive quartet can no longer exclude a responsive fifth
forever: the cohort expands only up to the explicit shadow-policy bound,
places responsive candidates first, and still emits exactly four or a
no-service result.

Exact four has no partial fallback. Readiness requires the fixture parameter
`4 + F` in both distinct operators and distinct failure domains. Two, three,
four, and `4 + F` states have golden vectors. `F` itself remains a governance
choice.

## Lease timing

Lease intervals are half-open:

```text
[assignedAt, assignedAt + step)       highest unlocked rank 0
[assignedAt + step, + 2*step)         highest unlocked rank 1
[assignedAt + 2*step, + 3*step)       highest unlocked rank 2
[assignedAt + 3*step, validUntil)     highest unlocked rank 3
```

No rank is eligible at `validUntil`. Before a shadow decision is created:

```text
validUntil <= quoteDeadline
validUntil >= assignedAt + 3*step + minimumFinalAcceptanceWindow
assignmentTTL >= 3*step + minimumFinalAcceptanceWindow
```

The 0/15/30/45/90 boundary seconds and the invalid quote-expiry vector are
tested explicitly.

## Canonical trace

The decision envelope schema is
`p2pflow.shadow-assignment-decision.v2`. Canonical JSON sorts object keys,
normalizes hexadecimal identifiers to lowercase, normalizes strings to NFC,
and represents integer fields as decimal strings. The decision identifier is
Ethereum Keccak-256 over the exact UTF-8 canonical payload.

The envelope includes a `witnessContentId`: Ethereum Keccak-256 over the exact
canonical `p2pflow.shadow-selection-witness.v1` document. That witness contains
the normalized order, candidates, opaque operators, history, finalized
universe evidence, sorted universe entries, eligibility prestates, exclusions,
and exact output. The policy hash is itself derived from the canonical policy
witness, including all selection/recovery parameters, the binding Council bill
hash, `REJECT`, and `actionAuthorization=false`. A caller-supplied hash with
changed policy material fails closed.

The envelope commits chain, Diamond, order, round, routing domain/epoch,
sequence, finalized block number/hash, assignment validity, quote, policy and
build hashes, witness content ID, universe count/root, complete
eligibility-prestate root,
ordered operator/wallet/channel/rank output, half-open lease schedule, and
output root. Changing the block hash, quote, build manifest, universe,
channel, or output changes the digest or fails validation.

The current fast selector test asserts these exact fixture values:

```text
decisionId       0xf4581c7c76e58d115fd44c3210c115d3e66dda67b4d9a0512b40f40170c0c9c3
witnessContentId 0xaefe30d51c98693892cbb4e0fe729690fda806d38af824e8f0c81b92c9213f04
policyHash       0x23b59e9e68f085862233233a12d8cb82f168e1da16ba5354de93b4b105e8ab4d
universeRoot     0x66598f2b5a714c335c33d7c05b9daff224e2e36aba46dff9b4dfb79a8f95d7d9
prestateRoot     0xcb8801299619b8d12f5c0ae76014b756315b416c1b2d8e5b2e954230cadd43c5
outputRoot       0x185b067b00845648764f75f2b1482540d68f4576413f1b8988b344fae7c57746
```

No 100,000-order trace root is documented while final frozen reruns are
pending.

## Metrics

The simulator reports separately:

- global accepted-USDC Jain index;
- explicit positive accepted-service coverage and its pass/fail target;
- comparable-eligibility-cohort Jain index;
- global and comparable max/min accepted-USDC spread;
- eligible decisions and eligible notional by operator;
- `capacityBindingExclusions`, the separate count of excluded
  candidate/channel evaluations whose final eligibility code is
  `TOO_MANY_OPEN_OFFERS`, `TOO_MANY_ACTIVE_ORDERS`,
  `DAILY_LIMIT_EXCEEDED`, `MONTHLY_LIMIT_EXCEEDED`, `INSUFFICIENT_USDC`,
  `INSUFFICIENT_FIAT_PRINCIPAL`, or `INSUFFICIENT_PHYSICAL_FIAT`; and
  unresolved orders;
- rank exposure and rank-zero misses;
- lease fallback, offer exposure, duplicate acceptance, reorg discard,
  wallet rotation, re-entry, and checkpoint counts; and
- virtual-finish regressions.

Jain arithmetic is exact:

```text
J = (sum(x)^2) / (n * sum(x^2))
```

The report stores a scaled integer plus its exact numerator and denominator.
Thresholds and the comparable-cohort cutoff are explicit fixture inputs, not
approved constants.

The deterministic test is configured to perform two sequential runs of exactly
100,000 calls through `selectOrder`, from one explicit configuration and seed,
and to compare the complete reports. Its test-runner timeout is 1,800,000 ms.
The timeout is only a limit. Earlier durations, counters, fairness results,
report digests, and trace roots are superseded pending that test from the final
frozen source digest. See [verification.md](./verification.md) for the required
evidence.
