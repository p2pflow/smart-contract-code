# P2PFlow MVP delivery guidance

This repository is the primary coordination repository for the P2PFlow Base Sepolia MVP. The delivery also modifies the sibling `p2pflow-subgraph`, `p2pflow-user-ui`, `p2pflow-merchant-ui`, and `p2pflow-admin-ui` repositories and introduces one `p2pflow-executor` service.

## Non-negotiable scope

- Base Sepolia only (`chainId 84532`) for this phase. Do not add or execute mainnet deployment paths.
- Work on `codex-2`, created from the latest `origin/dev`, in every existing P2PFlow repository.
- Build exactly one modular executor deployable. Pricing, matching, chain ingestion, transaction submission, sessions/API, and operational jobs are modules in that service, not separately deployed microservices.
- The repositories under `/home/ubuntu/check/p2pme` are read-only architectural references. Never copy their code wholesale or modify them.
- Use Circle's official six-decimal Base Sepolia USDC contract consistently across contracts, executor, subgraph, and UIs.

## Security

- Never read, print, stage, copy, or commit `/home/ubuntu/check/.env` or any credential value.
- The previously supplied deployer key must not be used because it was exposed in tool output. Deployment and signing stay disabled until the user replaces it.
- Never place private keys, Thirdweb secrets, Goldsky tokens, encryption secrets, or privileged RPC credentials in `VITE_*` variables.
- Treat wallet connection as identity discovery, not an authenticated backend session. Privileged APIs require a nonce/signature session verified server-side.
- Keep payment details and UPI data out of public events and the subgraph.

## Engineering expectations

- Contract state is authoritative for custody, order state, role checks, eligibility, and liquidity guardrails. The subgraph is an eventually consistent read model.
- Decode order IDs from confirmed events; never use a transaction hash as an order ID.
- Use bounded token allowances, checks-effects-interactions, SafeERC20, reentrancy protection, explicit roles, pause controls, and invariant-focused tests.
- Use deterministic job/action IDs, durable cursors, confirmation/reorg handling, transaction simulation, and receipt reconciliation in the executor.
- Remove demo data, placeholders, fake success states, and development-mode UI from released routes when replacing a flow.
- Preserve unrelated user changes. Delete superseded implementations when the approved design replaces them.

Project-specific architecture, verification, deployment, and business-flow context is in `.cursor/project-context/`.
