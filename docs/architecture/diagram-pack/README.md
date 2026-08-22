# P2PFlow Architecture Diagram Pack

This pack documents the as-built Base Sepolia MVP architecture at five levels:

1. `01-system-context` — users, UIs, the v2 Diamond, one executor, PostgreSQL, Goldsky, providers, and managed signers.
2. `02-buy-sell-lifecycle` — complete BUY and SELL settlement journeys, including private payment-reference boundaries and terminal recovery.
3. `03-diamond-contract` — EIP-2535 proxy, facets, shared storage/libraries, custody, roles, and public event projection.
4. `04-executor-internals` — the single-process executor’s HTTP, session, domain, scanner, job, transaction, and persistence components.
5. `05-finality-recovery` — browser write journals, the zero-based 12-block finality rule, canonical scanning, ambiguity, and reorg handling.

Each diagram has an editable Graphviz source (`.dot`) and a high-resolution PNG. The combined PDF places one diagram on each screen-first 16:9 landscape page.

## Regenerate

From the smart-contract repository root:

```bash
npm run docs:diagrams
```

Verify that the checked-in PNG and PDF outputs reproduce exactly:

```bash
npm run docs:diagrams:check
```

The renderer requires Graphviz `dot` and the repository’s pinned Playwright/Chromium installation.

## Visual language

- Orange arrows: wallet-signed or managed on-chain transactions.
- Cyan arrows: HTTPS/API calls and authoritative reads.
- Green arrows: canonical events, projections, or successful completion.
- Magenta arrows: private payment-reference data.
- Dashed red arrows: retry, uncertainty, reorg, rollback, or fail-closed paths.
- Dashed borders: infrastructure or behavior that is separately enabled and never an independent source of authority.

These diagrams describe the implementation and its release gates. They do not claim that a public deployment is currently live.
