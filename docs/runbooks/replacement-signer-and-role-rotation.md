# Replacement signer and role rotation

Status: mandatory before any shared signing. Any key previously exposed, placed in a local environment file, or used as a development identity is permanently prohibited.

## Role model

The Diamond owner and seven application roles—`DEFAULT_ADMIN_ROLE`, `OPERATOR_ROLE`, `UPGRADER_ROLE`, `PAUSER_ROLE`, `PRICE_UPDATER_ROLE`, `ORDER_ASSIGNER_ROLE`, and `DISPUTE_RESOLVER_ROLE`—must be eight mutually distinct identities. Each application role has exactly one expected member at the initial release, and the Diamond owner holds no application role.

Executor automation uses three narrower signer lanes:

- pricing → `PRICE_UPDATER_ROLE`;
- matching → `ORDER_ASSIGNER_ROLE`;
- recovery → `OPERATOR_ROLE`.

Direct human governance remains wallet/multisig controlled according to approved Q-1. An executor signer must not hold an unrelated role.

## Provision replacement identities

1. Keep the Diamond paused and every automation mode `OFF`.
2. Record Q-1 custody owners, recovery owners, funding source, quorum, break-glass process, and rotation approvers.
3. Create identities inside the approved managed signer/KMS/HSM boundary. Export only addresses and opaque references; never raw keys or seed phrases.
4. Fund only the gas needed for bounded Base Sepolia operation. Never fund or configure mainnet in this release.
5. Add all prior, exposed, fixture, and prohibited addresses to `EXECUTOR_PROHIBITED_SIGNER_ADDRESSES`. This list must be explicit, non-empty for shared operation, reviewed, and monitored.
6. Configure short-lived workload identity plus the managed provider endpoint. Obtain an attestation binding chain 84532, exact Diamond, signer reference/address/role, selector allowlist, zero-value rule, and gas bounds.

## Rotate on-chain authority

Use a separately reviewed governance transaction plan. For each role, rotate one at a time:

1. Re-run read-only preflight and snapshot current owner/role membership.
2. Independently verify the new address and custody proof out of band.
3. Grant only the intended role to the replacement through the authorized admin lane.
4. Verify the canonical receipt at 12 confirmations and direct `hasRole`/member enumeration.
5. Revoke the prior holder, verify its canonical receipt, then prove exactly one member remains and the prior holder has no application role.
6. Update the reviewed manifest/release evidence through the approved manifest process; re-run package/runtime compatibility and preflight. Do not hand-edit a signed manifest.

Ownership transfer and upgrade authority require their own independent review and recovery rehearsal. Never combine owner transfer, application-role rotation, unpause, and automation enablement into one unreviewable change.

## Executor cutover

1. With modes still `OFF`, drain/stop the single executor and ensure no uncertain nonce/action exists.
2. Update only opaque signer reference/address configuration and the prohibited-address list. Rotate workload credentials if ownership changed.
3. Start with ceilings `off`; require signer attestation, exact exclusive on-chain role, denylist rejection tests, selector/value/gas policy, readiness, and operations health.
4. Run a no-sign shadow window and obtain independent approval. Use the normal enablement gate if writes are later authorized.

## Emergency compromise

Set modes `OFF`, pause custody writes, revoke workload access, rotate the role on-chain using the approved break-glass authority, and denylist the compromised identity. Treat any ambiguous send/nonce as transaction uncertainty. Preserve audit and provider evidence. Resume only after a new attestation, clean preflight, shadow evidence, and independent incident closure.
