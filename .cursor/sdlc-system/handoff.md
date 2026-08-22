# Handoff Contract

**Version 1.1** — All agents are project-agnostic; project facts travel in `workflowContext` from MDC files.

## Envelope (required)

```json
{
  "contractVersion": "1.1",
  "workflowId": "550e8400-e29b-41d4-a716-446655440000",
  "agent": "project-discovery",
  "status": "READY_FOR_SDD",
  "timestamp": "2026-06-04T12:00:00Z",
  "inputs": {
    "workflowContext": {
      "projectContext": {},
      "architectureContext": {},
      "codingStandards": {},
      "deploymentContext": {}
    }
  },
  "outputs": {},
  "errors": [],
  "nextAction": "invoke:sdd-architect"
}
```

## workflowContext (required in every handoff `inputs`)

| Key | Source MDC | Description |
|-----|------------|-------------|
| `projectContext` | `project.mdc` | Repos, technology, Jira, default branch, constraints |
| `architectureContext` | `architecture.mdc` | Layers, boundaries, integrations |
| `codingStandards` | `coding-standards.mdc` | Languages, testing, review rules |
| `deploymentContext` | `deployment.mdc` | Environments, rollback, CI |
| `businessFlowsContext` | `business-flows.mdc` | Named business flows for flow validation |

Orchestrator builds `workflowContext` once per session (§0 in orchestrator prompt). Downstream agents **echo** it in `inputs` and must not omit it.

`workflowContext` shape: `.cursor/docs/sdlc.md` § workflowContext envelope

## Field definitions

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `contractVersion` | string | Yes | `1.1` (MDC-aware) |
| `workflowId` | string (UUID) | Yes | Correlates all handoffs |
| `agent` | string | Yes | Slug of producing agent |
| `status` | string | Yes | Agent-specific terminal status |
| `timestamp` | ISO-8601 | Yes | UTC completion time |
| `inputs` | object | Yes | Must include `workflowContext` |
| `outputs` | object | Yes | Artifacts and data for downstream |
| `errors` | array | Yes | Empty on success |
| `nextAction` | string | Yes | Orchestrator routing hint |

## Status enum (by agent)

| Agent | Valid `status` values |
|-------|------------------------|
| project-discovery | `READY_FOR_SDD` |
| sdd-architect | `READY_FOR_JIRA` |
| jira | `READY_FOR_PLANNING` |
| planning | `READY_FOR_EXECUTION` |
| developer | `READY_FOR_QA`, `PHASE_COMPLETE`, `FIXES_COMPLETE`, `PROJECT_CONTEXT_SYNCED`, `PROJECT_CONTEXT_SYNC_FAILED` |
| qa | `READY_FOR_IMPACT_ANALYSIS`, `QA_FAILED` |
| impact-analysis | `READY_FOR_FLOW_VALIDATION`, `IMPACT_ANALYSIS_FAILED` |
| flow-validation | `READY_FOR_REVIEW`, `FLOW_VALIDATION_FAILED` |
| pr-manager | `DRAFT_PR_READY`, `PR_PUBLISHED`, `PR_CREATION_FAILED` |
| bugbot | `READY_FOR_REVIEW`, `READY_FOR_FIXES` (`NO_ACTIONABLE_FINDINGS` legacy → orchestrator maps to `REVIEW`) |
| review | `READY_FOR_PRE_PR`, `REVIEW_BLOCKED` |
| sdd-sync | `COMPLETED` |

## Error object

```json
{
  "code": "MDC_CONTEXT_MISSING",
  "message": "inputs.workflowContext not provided",
  "retryable": false,
  "details": {}
}
```

| Code | Agent | Meaning |
|------|-------|---------|
| `MDC_CONTEXT_MISSING` | any | No workflowContext in inputs |
| `MDC_INCOMPLETE` | orchestrator | MDC validation failed at start |

## nextAction values

| Value | Meaning |
|-------|---------|
| `invoke:<agent-slug>` | Run named agent |
| `wait:approval:sdd` | Pause for SDD approval |
| `wait:approval:pr` | Pause for pre-PR publish approval |
| `transition:<STATE>` | Explicit state transition |
| `halt:failed` | Move to `FAILED` |
| `halt:completed` | Move to `COMPLETED` |

## Orchestrator responsibilities

1. **Verify paths on disk** (Glob/Read) before bootstrap, MDC load, and artifact citations — see [filesystem-verification.md](workflow/filesystem-verification.md).
2. Load MDC from disk before first agent invocation; rebuild `workflowContext` on every `start` and `resume`.
3. Never pass partial handoffs to downstream agents.
4. Inject `workflowContext` into every agent `inputs`.
5. Derive `repoPolicy` from MDC—not from user chat.
6. Strip secrets from persisted handoffs.
7. Append each handoff to `state.handoffHistory[]`.

## repoPolicy derivation

```json
{
  "repoPolicy": {
    "modifiable": "<projectContext.repositories.modifiable>",
    "readOnly": "<projectContext.repositories.readOnly>",
    "involved": "<projectContext.repositories.involved>",
    "primary": "<projectContext.repositories.primary>"
  }
}
```

## Version migration

| Version | Change |
|---------|--------|
| 1.0 | Initial handoffs; repos in discovery inputs |
| 1.1 | Mandatory `workflowContext`; repos from MDC |

See [handoff-schema.json](handoff-schema.json).
