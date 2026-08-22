# AI Software Delivery System (Cursor)

A **project-agnostic** multi-agent SDLC system. Copy `.cursor/` and root `AGENTS.md` unchanged to any repo; **only** customize `.cursor/project-context/` (see [README.md § Portable files](README.md#portable-files-vs-per-repo)). **Application repos must not edit** other `.cursor/` kit files — see [`.cursor/README.md`](../README.md).

- **Agents** = generic SDLC roles (no hardcoded stack, repos, or Jira keys)
- **MDC files** = **complete repo knowledge** in `.cursor/project-context/` (single source of truth for agents)
- **Execution** = Agents + `workflowContext` built from MDC
- **Verification** = Agents do **not** run local build/test/runtime; CI validates after push (see [§ MDC — agent rules](#mdc-and-workflow-context))

One **Orchestrator** is user-facing; **twelve** downstream agents run discovery through delivery. Handoffs use **contract v1.1** with mandatory `workflowContext`.

## Quick start

1. Invoke: `@sdlc-orchestrator` → **`start`** — orchestrator checks **`.cursor/project-context/`** (live) only; if missing, **analyzes the repo** and **generates** project-specific MDC (templates = YAML schema only, not copied output) ([bootstrap spec](../sdlc-system/workflow/project-context-bootstrap.md)).
2. Fill any remaining `TBD` fields in the MDC files (or confirm in chat).
3. Orchestrator **validates MDC** before `DISCOVERY`; on failure see [Missing Context Report](#missing-context-report).
4. Provide **business requirements** only (repos/stack come from MDC). Orchestrator defaults to branching from latest **`master`**; override with **`base branch: <name>`** when replying.
5. Approve at **`SDD_APPROVAL`** and **`PRE_PR_APPROVAL`** — natural replies OK (`approve`, `continue`, `yes`, or `approve sdd` / `approve pr`). No approval between phases — the orchestrator auto-chains after SDD approval (use **`pause`** / **`step`** only for manual stepping).

**Automatic pipeline** (after SDD): Jira → plan → execution → **QA** → Impact → Flow → draft PR → **BugBot** → **review** → [fixes] → project-context sync → **BugBot (final)** → CI green → **`approve pr`** → publish → SDD sync.

**Branch names (generic kit rule):** `artifactSlug` only (e.g. `callback-webhook-retry`) — one branch per feature for all phases. **Base:** default `master`; user may set `base branch: <name>` when providing requirements; developer agent pulls latest `origin/<base>` before `git checkout -b <artifactSlug>`.

## System overview

**Delivery flow chart:** [flow-chart.md](../skills/sdlc-orchestrator/flow-chart.md) (canonical ASCII diagram + step table).

| Goal | Mechanism |
|------|-----------|
| Predictable progression | State machine ([state-machine.md](../sdlc-system/workflow/state-machine.md)) |
| Human control | Two gates only: SDD and pre-PR publish |
| Tool integration | Jira, GitHub (`gh`), BugBot via dedicated agents |
| Recovery | Gitignored state file + idempotent re-invocation |

**Non-goals (v1):** no auto-merge to main; one epic per workflow; no custom MCP server.

## End-to-end walkthrough

Example feature: **idempotent partner webhook retry** · workflow `7f3e2a1b-…`

| Step | State / agent | You do | Output |
|------|----------------|--------|--------|
| 0 | `start` | Objective + acceptance criteria | `state/<workflowId>.json` |
| 1 | `DISCOVERY` → project-discovery | — | RDD in `docs/sdlc/<id>/` |
| 2 | `SDD_GENERATION` → sdd-architect | — | SDD in `docs/sdlc/<id>/` |
| 3 | `SDD_APPROVAL` | **`approve`** / **`continue`** / **`approve sdd`** | — |
| 4 | `JIRA_CREATION` → jira | — | Epic/tasks; SDD renamed |
| 5 | `PLANNING` → planning | — | `implementation-plan.md` → auto **EXECUTION** |
| 6 | `EXECUTION` → developer | — | All phases → `implementation-summary.md` |
| 7 | `QA` → qa | — | `qa-report.md` |
| 8 | `IMPACT_ANALYSIS` → impact-analysis | — | `impact-analysis-report.md` |
| 9 | `FLOW_VALIDATION` → flow-validation | — | `flow-validation-report.md` |
| 10 | `DRAFT_PR_CREATION` → pr-manager | — | Draft PR for BugBot |
| 11 | `BUGBOT_REVIEW` → bugbot | — | `bugbot-report.md` |
| 12 | `REVIEW` → review | — | → **`PROJECT_CONTEXT_SYNC`** |
| 13 | `PROJECT_CONTEXT_SYNC` → developer | — | deps/versions sync; `project-context-sync-report.md`; `compile-verification-report.md` |
| 14 | `BUGBOT_REVIEW` (final) → bugbot | — | BugBot on current PR tip (if enabled) |
| 15 | `CI_VERIFICATION` | — | `gh pr checks` all green |
| 16 | `PRE_PR_APPROVAL` | **`approve`** / **`continue`** / **`approve pr`** | — |
| 17 | `PR_PUBLICATION` → pr-manager | — | Full PR body; PR marked ready |
| 18 | `SDD_SYNC` → sdd-sync | — | **`COMPLETED`** |

Example (QA → Impact → Flow): [example-quality-gates-execution.md](../sdlc-system/workflow/example-quality-gates-execution.md).

**Commands:** `start` · `approve` / `continue` (at gates) · `status` · `resume` · `pause` · `step` · `abort` — intent-based; exact phrases not required

Sample handoff: [../sdlc-system/handoff.md](../sdlc-system/handoff.md).

## MDC and workflow context

Single reference for **project MDC**, **`workflowContext`**, orchestrator validation, and **shared agent rules**.

### Project MDC files

Path: `.cursor/project-context/*.mdc`

| File | Context key | Mandatory |
|------|-------------|-----------|
| `project.mdc` | `projectContext` | Yes |
| `architecture.mdc` | `architectureContext` | Yes |
| `coding-standards.mdc` | `codingStandards` | Yes |
| `deployment.mdc` | `deploymentContext` | Yes |
| `business-flows.mdc` | `businessFlowsContext` | Yes for flow validation |

**Parsing:** Extract YAML from the first fenced `yaml` block in each file → assemble `workflowContext`.

**Optional stack rules:** Additional `.mdc` files in `project-context/` (e.g. `java.mdc`, `play.mdc`) are **prose Cursor rules** for implementation — not YAML-parsed into `workflowContext`. Reference them from `coding-standards.mdc` → `documentation.stackRules`. A React repo might ship `react.mdc` instead; do not use `.cursor/rules/` for stack files.

#### Mandatory fields

**project.mdc → `projectContext`**

| Path | Required |
|------|----------|
| `project.name` | Yes |
| `repositories.primary` | Yes |
| `repositories.modifiable` | Yes (array, ≥1) |
| `technology.languages` | Yes |
| `technology.buildTool` | Yes |
| `technology.testCommands.fullSuite` | Yes |
| `jira.enabled` | Yes |
| `jira.projectKey` | Yes if `jira.enabled` |
| `branching.defaultBranch` | Optional (kit default `master` for branch-out and PR base) |

Optional: `agentVerification.runLocally`, `ciCommands`, `skipLocal`, `deferTo`; `bugbot` (`enabled`, `repoUrl`, `triggerOnDraftPr`, `botLogins`) — see [bugbot-setup.md](bugbot-setup.md).

**architecture.mdc → `architectureContext`:** `architecture.summary`, `architecture.style`, `architecture.layers` (array).

**coding-standards.mdc → `codingStandards`:** `testing.runner`, `testing.framework`, `review.dimensions`, `entropy` (dead/stale code policy). Optional: `documentation.stackRules`.

**deployment.mdc → `deploymentContext`:** `deployment.environments` (≥1), `deployment.rollback.code`.

#### Non-blocking fields (never ask the user)

Only the fields above block. Every other MDC field may stay `TBD` — bootstrap lists it in the Phase 0 report and agents continue. Do **not** stop or interrogate the user for infrastructure and org context that is not needed to deliver a PR: `deployment.cloudProvider`, `environments[].deployMechanism`, `environments[].runCommand`, `strategy.featureFlags`, `observability.*`, `ci.provider`, `jira.baseUrl`, and secret-injection mechanisms.

### workflowContext envelope

Built by Orchestrator on `start`; required in every agent `inputs` (handoff v1.1).

```json
{
  "workflowContext": {
    "projectContext": {},
    "architectureContext": {},
    "codingStandards": {},
    "deploymentContext": {},
    "businessFlowsContext": {},
    "loadedAt": "<ISO-8601-UTC>",
    "mdcPaths": {
      "project": ".cursor/project-context/project.mdc",
      "architecture": ".cursor/project-context/architecture.mdc",
      "codingStandards": ".cursor/project-context/coding-standards.mdc",
      "deployment": ".cursor/project-context/deployment.mdc",
      "businessFlows": ".cursor/project-context/business-flows.mdc"
    }
  }
}
```

If `workflowContext` is missing → `MDC_CONTEXT_MISSING` (not retryable).

| Need | Source |
|------|--------|
| Modifiable repos | `projectContext.repositories.modifiable` |
| Test command | `projectContext.technology.testCommands.fullSuite` |
| Jira project key | `projectContext.jira.projectKey` |
| PR base / branch-out | Kit default `master` ([artifact-naming.md](../sdlc-system/workflow/artifact-naming.md)) |
| Feature branch name | **Kit rule:** `artifactSlug` only — [artifact-naming.md](../sdlc-system/workflow/artifact-naming.md) |
| Layer paths | `architectureContext.architecture.layers` |
| Review dimensions | `codingStandards.review.dimensions` |

Echo `workflowContext` unchanged in handoff `inputs` (never put secrets in MDC).

### Missing Context Report

When mandatory MDC is missing, Orchestrator stops (`FAILED`, `MDC_INCOMPLETE`).

Output: `.cursor/sdlc-system/workflow-artifacts/<workflowId>/missing-context-report.md` (or chat only if no workflowId).

Report lists files checked, missing field paths, and instructs user to fix MDC and re-run `start`.

### Agent rules (all downstream agents)

**Artifacts — committed** (`docs/sdlc/<workflowId>/` only): RDD `*-requirements.md`, SDD `*.md`.

**Artifacts — ephemeral** (gitignored `workflow-artifacts/<workflowId>/`): plans, reports, `pr-body.md` — see [artifact-naming.md](../sdlc-system/workflow/artifact-naming.md). Delete before PR publish.

**No local build or test (default during execution):** Defer compile/test/runtime unless `runLocally: true` or user asks. **Pre-PR sync always:** reconcile dependencies/versions, run minimum compile, require **`gh pr checks` all green** — [pre-pr-verification.md](../sdlc-system/workflow/pre-pr-verification.md).

**Pipeline order:** Human gates only — `approve sdd`, then `approve pr`. After SDD: JIRA → PLAN → EXECUTION (all phases) → QA → Impact Analysis → Flow Validation → draft PR → BugBot → review → publish PR → SDD_SYNC.

**QA scope unchanged:** requirements, SDD, test evidence, coverage, acceptance criteria. Impact and flow validation are separate agents (7A, 7B).

**Entropy management:** No dead or stale code in deliverables. Developers clean entropy in touched files; review blocks per MDC `entropy.blockReview`. See [entropy-management.md](../sdlc-system/workflow/entropy-management.md).

**Handoffs:** `contractVersion: "1.1"` with `workflowContext` in `inputs`. See [../sdlc-system/handoff.md](../sdlc-system/handoff.md).

## Folder structure

```
.cursor/
├── docs/                    # Human docs: this README, sdlc guide, gh setup
│   ├── README.md            # Kit entry (indexes workflow, integrations, templates)
│   ├── sdlc.md
│   └── github-setup.md
├── project-context/         # Live per-repo MDC (created on start)
├── templates/
│   ├── project-context/     # MDC schema → used to generate live project-context/
│   └── workflow/            # RDD, SDD, plan scaffolds
├── skills/sdlc-orchestrator/
└── sdlc-system/
    ├── orchestrator.md
    ├── agents/              # 12 downstream agents
    ├── workflow/            # One file per topic
    ├── integrations/        # One file per tool (GitHub, Jira, BugBot)
    ├── handoff.md
    ├── handoff-schema.json
    ├── workflow-artifacts/  # Ephemeral (gitignored)
    └── state/               # Runtime (gitignored)
```

## Agent index

| # | Agent | Slug | Output status |
|---|--------|------|----------------|
| — | Orchestrator | `orchestrator` | Manages all states |
| 1 | Project Discovery | `project-discovery` | `READY_FOR_SDD` |
| 2 | SDD Architect | `sdd-architect` | `READY_FOR_JIRA` |
| 3 | Jira | `jira` | `READY_FOR_PLANNING` |
| 4 | Planning | `planning` | `READY_FOR_EXECUTION` |
| 5 | Developer | `developer` | `READY_FOR_QA` |
| 6 | QA | `qa` | `READY_FOR_IMPACT_ANALYSIS` |
| 7A | Impact Analysis | `impact-analysis` | `READY_FOR_FLOW_VALIDATION` |
| 7B | Flow Validation | `flow-validation` | `READY_FOR_REVIEW` |
| 8 | PR Manager (draft) | `pr-manager` | `DRAFT_PR_READY` |
| 9 | BugBot | `bugbot` | `READY_FOR_REVIEW` |
| 10 | Review | `review` | `READY_FOR_PRE_PR` |
| 11 | PR Manager (publish) | `pr-manager` | `PR_PUBLISHED` |
| 12 | SDD Sync | `sdd-sync` | `COMPLETED` |

## Documentation map

| Topic | File |
|--------|------|
| Kit index (workflow, integrations, templates) | [README.md](README.md) |
| Orchestrator runtime | [../sdlc-system/orchestrator.md](../sdlc-system/orchestrator.md) |
| Handoffs | [../sdlc-system/handoff.md](../sdlc-system/handoff.md) |
| MDC + agent rules | This file § MDC and workflow context |

## Design principles

- **MDC-first**: No workflow without valid `.cursor/project-context/*.mdc`.
- **Single entry point**: Users talk only to the Orchestrator (`@sdlc-orchestrator`).
- **Structured handoffs**: v1.1 JSON with `inputs.workflowContext` on every agent call.
- **Two approvals only** — accept natural affirmatives (`approve`, `continue`, `yes`) at each gate, not only `approve sdd` / `approve pr`.
- **Resumable**: State in `state/` (gitignored).
- **Fail closed**: Invalid MDC or handoffs → `FAILED` with recovery steps.
- **Complete delivery**: Working end-to-end result per acceptance criteria — not partial or config-only — [complete-delivery.md](../sdlc-system/workflow/complete-delivery.md).
- **Entropy**: Delete superseded files and dead code in deliverables — [entropy-management.md](../sdlc-system/workflow/entropy-management.md).

Skill entry: [SKILL.md](../skills/sdlc-orchestrator/SKILL.md) · [flow-chart.md](../skills/sdlc-orchestrator/flow-chart.md).
