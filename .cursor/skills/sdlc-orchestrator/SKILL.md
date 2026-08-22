---
name: sdlc-orchestrator
description: >-
  Runs the full AI Software Delivery workflow from requirements through PR,
  BugBot, and SDD sync. Use when the user says start, resume, status, abort,
  sdlc orchestrator, or software delivery automation.
disable-model-invocation: true
---

# SDLC Orchestrator

Deploy: copy `.cursor/` + `AGENTS.md` only. **All repo information** for agents lives in `.cursor/project-context/` (generated from **full project analysis** on `start`). Do not edit other `.cursor/` paths in app repos ([`.cursor/README.md`](../../README.md)).

You are the **Orchestrator**—the only user-facing agent for this workflow.

**Flow chart:** read [flow-chart.md](flow-chart.md) when invoked (diagram + step table).

## Commands

| Command | User says | Action |
|---------|-----------|--------|
| Start | `start` | **Glob/Read disk** → generate missing `.cursor/project-context/` (§0.0) — never trust memory; templates are schema only → validate → `DISCOVERY` |
| Resume | `resume` or `resume <workflowId>` | **Re-verify project-context on disk** → reload MDC → continue from saved state |
| Status | `status` | Show progress |
| Abort | `abort` | Cancel workflow (`FAILED`) |
| Approve SDD | `approve` / `continue` / `yes` / `approve sdd` | After SDD written → Jira and implementation |
| Approve PR | `approve` / `continue` / `yes` / `approve pr` | After BugBot + review → publish PR |

Case-insensitive. Treat `resumt` as `resume`. **Intent over exact syntax** — see orchestrator §3 (Flexible intent).

## Approvals (two gates only)

1. **SDD gate** — after SDD; before Jira, plan, and code. User can say `approve`, `continue`, `yes`, or `approve sdd` (typos like `approve ssd` OK).
2. **Pre-PR gate** — after all phases, BugBot, and review. User can say `approve`, `continue`, `yes`, or `approve pr`.

No approval for the plan or between implementation phases. After SDD approval, the orchestrator **auto-runs** the full pipeline until gate 2 — do **not** stop per phase or ask "continue?" mid-pipeline. Use **`pause`** or **`step`** only if the user wants manual stepping.

## Complete delivery

Every requirement must produce a **working end-to-end result** — not partial or config-only work. Superseded files must be **deleted**, not left unused. See [complete-delivery.md](../../sdlc-system/workflow/complete-delivery.md).

**Scope options at the SDD gate:** the SDD presents radio options (single-select, **Option 1 default**) plus a **cleanup checkbox** ("remove unused files and dead code", off by default). The user picks when approving — e.g. `approve option 2 + cleanup`. The selection bounds planning and the diff.

| `workType` | Scope |
|------------|--------|
| `feature` | All layers the SDD specifies for the feature |
| `transformation` | Full affected codebase + cleanup ([complete-delivery.md](../../sdlc-system/workflow/complete-delivery.md)) |
| All work types | Pre-PR: **deps/versions + compile + CI green** ([pre-pr-verification.md](../../sdlc-system/workflow/pre-pr-verification.md)) |
| `bugfix` / `refactor` | Per SDD; delete superseded paths when replacing |

Stack-specific steps belong in **SDD** and optional `stackRules` — not hardcoded in the kit.

## Branch naming (generic — not in project MDC)

Branch name = `artifactSlug` only (e.g. `callback-webhook-retry`). Kit-fixed for all repos — see [artifact-naming.md](../../sdlc-system/workflow/artifact-naming.md). One branch for all phases.

**Base branch:** default `master`. When collecting requirements, tell the user and accept override via `base branch: <name>`. Developer agent fetches and pulls that base, then creates the feature branch.

## Pipeline (automatic after SDD approval)

`JIRA` → `PLAN` → `EXECUTION` (all phases) → `QA` → `IMPACT_ANALYSIS` → `FLOW_VALIDATION` → draft PR → `BUGBOT` → `REVIEW` → [fixes] → **`PROJECT_CONTEXT_SYNC`** → **`BUGBOT` (final)** → **`CI_VERIFICATION`** → **`approve pr`** → publish PR → `SDD_SYNC`

## Required reading (in order)

1. `.cursor/sdlc-system/orchestrator.md` — on `start` / `resume`, run **§0.0a disk-first** then **§0.0 bootstrap** ([project-context-bootstrap.md](../../sdlc-system/workflow/project-context-bootstrap.md), [filesystem-verification.md](../../sdlc-system/workflow/filesystem-verification.md))
2. `.cursor/project-context/*.mdc` — **live path only**; verify each file on disk before load (use templates for YAML schema only)
3. `.cursor/docs/sdlc.md` (MDC spec, pipeline, agent rules)
4. [flow-chart.md](flow-chart.md) (delivery diagram)

## Agent prompts

All under `.cursor/sdlc-system/agents/`:

| Agent | File |
|-------|------|
| project-discovery | `project-discovery-agent.md` |
| sdd-architect | `sdd-architect-agent.md` |
| jira | `jira-agent.md` |
| planning | `planning-agent.md` |
| developer | `developer-agent.md` |
| qa | `qa-agent.md` |
| impact-analysis | `impact-analysis-agent.md` |
| flow-validation | `flow-validation-agent.md` |
| review | `review-agent.md` |
| pr-manager | `pr-manager-agent.md` |
| bugbot | `bugbot-agent.md` |
| sdd-sync | `sdd-sync-agent.md` |

Handoffs: `.cursor/sdlc-system/handoff.md` (v1.1 + `workflowContext`).

## Artifacts

| Committed (`docs/sdlc/<workflowId>/`) | Local only (gitignored) |
|---------------------------------------|-------------------------|
| RDD `*-requirements.md` | `.cursor/sdlc-system/workflow-artifacts/<workflowId>/` |
| SDD `*.md` (not `*-requirements`) | `.cursor/sdlc-system/state/<workflowId>.json` |

Ephemeral files are deleted before PR push. See `.cursor/sdlc-system/workflow/artifact-naming.md`.
