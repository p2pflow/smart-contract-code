# Routing Logic

## Routing table

| Current state | Primary agent | Expected handoff status | Next state |
|---------------|---------------|-------------------------|------------|
| `DISCOVERY` | project-discovery | `READY_FOR_SDD` | `SDD_GENERATION` |
| `SDD_GENERATION` | sdd-architect | `READY_FOR_JIRA` | `SDD_APPROVAL` |
| `SDD_APPROVAL` | *(orchestrator)* | user approves (`approve`, `continue`, `yes`, …) | `JIRA_CREATION` |
| `JIRA_CREATION` | jira | `READY_FOR_PLANNING` | `PLANNING` |
| `PLANNING` | planning | `READY_FOR_EXECUTION` | `EXECUTION` |
| `EXECUTION` | developer | `PHASE_COMPLETE` | `EXECUTION` (next phase) |
| `EXECUTION` | developer | `READY_FOR_QA` | `QA` |
| `QA` | qa | `READY_FOR_IMPACT_ANALYSIS` | `IMPACT_ANALYSIS` |
| `QA` | qa | `QA_FAILED` | `EXECUTION` |
| `IMPACT_ANALYSIS` | impact-analysis | `READY_FOR_FLOW_VALIDATION` | `FLOW_VALIDATION` |
| `IMPACT_ANALYSIS` | impact-analysis | `IMPACT_ANALYSIS_FAILED` | `EXECUTION` |
| `FLOW_VALIDATION` | flow-validation | `READY_FOR_REVIEW` | `DRAFT_PR_CREATION` |
| `FLOW_VALIDATION` | flow-validation | `FLOW_VALIDATION_FAILED` | `EXECUTION` |
| `DRAFT_PR_CREATION` | pr-manager | `DRAFT_PR_READY` | `BUGBOT_REVIEW` |
| `BUGBOT_REVIEW` | bugbot | `READY_FOR_REVIEW` | `REVIEW` |
| `BUGBOT_REVIEW` | bugbot | `READY_FOR_FIXES` | `REVIEW_FIXES` |
| `BUGBOT_REVIEW` | bugbot | `NO_ACTIONABLE_FINDINGS` *(legacy)* | `REVIEW` |
| `REVIEW` | review | `READY_FOR_PRE_PR` | `PROJECT_CONTEXT_SYNC` |
| `REVIEW` | review | `REVIEW_BLOCKED` | `REVIEW_FIXES` |
| `REVIEW_FIXES` | developer | `FIXES_COMPLETE` | `BUGBOT_REVIEW` |
| `PROJECT_CONTEXT_SYNC` | developer (`mode: project-context-sync`) | `PROJECT_CONTEXT_SYNCED` | `BUGBOT_REVIEW` (final) if `bugbot.enabled`; else `CI_VERIFICATION` |
| `BUGBOT_REVIEW` *(final)* | bugbot | `READY_FOR_REVIEW` | `CI_VERIFICATION` |
| `BUGBOT_REVIEW` *(final)* | bugbot | `READY_FOR_FIXES` | `REVIEW_FIXES` |
| `PROJECT_CONTEXT_SYNC` | developer | `PROJECT_CONTEXT_SYNC_FAILED` | `REVIEW_FIXES` or `EXECUTION` |
| `CI_VERIFICATION` | *(orchestrator)* | `gh pr checks` all pass | `PRE_PR_APPROVAL` |
| `CI_VERIFICATION` | *(orchestrator)* | checks fail / pending (timeout) | `REVIEW_FIXES` or wait |
| `PRE_PR_APPROVAL` | *(orchestrator)* | user approves (`approve`, `continue`, `yes`, …) | `PR_PUBLICATION` |
| `PR_PUBLICATION` | pr-manager | `PR_PUBLISHED` | `SDD_SYNC` |
| `SDD_SYNC` | sdd-sync | `COMPLETED` | `COMPLETED` |

**Not used:** `PLAN_APPROVAL`, `PR_CREATION` (replaced by `DRAFT_PR_CREATION` + `PR_PUBLICATION`).

## BUGBOT_REVIEW → never `SDD_SYNC`

Zero actionable or zero total findings → `READY_FOR_REVIEW` → **`REVIEW`** (first pass) or **`CI_VERIFICATION`** (final pass after sync). `SDD_SYNC` only after `PR_PUBLICATION`. See [bugbot-integration.md](../integrations/bugbot-integration.md) and orchestrator §10.1b.

## BugBot before gate 2

When `bugbot.enabled`: **`PROJECT_CONTEXT_SYNC` → `BUGBOT_REVIEW` (final) → `CI_VERIFICATION` → `PRE_PR_APPROVAL`**. Do not open gate 2 until final BugBot completes with zero actionable findings (or waiver).

## Pre-invocation checks

1. Load `state/<workflowId>.json`.
2. Verify `currentState` matches routing row.
3. Build `inputs` from handoff outputs + `workflowContext`.
4. For `EXECUTION`: auto-increment phase index — **do not wait for user** between phases when `context.autoRun === true` (default after `approve sdd`).
5. After `DISCOVERY`: set `execution.branchSlug = artifacts.artifactSlug` (branch name = feature slug only).
6. On `EXECUTION` phase 0: developer agent must `fetch` + pull latest `origin/<context.baseBranch>` (default `master`), then `checkout -b <artifactSlug>`.
7. For `PR_PUBLICATION`: require `approvals.prePr.approved === true`.
8. For `JIRA_CREATION` / `EXECUTION`: require `approvals.sdd.approved === true`.

## EXECUTION (phased loop — automatic)

```
WHILE currentPhaseIndex < phases.length:
    invoke developer(phase = phases[currentPhaseIndex])
    ON PHASE_COMPLETE: currentPhaseIndex++, continue (no user prompt)
    ON READY_FOR_QA: break → QA
ON plan READY_FOR_EXECUTION:
    auto-approve plan in state, start phase 0 immediately
```

## PROJECT_CONTEXT_SYNC

- Invoke developer with `inputs.mode: "project-context-sync"` after `READY_FOR_PRE_PR`.
- Recon feature branch; update stale `.cursor/project-context/*.mdc`; validate build/plugin coordinates; write `project-context-sync-report.md`.
- Spec: [project-context-sync.md](project-context-sync.md). **Mandatory** for `workType: transformation`.

## CI_VERIFICATION

- Orchestrator runs `gh pr checks` on the draft PR — **all checks must pass** before gate 2.
- Require `compile-verification-report.md` with `status: pass` and deps/versions reconciled in sync report.
- Spec: [pre-pr-verification.md](pre-pr-verification.md).

## PRE_PR_APPROVAL

- Do **not** invoke `pr-manager` publish mode until user approves **and** `PROJECT_CONTEXT_SYNC` passed **and** `ciVerification.allGreen === true`.
- Present: implementation summary, QA, impact analysis, flow validation, BugBot, review, deps/versions sync, compile report, CI check table, `pr-body.md` excerpt.

## Invocation modes

| Agent | Mode |
|-------|------|
| developer, qa | Task subagent |
| Others | Inline |
