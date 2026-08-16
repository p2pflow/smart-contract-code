# Base Sepolia read-only preflight

Status: required release gate. It does not deploy, sign, broadcast, unpause, grant a role, or enable executor writes.

## Purpose

Prove that a separately produced and independently reviewed v2 deployment manifest describes the exact live system before any UI or executor is pointed at it. A missing or failed proof is a stop condition; the local fixture is never a fallback.

## Required inputs

- A reviewed `base-sepolia-deployment` manifest with `deployed`, `safeForSharedEnvironment`, and `initialization.initialized` all `true`.
- A separately injected HTTPS Base Sepolia RPC endpoint. Do not pass credential-bearing URLs on a shared command line or read a repository environment file.
- Node 24.18.0, npm 11.16.0, clean protocol dependencies, and an unchanged canonical package/artifact digest.
- Recorded Q-1–Q-7 decisions, replacement authority identities, and an independent reviewer. Q-8 must also be resolved before coordinated publication.

The expected network is chain `84532`. The only accepted custody token is official Base Sepolia USDC at `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, with six decimals.

## Procedure

1. Keep the Diamond paused and every executor startup mode `off`.
2. Verify the candidate manifest and RPC path came from the reviewed release record. Copy neither into source control.
3. Install and build the canonical package:

   ```sh
   npm --prefix packages/protocol ci --no-audit --no-fund
   npm ci --no-audit --no-fund
   npm run protocol:build
   ```

4. Run the read-only check:

   ```sh
   BASE_SEPOLIA_RPC_URL=https://reviewed-rpc.example \
     npm run preflight:base-sepolia -- \
     --manifest /reviewed/base-sepolia-v2.json
   ```

5. Save the command version, reviewed manifest digest, protocol artifact digest, commit, UTC time, operator, reviewer, and pass/fail result in the release evidence store. Do not record the RPC credential.

## What the command proves

- Chain ID is exactly 84532; deployment and initialization receipts are successful and match their committed blocks, transaction actors, target, value, and timestamp.
- Diamond, initializer, every facet, and official USDC have code and the exact reviewed bytecode hashes.
- Initialization calldata, facet additions, selector ownership, `ProtocolInitialized`, role grants, safety/stake/price-policy events, and manifest commitments agree.
- Protocol ID/version, storage layout/namespace, token address, owner, loupe output, facet set, and selector set agree with the canonical package.
- The fresh Diamond is paused.
- Owner and all seven application-role holders are mutually distinct; each application role has exactly one expected holder; the Diamond owner holds no application role.
- The manifest and USDC ABI digests match the canonical package.

## Fail closed

Stop on any timeout, missing receipt/block, RPC disagreement, reorg, unsafe/fixture manifest, wrong token/decimals, unexpected selector, role overlap, extra role member, unpaused state, or digest/code mismatch. Do not edit the manifest to make a failure pass. Quarantine the candidate, return all automation to `OFF`, and open an incident/review record.

A successful read-only preflight is necessary but not sufficient for writes. Independent review, shadow evidence, replacement signer attestation, Q-1–Q-8, and explicit enablement approval remain separate gates.
