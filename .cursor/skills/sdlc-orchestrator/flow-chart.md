# SDLC delivery flow chart

Canonical diagram for `@sdlc-orchestrator`. Two **USER** gates only; everything between runs automatically after gate 1 (`context.autoRun`).

## Kit layout (folders)

```
.cursor/
├── project-context/          LIVE per-repo MDC (created on start; editable)
├── templates/
│   ├── project-context/      MDC schema → used to generate live project-context on start
│   └── workflow/             RDD, SDD, plan scaffolds (agents read in place)
├── docs/                     kit documentation
├── skills/sdlc-orchestrator/ @sdlc-orchestrator entry + this flow chart
└── sdlc-system/              engine: orchestrator, agents, workflow, integrations
    ├── agents/               12 downstream agents
    ├── workflow/             state machine, bootstrap, artifact naming
    ├── integrations/         GitHub, Jira, BugBot
    ├── state/                runtime (gitignored)
    └── workflow-artifacts/   runtime (gitignored)
```

## Delivery diagram

```
  [start]
     │
     ▼
┌──────────────────┐
│ Bootstrap MDC    │  recon repo → generate .cursor/project-context/ (project-specific)
│ + requirements │  default base branch: master
└────────┬─────────┘  override: base branch: <name>
         │
         ▼
┌─────────────┐    ┌──────────────┐    ┌──────────────────────┐
│  Discovery  │───▶│ SDD Architect│───▶│ GATE 1               │
└─────────────┘    └──────────────┘    │ approve + scope opt  │◀── USER
                                       │ (radio) + cleanup ☐  │
                                       └──────┬───────────────┘
                                              │ approved
     ┌────────────────────────────────────────┘
     │  AUTO-RUN (no per-phase stops until gate 2)
     │  Phase 0: git pull origin <base> → branch <artifactSlug>
     ▼
┌──────┐   ┌───────┐   ┌─────────────┐   ┌────┐   ┌──────────────┐   ┌──────────────┐
│ Jira │──▶│ Plan  │──▶│ Execution   │──▶│ QA │──▶│ Impact       │──▶│ Flow         │
└──────┘   └───────┘   │ all phases  │   └────┘   │ Analysis     │   │ Validation   │
                       └─────────────┘            └──────┬───────┘   └──────┬───────┘
                                                         │                  │
                                                         └────────┬─────────┘
                                                                  ▼
                                                            ┌──────────┐
                                                            │ Draft PR │
                                                            └────┬─────┘
                                                                 ▼
                       ┌──────────────┐          ┌──────────┐
                       │ Review fixes │◀─────────│ BugBot   │
                       └──────┬───────┘          └────┬─────┘
                              │                       │
                              └───────────┬───────────┘
                                          ▼
                                    ┌──────────┐
                                    │ Review   │
                                    └────┬─────┘
                                         ▼
                              ┌────────────────────┐
                              │ Project-context sync │
                              │ deps, versions,     │
                              │ MDC, compile        │
                              └──────────┬───────────┘
                                         ▼
                              ┌────────────────────┐
                              │ BugBot (final)     │
                              └──────────┬───────────┘
                                         ▼
                              ┌────────────────────┐
                              │ CI verification    │
                              │ gh pr checks green │
                              └──────────┬───────────┘
                                         ▼
                                  ┌──────────────────────┐
                                  │ GATE 2               │
                                  │ approve / continue   │◀── USER
                                  └──────┬───────────────┘
                                         │ approved
                                         ▼
                              ┌──────────────┐   ┌───────────┐
                              │ Publish PR   │──▶│ SDD sync  │──▶ COMPLETED
                              └──────────────┘   └───────────┘
```

## Step table

| Step | State | Agent | User action |
|------|--------|-------|-------------|
| 0 | `start` | orchestrator | Provide requirements; optional `base branch: <name>` (default `master`) |
| 1 | `DISCOVERY` | project-discovery | — |
| 2 | `SDD_GENERATION` | sdd-architect | — |
| 3 | `SDD_APPROVAL` | orchestrator | **`approve`** (Option 1, no cleanup) or **`approve option 2 + cleanup`** etc. |
| 4 | `JIRA_CREATION` | jira | — |
| 5 | `PLANNING` | planning | — |
| 6 | `EXECUTION` | developer (all phases) | — |
| 7 | `QA` | qa | — |
| 8 | `IMPACT_ANALYSIS` | impact-analysis | — |
| 9 | `FLOW_VALIDATION` | flow-validation | — |
| 10 | `DRAFT_PR_CREATION` | pr-manager | — |
| 11 | `BUGBOT_REVIEW` | bugbot | — |
| 12 | `REVIEW` | review | — |
| 13 | `REVIEW_FIXES` | developer | — (loop → BugBot if needed) |
| 14 | `PROJECT_CONTEXT_SYNC` | developer | — (deps, versions, MDC, compile) |
| 15 | `BUGBOT_REVIEW` | bugbot | — (final pass on PR tip, if enabled) |
| 16 | `CI_VERIFICATION` | orchestrator | — (`gh pr checks` all green) |
| 17 | `PRE_PR_APPROVAL` | orchestrator | **`approve`** / **`continue`** / **`approve pr`** |
| 18 | `PR_PUBLICATION` | pr-manager | — |
| 19 | `SDD_SYNC` | sdd-sync | — |

**Quality reports (steps 7–9):** `qa-report.md`, `impact-analysis-report.md`, `flow-validation-report.md` under `workflow-artifacts/<workflowId>/reports/`.

**Reject gate 1** → rework SDD. **Reject gate 2** → review fixes.

**Branching (kit rule):** feature branch = `artifactSlug` only; base = `master` (or user override at step 0). One branch for all phases.

**Commands:** gates accept natural language (`approve`, `continue`, `yes`) — exact `approve sdd` / `approve pr` not required. Use `pause` / `step` to disable auto-run.
