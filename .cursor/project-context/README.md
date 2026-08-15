# P2PFlow project context

Generated from a fresh disk review on 15 August 2026 for the cross-repository Base Sepolia MVP delivery.

- `project.mdc` — repository policy, stack, build/test commands, branching, and constraints.
- `architecture.mdc` — current and target platform layers, boundaries, integrations, authentication, and error handling.
- `coding-standards.mdc` — Solidity, JavaScript/JSX, TypeScript, AssemblyScript, testing, review, and entropy rules.
- `deployment.mdc` — local and Base Sepolia environments, deployment mechanisms, rollback, CI, and observability expectations.
- `business-flows.mdc` — user, merchant, operator, pricing, assignment, settlement, indexing, and session journeys.

The primary coordination repository is `p2pflow/p2pflow-smart-contract`; sibling P2PFlow repositories are modifiable. The planned `p2pflow-executor` has no remote yet. Jira, final hosting, monitoring vendor, and the future production signer/KMS provider remain non-blocking `TBD` items.
