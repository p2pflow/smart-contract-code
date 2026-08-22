# Cursor agent kit

Portable **AI agent configuration**. Copy `.cursor/` and root `AGENTS.md` to any repository; **only** customize `project-context/*.mdc` per project. **Do not edit** other `.cursor/` paths in application repos — kit changes go in the central kit repo, then redeploy. See [`.cursor/README.md`](../README.md). Then invoke `@sdlc-orchestrator` or `@humanless`.

## Layout

| Path | Purpose |
|------|---------|
| [`sdlc.md`](sdlc.md) | SDLC guide — MDC spec, pipeline, agent index |
| [`github-setup.md`](github-setup.md) | One-time `gh auth login` |
| [`bugbot-setup.md`](bugbot-setup.md) | Enable Cursor BugBot for this repo |
| [`../skills/sdlc-orchestrator/`](../skills/sdlc-orchestrator/SKILL.md) | `@sdlc-orchestrator` · [flow-chart.md](../skills/sdlc-orchestrator/flow-chart.md) — multi-agent pipeline with approval gates |
| [`../skills/humanless/`](../skills/humanless/SKILL.md) | `@humanless` — autonomous multi-agent pipeline from PRD to PR (no approval gates) · [orchestration.md](../skills/humanless/orchestration.md) (routing + handoff + state) · [phases.md](../skills/humanless/phases.md) (phase steps) · [agent-rules.md](../skills/humanless/agent-rules.md) (phase → agent) |
| [`../sdlc-system/`](../sdlc-system/) | Orchestrator prompt, agents, handoffs — used by `@sdlc-orchestrator` only (see below) |
| [`../templates/`](../templates/README.md) | Read-only kit templates (`project-context/`, `workflow/`) |

## Quick start

### `@sdlc-orchestrator` (multi-agent, gated)

1. In Cursor: **`@sdlc-orchestrator`** → **`start`** — analyzes the repo and **generates** `.cursor/project-context/` if missing ([bootstrap](../sdlc-system/workflow/project-context-bootstrap.md)).
2. Edit any `TBD` fields in `project-context/*.mdc` (see [Project context](#project-context)).
3. Run one-time [GitHub setup](github-setup.md) if agents will open PRs.
4. **`start`** again (or continue) once MDC validates.
5. Approve at two gates with **`approve`**, **`continue`**, or **`yes`** (exact `approve sdd` / `approve pr` also fine). After SDD approval, the pipeline auto-runs — no per-step confirmation.

Full SDLC docs: [`sdlc.md`](sdlc.md).

### `@humanless` (autonomous, multi-agent)

1. Invoke **`@humanless`** with a complete PRD/requirement document attached.
2. **Phase 0** bootstraps `.cursor/project-context/` from full repo analysis if missing (same procedure as orchestrator §0.0 — not a template copy).
3. The orchestrator runs Phases 1–13 autonomously. Stops only for blockers, incomplete MDC, or missing requirements — no SDD/pre-PR approval gates.

`@humanless` is a **parent orchestrator** that invokes each phase as its own kit agent (`.cursor/sdlc-system/agents/*`) with a validated JSON handoff and load-bearing state — see [orchestration.md](../skills/humanless/orchestration.md). It runs discovery, SDD, Jira, planning, developer, QA, review, impact, flow validation, BugBot (two passes), sync, and PR — the same machinery as `@sdlc-orchestrator`, minus the two human approval gates.

## Project context

**Agents are generic.** Stack (Java, Python, Spring Boot, Play, Vert.x, Dropwizard, Vue, React, etc.), repos, Jira, and guardrails live **only** in `project-context/*.mdc`.

| File | Purpose |
|------|---------|
| `project.mdc` | Repos, technology, Jira, default branch, constraints |
| `architecture.mdc` | System architecture, boundaries, integrations |
| `coding-standards.mdc` | Languages, frameworks, testing, review rules |
| `deployment.mdc` | Environments, cloud, deploy/rollback |
| `business-flows.mdc` | Named business flows for Flow Validation agent (7B) |

Optional stack rule files in the same folder (e.g. `java.mdc`, `play.mdc` for JVM/Play; `react.mdc` for a frontend repo). List them in `coding-standards.mdc` → `documentation.stackRules`. Not parsed into `workflowContext`.

Fill mandatory YAML fields per [`sdlc.md` § MDC](sdlc.md#mdc-and-workflow-context). Orchestrator stops with a **Missing Context Report** only when a **mandatory** field is missing; other fields may stay `TBD`.

## SDLC system files

One topic or tool per file under `sdlc-system/` — add a new file when extending workflow or integrations. Kit templates live under [`templates/`](../templates/README.md).

### Workflow (`sdlc-system/workflow/`)

| File | Topic |
|------|--------|
| [state-machine.md](../sdlc-system/workflow/state-machine.md) | States, transitions, diagram |
| [routing-logic.md](../sdlc-system/workflow/routing-logic.md) | State → agent routing |
| [approval-workflow.md](../sdlc-system/workflow/approval-workflow.md) | Two gates: `approve sdd`, `approve pr` |
| [retry-logic.md](../sdlc-system/workflow/retry-logic.md) | Retries and backoff |
| [artifact-naming.md](../sdlc-system/workflow/artifact-naming.md) | RDD/SDD paths, feature branch naming (`artifactSlug`), ephemeral artifacts |
| [entropy-management.md](../sdlc-system/workflow/entropy-management.md) | Dead/stale code policy (all agents) |
| [example-quality-gates-execution.md](../sdlc-system/workflow/example-quality-gates-execution.md) | QA → Impact Analysis → Flow Validation example |
| [project-context-bootstrap.md](../sdlc-system/workflow/project-context-bootstrap.md) | Recon repo + generate `project-context` on `start` (incl. `architecture.mdc` from project) |
| [project-context-sync.md](../sdlc-system/workflow/project-context-sync.md) | Recon + update `project-context` after every feature, before pre-PR approval |
| [filesystem-verification.md](../sdlc-system/workflow/filesystem-verification.md) | Disk-first rules — never trust memory/state for file existence |
| [pre-pr-verification.md](../sdlc-system/workflow/pre-pr-verification.md) | Pre-PR: deps, versions, compile, CI green (all work types) |
| [complete-delivery.md](../sdlc-system/workflow/complete-delivery.md) | End-to-end delivery, scope completion, file removal — all work types |

### Integrations (`sdlc-system/integrations/`)

| File | Tool | Used by |
|------|------|---------|
| [github-integration.md](../sdlc-system/integrations/github-integration.md) | GitHub (`gh`, git) | developer, pr-manager, qa, review |
| [jira-integration.md](../sdlc-system/integrations/jira-integration.md) | Jira | jira |
| [bugbot-integration.md](../sdlc-system/integrations/bugbot-integration.md) | BugBot | bugbot |

### Templates

| Path | Used by |
|------|---------|
| [templates/](../templates/README.md) | All read-only kit starter files |
| [templates/project-context/](../templates/project-context/) | MDC YAML schema for bootstrap generation → **`.cursor/project-context/`** |
| [templates/workflow/requirements-discovery-document.md](../templates/workflow/requirements-discovery-document.md) | project-discovery |
| [templates/workflow/sdd-template.md](../templates/workflow/sdd-template.md) | sdd-architect, sdd-sync |
| [templates/workflow/implementation-plan-template.md](../templates/workflow/implementation-plan-template.md) | planning |

Also: [orchestrator.md](../sdlc-system/orchestrator.md), [handoff.md](../sdlc-system/handoff.md), [agents/](../sdlc-system/agents/).

## Portable files vs per-repo

| Read-only in app repos (redeploy from kit) | Editable per application repo |
|--------------------------------------------|-------------------------------|
| `.cursor/docs/`, `.cursor/skills/`, `.cursor/templates/`, `.cursor/sdlc-system/` (except gitignored `state/`, `workflow-artifacts/`), root `AGENTS.md` | `.cursor/project-context/*.mdc` **only** |

**Agents and humans must not patch** orchestrator prompts, agent definitions, skills, or workflow specs inside application repositories. Runtime workflow state under `sdlc-system/state/` and `workflow-artifacts/` is generated locally (gitignored) — that is not kit customization.

Stack (Java, Python, Spring, Play, React, Vue, etc.) is defined in `project-context/` — not in agent prompts. Optional stack rule files (e.g. `java.mdc`, `play.mdc`) live **in `project-context/`** alongside the five required MDC files.
