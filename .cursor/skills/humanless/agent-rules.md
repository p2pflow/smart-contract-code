# Humanless — agent rules by phase

`@humanless` is the **parent orchestrator**. **Every phase runs as its named kit agent** — a `Task` subagent (own context) that reads the agent file on disk and returns a validated JSON handoff. The parent validates handoffs, owns state, applies caps/hard-stops, and routes; it never implements/QAs/reviews itself.

**Authoritative routing + required outputs + state:** [orchestration.md](orchestration.md). **Spine (decision boundary, Phase 0, DoD, guardrails):** `SKILL.md`. This file maps each phase to the **kit doc to read** and the **one-line rule** — read the agent file on disk before invoking it.

Parent-run directly (no agent): Phase 0 bootstrap, CI verification, secret scan, Definition of Done gate, final report.

| Phase | Read (in order) | Apply |
|-------|-----------------|-------|
| 0 | [project-context-bootstrap.md](../../sdlc-system/workflow/project-context-bootstrap.md), [orchestrator.md](../../sdlc-system/orchestrator.md) §0 | Disk-first bootstrap; MDC validate; `workflowContext` |
| 1 | [project-discovery-agent.md](../../sdlc-system/agents/project-discovery-agent.md) | RDD, `artifactSlug`, `workType`, `repoPolicy`; read-only recon |
| 1b | [sdd-architect-agent.md](../../sdlc-system/agents/sdd-architect-agent.md) | SDD; scope options — **auto-select default (Option 1)**; no cleanup unless PRD requires |
| 2 | [jira-agent.md](../../sdlc-system/agents/jira-agent.md), [jira-integration.md](../../sdlc-system/integrations/jira-integration.md) | Epic → Stories → Tasks; rename SDD to `<EPIC-KEY>-<slug>.md` |
| 3 | (parent) `architecture.mdc`, `repoPolicy` | **Lightweight** scope/repo identification only — full diff-based impact is Phase 8 |
| 4 | [planning-agent.md](../../sdlc-system/agents/planning-agent.md) | Phased plan; Jira coverage; `transformation` 6-phase pattern |
| 5 | [developer-agent.md](../../sdlc-system/agents/developer-agent.md) | One plan phase per loop; branch bootstrap; modifiable repos only |
| 6 | [qa-agent.md](../../sdlc-system/agents/qa-agent.md) | CI-evidence-first; FR/NFR matrix; complete-delivery checks |
| 7 | [review-agent.md](../../sdlc-system/agents/review-agent.md) | Review dimensions; entropy BLOCKERs; scope vs PRD |
| 8 | [impact-analysis-agent.md](../../sdlc-system/agents/impact-analysis-agent.md), [flow-validation-agent.md](../../sdlc-system/agents/flow-validation-agent.md) | Post-QA diff-based impact + flow safety score + acceptance sign-off |
| 9 | [sdd-sync-agent.md](../../sdlc-system/agents/sdd-sync-agent.md), [project-context-sync.md](../../sdlc-system/workflow/project-context-sync.md) | `history/` doc + SDD as-built sync + MDC reconciliation |
| 10 | [developer-agent.md](../../sdlc-system/agents/developer-agent.md) (sync mode), [pre-pr-verification.md](../../sdlc-system/workflow/pre-pr-verification.md), [bugbot-agent.md](../../sdlc-system/agents/bugbot-agent.md) | Compile, deps, BugBot final, secret scan, `gh pr checks` all green |
| 11 | [developer-agent.md](../../sdlc-system/agents/developer-agent.md), [artifact-naming.md](../../sdlc-system/workflow/artifact-naming.md) | Branch/commit/push; fetch+pull base first on phase 0 |
| 12 | [pr-manager-agent.md](../../sdlc-system/agents/pr-manager-agent.md), [github-integration.md](../../sdlc-system/integrations/github-integration.md) | Draft PR → BugBot (first pass) in Phase 6; publish here; **never merge** |
| 13 | [jira-agent.md](../../sdlc-system/agents/jira-agent.md) | Jira update with PR URL and summaries |

## Shared workflow docs (all phases)

| Topic | File |
|-------|------|
| Complete delivery | [complete-delivery.md](../../sdlc-system/workflow/complete-delivery.md) |
| Entropy | [entropy-management.md](../../sdlc-system/workflow/entropy-management.md) |
| Filesystem verification | [filesystem-verification.md](../../sdlc-system/workflow/filesystem-verification.md) |
| Artifacts / branch naming | [artifact-naming.md](../../sdlc-system/workflow/artifact-naming.md) |
| MDC spec | [sdlc.md](../../docs/sdlc.md) |

`workType`, `repoPolicy`, branch naming, artifact paths, and BugBot passes are specified in `SKILL.md` and [orchestration.md](orchestration.md) — not duplicated here.
