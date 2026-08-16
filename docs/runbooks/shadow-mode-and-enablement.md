# Shadow mode and write enablement

Status: approval-gated. This runbook does not authorize enablement; its default and current release posture is `OFF`.

## Mode model

| Mode | Reads/simulation | Reservation/signing/broadcast |
|---|---|---|
| `OFF` | Health and canonical scanning only | Never |
| `SHADOW` | Same source, validation, pricing, eligibility, and simulation path as enabled | Never |
| `ENABLED` | Full authoritative path | Only after every gate below |

The executor startup value is a hard ceiling. A durable admin setting cannot promote a module above its startup ceiling. Moving to `OFF` or `SHADOW` acquires the exclusive canonical write fence, so it drains earlier broadcast decisions before the transition commits.

## OFF to SHADOW

1. Complete the read-only Base Sepolia preflight and keep the Diamond paused until its separate release approval.
2. Resolve and record Q-1–Q-8. In particular, approve named price sources/thresholds, caps, safety durations, privacy retention/key ownership, governance/reviewer, and executor remote/PR policy.
3. Install replacement role identities and managed signer attestations even though shadow will not invoke them. Confirm each identity is distinct, exact-role only, and every exposed/prior identity is denylisted.
4. Set only the intended module startup ceiling to `shadow`; restart the single executor; require readiness.
5. With an authenticated OPERATOR session and a unique idempotency key, change the durable row from `OFF` to `SHADOW` using its exact `expectedVersion`.

## Required shadow evidence

Observe a representative window covering both BUY and SELL demand, price-source disagreement, no-candidate and stale-candidate cases, order expiry, dispute/recovery, scanner restart, duplicate/missed event replay, shallow reorg, provider timeout, Graph lag, and transaction simulation failure. Record:

- canonical/Graph heights and hashes, source inputs, accepted/rejected observations, rounded BUY/SELL outputs, and deviation decisions;
- candidate eligibility/capacity decisions and Diamond simulation results;
- what would have been signed, selector/value/gas policy, and why no signer/nonce/broadcast path ran;
- queue/outbox/retry results, restart convergence, alert delivery, and privacy-safe audit evidence;
- zero active reservation, nonce allocation, signature request, raw transaction, or broadcast caused by shadow.

An independent reviewer must compare shadow decisions with approved Q-3–Q-5 settings and sign the evidence record.

## SHADOW to ENABLED gate

All of the following must be true at the same reviewed commit and manifest digest:

- clean six-repository CI, coordinated package/digest gate, local system E2E, real-PostgreSQL tests, privacy scans, and container validation;
- fresh read-only preflight and independent contract review with no open blocker/major/minor finding;
- Q-1–Q-8 approved; replacement signer custody/attestation and role separation verified; prohibited signer denylist complete;
- backups/restores, alerts, incident ownership, rollback image, privacy retention, and on-call coverage rehearsed;
- shadow evidence accepted; Diamond pause/unpause authority and enablement authority explicitly named;
- a change record names module, exact version, time window, rollback trigger, approver, operator, manifest/artifact/commit digests, and bounded startup ceiling.

Only then may the separately authorized operator unpause as approved, raise the selected startup ceiling, restart, re-run preflight, and submit `PUT /v1/admin/automation-mode` with `mode: "ENABLED"` and the row's exact version. Promotion creates a durable paginated scan for still-actionable one-shot work; monitor it to completion.

Enable one module at a time. Pricing precedes matching; recovery requires its own OPERATOR signer and evidence. On any anomaly, set the affected module—or all modules—to `OFF`, wait for the write fence to drain, and follow rollback/recovery.
