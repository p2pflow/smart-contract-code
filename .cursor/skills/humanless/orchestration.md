# Humanless — multi-agent orchestration

`@humanless` is the **parent orchestrator**. Every phase runs as a **separate agent** (kit agent file, own context) that returns a **validated JSON handoff**. The parent owns state, routing, handoff validation, iteration caps, hard-stops, and the Definition of Done gate — it does **not** implement code, QA, or review itself. This is the `@sdlc-orchestrator` machinery **without human approval gates** (auto-run from PRD to open PR).

Read with `SKILL.md` (spine) and [phases.md](phases.md) (per-phase actions). Kit specs: [handoff.md](../../sdlc-system/handoff.md), [routing-logic.md](../../sdlc-system/workflow/routing-logic.md), [orchestrator.md](../../sdlc-system/orchestrator.md).

## Parent responsibilities (never delegated)

- On every invocation, run the Phase 0 physical-disk gate before loading state, cache, index, or prior-session context; bootstrap missing project-context + validate MDC + build `workflowContext` (SKILL.md § Phase 0)
- Own and persist `state/<workflowId>.json` (load-bearing — see § State)
- Route each state to its agent per § Routing
- **Validate every handoff** against the contract (§ Handoff) — reject non-conforming, retry once, else hard-stop
- Apply iteration caps + hard-stops (SKILL.md § Autonomous decision boundary)
- Enforce Definition of Done before publish
- Never edit production code; never speak as a downstream agent

## Invocation modes

| Agent | Mode |
|-------|------|
| developer, qa | **Task subagent** (`generalPurpose`) — fresh context; pass full `inputs` JSON in the task prompt |
| project-discovery, sdd-architect, jira, planning, impact-analysis, flow-validation, review, pr-manager, bugbot, sdd-sync | **Task subagent** (`generalPurpose`) — fresh context |

Task prompt template:

```text
You are executing the <agent-slug> agent for humanless workflow <workflowId>.
Read and follow .cursor/sdlc-system/agents/<agent>.md exactly.
Read any inputs from disk (MDC, RDD, SDD, diff) — do not assume from memory.
Return ONLY a valid JSON handoff envelope per .cursor/sdlc-system/handoff.md.

INPUTS:
<paste inputs JSON incl. workflowContext, artifacts paths, branch, diff range>
```

**Independence rule:** never paste the implementer's self-assessment or an expected verdict into a verification agent (qa, review, impact-analysis, flow-validation, bugbot). Give it the branch, diff range, and artifact paths — it re-derives findings.

**Parallelism:** issue independent agents in one turn (e.g. impact-analysis + flow-validation in Phase 8).

## Handoff contract (enforced)

Every agent returns the kit envelope ([handoff.md](../../sdlc-system/handoff.md)):

```json
{
  "contractVersion": "1.1",
  "workflowId": "<uuid>",
  "agent": "<agent-slug>",
  "status": "<agent-status>",
  "timestamp": "<ISO-8601-UTC>",
  "inputs": { "workflowContext": {} },
  "outputs": {},
  "errors": [],
  "nextAction": "<invoke:|transition:|halt:>"
}
```

Parent **validation checklist** before accepting:

- Required fields present; `contractVersion` 1.0/1.1; `workflowId` matches state
- `agent` matches the one invoked; `status` valid for that agent (§ Routing)
- `errors` empty on success; required `outputs` keys present
- `nextAction` consistent with routing

On failure: retry once with `inputs.retry`; else write `blocker-report.md` and **hard-stop**. Never pass a malformed handoff downstream. Strip secrets before persisting to state.

## Routing (state → agent → required outputs)

Auto-run: on each valid handoff, persist state and proceed to the next state **without** approval gates. Only hard-stops and iteration caps interrupt.

| Phase / state | Agent | Success status | Required `outputs` |
|---------------|-------|----------------|--------------------|
| 1 Discovery | `project-discovery` | `READY_FOR_SDD` | `artifactSlug`, `requirementsPath`, `requirementsSummary`, `repoPolicy`, `workType` |
| 1b SDD | `sdd-architect` | `READY_FOR_JIRA` | `sddPath`, `sddSummary`, `scopeOptions` (auto-pick default), `cleanupOption` |
| 2 Jira | `jira` | `READY_FOR_PLANNING` | `jira.epicId`, renamed `sddPath` |
| 4 Planning | `planning` | `READY_FOR_EXECUTION` | `planPath`, `phases[]` |
| 5 Implementation | `developer` (per phase, `mode: execution`) | `PHASE_COMPLETE` → next phase; `READY_FOR_QA` when done | `branch`, `commits[]`, `implementationSummaryPath` |
| 6 QA | `qa` | `READY_FOR_IMPACT_ANALYSIS` / `QA_FAILED` | `qaReportPath`, `passed` |
| 6 Draft PR | `pr-manager` (`mode: draft`) | `DRAFT_PR_READY` | `pr.url`, `pr.number` |
| 6/10 BugBot | `bugbot` | `READY_FOR_REVIEW` / `READY_FOR_FIXES` | `bugbotReportPath`, `actionableFindingCount` |
| 7 Review | `review` | `READY_FOR_PRE_PR` / `REVIEW_BLOCKED` | `reviewSummaryPath`, `blockingCount` |
| 8 Impact | `impact-analysis` | `READY_FOR_FLOW_VALIDATION` / `IMPACT_ANALYSIS_FAILED` | `impactAnalysisReportPath`, `riskLevel` |
| 8 Flow | `flow-validation` | `READY_FOR_REVIEW` / `FLOW_VALIDATION_FAILED` | `flowValidationReportPath`, `flowSafetyScore` |
| 9/10 Sync | `developer` (`mode: project-context-sync`) | `PROJECT_CONTEXT_SYNCED` | `project-context-sync-report.md`, `compile-verification-report.md` |
| 9 SDD sync | `sdd-sync` | `COMPLETED` (SDD) | `finalSddPath`, `syncSummary` |
| Fixes loop | `developer` (`mode: fixes`) | `FIXES_COMPLETE` | `commits[]` |
| 12 Publish | `pr-manager` (`mode: publish`) | `PR_PUBLISHED` | `pr.url` |
| 13 Jira update | `jira` | done | updated issue |

Parent-run (no agent): Phase 0 bootstrap, Phase 3 scope identification (light — full impact is Phase 8), CI verification (`gh pr checks`), secret scan, Definition of Done gate, final report.

## State file (load-bearing)

`.cursor/sdlc-system/state/<workflowId>.json` — written after every accepted handoff; used for resume.

```json
{
  "workflowId": "<uuid-v4>",
  "contractVersion": "1.1",
  "workflowContext": {},
  "currentState": "DISCOVERY",
  "context": { "workType": "feature", "baseBranch": "master", "scopeSelection": null, "cleanup": false, "autoRun": true },
  "artifacts": { "artifactSlug": null, "requirementsPath": null, "sddPath": null, "planPath": null, "epicId": null },
  "execution": { "currentPhaseIndex": 0, "phases": [], "branch": null },
  "pr": null,
  "retryCounters": { "bugbot": 0, "qa": 0 },
  "handoffHistory": [],
  "lastHandoff": null,
  "lastError": null
}
```

Update rules: set `updatedAt`; append redacted handoff to `handoffHistory`; merge `outputs` into `artifacts`/`pr`/`execution`; set `currentState` to next; write **before** reporting the step. Redact keys matching `token|password|secret|apiKey|authorization`.

## Retry / caps (parent-enforced)

| Category | Max | On exhaustion |
|----------|-----|----------------|
| Handoff validation | 1 retry | hard-stop |
| BugBot fix cycles | 3 | hard-stop; report findings |
| QA/flow → implementation | 2 | hard-stop; report failing requirements |
| CI poll | bounded timeout | stop; do not publish |

## Operating loop (every step)

```
INVOCATION ENTRY (always, including resume):
1. Check .cursor/project-context/ directly on physical disk with Glob/Read
2. If folder is absent, create it and generate all six required files from full repo recon
3. If any required file is absent, generate it from full repo recon
4. Read and validate all MDC; rebuild workflowContext from disk
5. Only now load state/<workflowId>.json and resume currentState

ROUTING LOOP:
6. If currentState terminal (COMPLETED/FAILED) → report, stop
7. Resolve agent from § Routing
8. Build inputs (workflowContext + artifacts + branch + diff range + retry?)
9. Invoke agent as Task subagent
10. Parse + VALIDATE handoff (§ Handoff)
11. Update + persist state
12. Compute next state; apply caps/hard-stops
13. Auto-run → GOTO 7 (no approval gates); at DoD gate → verify, then publish
```

The invocation-entry gate must not use workflow state, cache, index, open editor tabs, or prior-session context as proof that `.cursor/project-context/` exists. Physical disk wins.

## Difference from `@sdlc-orchestrator`

Same agents, handoff contract, state machine, and routing — **minus the two human approval gates**. `humanless` auto-approves scope (SDD default option) and auto-proceeds to publish; it still stops at an **open PR** (never merges) and honors all hard-stops, caps, and the Definition of Done gate.
