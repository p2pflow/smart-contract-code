# Verification status — final frozen reruns pending

## Authority boundary

This package remains transaction-disabled shadow/offline scaffolding. The
binding Council verdict is unanimous **REJECT**, bill SHA-256
`4295e790fd8f4e96e17fd54e033c4004bce7ed18aafc5a6c5bbda8d6f4931916`.
No signer, broadcaster, KMS key, deployed helper write ABI, external database
migration, bank reconciliation, canary, mainnet, or production transaction is
authorized or present.

## Superseded evidence

Exact results previously listed here were produced from older source
snapshots. They are intentionally removed because selector witnesses, ledger
validation, persistence constraints, and simulator success targets changed.
Those results must not be used as evidence for the current tree.

## Required final evidence

After the implementation tree is frozen, verification must record results for:

- `npm run build`, `npm run lint`, and `npm run typecheck`;
- all fast compiled tests, followed by the separately timed full suite;
- two identical 100,000-order runs from the same source digest and seed;
- the positive accepted-service coverage target, fairness targets, and zero
  virtual-finish regressions;
- replay fixture and persisted-witness execution through the production
  selector;
- Docker build-context and Kubernetes deny-all-egress static checks;
- migration lowercase identity constraints and the exact Council hash pin; and
- `git diff --check` plus a final secret/authority scan.

The two-run 100,000-order test currently has a 1,800,000 ms test-runner timeout.
That is a limit, not an expected duration or a performance claim. No final
counters, timings, report digest, replay digest, or simulation trace root are
claimed until frozen reruns complete and are independently reviewed.
