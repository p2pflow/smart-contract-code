# SDLC Artifact Naming

## Shared slug (`artifactSlug`)

1. **Created by:** `project-discovery` (before writing the RDD).
2. **Source:** Business objective / feature title (RDD §1).
3. **Length:** **4–5 words maximum** (hyphen-separated tokens).
4. **Format:** lowercase kebab-case — `[a-z0-9]+(-[a-z0-9]+){3,4}`
5. **Reuse:** `sdd-architect`, `jira`, and all downstream agents **must use the same** `artifactSlug` from state/handoff — do not invent a new slug at SDD time unless discovery omitted it (orchestrator retry only).

## Filename pairs (same slug)

| Artifact | Filename | Example |
|----------|----------|---------|
| **RDD** (requirements) | `<artifactSlug>-requirements.md` | `callback-webhook-retry-requirements.md` |
| **SDD** (design) | `<artifactSlug>.md` | `callback-webhook-retry.md` |

**Do not** use generic names: `requirements.md`, `SDD.md`, `design.md`.

## Paths

| Stage | RDD | SDD |
|-------|-----|-----|
| After discovery | `docs/sdlc/<workflowId>/<artifactSlug>-requirements.md` | — |
| After sdd-architect | (unchanged) | `docs/sdlc/<workflowId>/<artifactSlug>.md` |
| After jira | (unchanged) | `docs/sdlc/<workflowId>/<EPIC-KEY>-<artifactSlug>.md` |

Only the **SDD** is renamed when the Epic is created; the RDD keeps `<artifactSlug>-requirements.md`.

## Committed vs ephemeral paths

**Only these belong under `docs/sdlc/<workflowId>/` (safe to commit):**

| Artifact | Path |
|----------|------|
| RDD | `docs/sdlc/<workflowId>/<artifactSlug>-requirements.md` |
| SDD | `docs/sdlc/<workflowId>/<artifactSlug>.md` or `<EPIC-KEY>-<artifactSlug>.md` |

**Everything else is ephemeral** — write under `.cursor/sdlc-system/workflow-artifacts/<workflowId>/` (gitignored). Do **not** commit plans, reports, PR drafts, or CI handoff notes to `docs/sdlc/`.

| Ephemeral artifact | Path |
|--------------------|------|
| Implementation plan | `workflow-artifacts/<workflowId>/implementation-plan.md` |
| Jira manifest | `workflow-artifacts/<workflowId>/jira-manifest.md` |
| Phase / delivery reports | `workflow-artifacts/<workflowId>/reports/*.md` |
| QA report | `workflow-artifacts/<workflowId>/reports/qa-report.md` |
| Impact analysis report | `workflow-artifacts/<workflowId>/reports/impact-analysis-report.md` |
| Flow validation report | `workflow-artifacts/<workflowId>/reports/flow-validation-report.md` |
| PR body (draft) | `workflow-artifacts/<workflowId>/pr-body.md` |
| Platform / CI notes | `workflow-artifacts/<workflowId>/platform-ci-handoff.md` |

**Before PR publish (`PR_PUBLICATION`):** pr-manager reads ephemeral files locally, publishes via `gh`, then **deletes** `workflow-artifacts/<workflowId>/` and removes any stray non-RDD/SDD files under `docs/sdlc/<workflowId>/`. Only RDD + SDD remain in git.

## State / handoff fields

| Field | Example |
|-------|---------|
| `artifacts.artifactSlug` | `callback-webhook-retry` |
| `artifacts.requirementsPath` | `docs/sdlc/<workflowId>/callback-webhook-retry-requirements.md` |
| `artifacts.sddPath` | `docs/sdlc/<workflowId>/callback-webhook-retry.md` |

`artifactSlug` and `sddSlug` (if present) **must be identical**. Prefer `artifactSlug` in new handoffs; `sddSlug` is an alias for the same value.

## Cross-links

- RDD header: `**Artifact slug:** \`<artifactSlug>\``
- SDD header: `**Artifact slug:** \`<artifactSlug>\`` and RDD link: `[<artifactSlug>-requirements.md](./<artifactSlug>-requirements.md)`

## Examples

| Objective (summary) | `artifactSlug` | RDD | SDD |
|---------------------|----------------|-----|-----|
| Platform runtime upgrade | `platform-runtime-upgrade` | `platform-runtime-upgrade-requirements.md` | `platform-runtime-upgrade.md` |
| Callback webhook retry | `callback-webhook-retry-design` | `callback-webhook-retry-design-requirements.md` | `callback-webhook-retry-design.md` |

## Git branch name (generic kit rule)

**Not configurable per project.** Every FE/BE repo using this `.cursor/` kit uses the same rule:

- Feature branch name = **`artifactSlug` only** (verbatim from discovery)
- One branch per feature for all phases
- No workflow id, Jira epic key, prefix, slashes, or phase suffix

| Example `artifactSlug` | Branch name |
|------------------------|-------------|
| `callback-webhook-retry` | `callback-webhook-retry` |
| `runtime-25-upgrade` | `runtime-25-upgrade` |

Do **not** add `branchPattern` to `project-context/project.mdc` — orchestrator and developer agents enforce this rule from this document.

### Base branch

New feature branches are created from the latest remote base branch. The **developer agent must run** this before `git checkout -b <artifactSlug>` (phase 0, each modifiable repo):

```bash
git fetch origin
git checkout <baseBranch>
git pull origin <baseBranch>
git checkout -b <artifactSlug>
```

| Rule | Detail |
|------|--------|
| Default base | `master` (`state.context.baseBranch`) |
| User override | At requirements time: `base branch: <name>` (e.g. `base branch: develop`) — orchestrator tells user the default and how to override |
| Agent responsibility | Always `fetch` + `pull origin <baseBranch>` before branching — do not skip |
| Later phases | Checkout existing `<artifactSlug>` and `git pull origin <artifactSlug>` — do not re-branch from base |

PR base branch for `gh pr create` uses the same `baseBranch` from workflow state / developer handoff.

Orchestrator sets `execution.branchSlug = artifacts.artifactSlug` after discovery.

## Agent responsibilities

| Agent | Rule |
|-------|------|
| **project-discovery** | Derive `artifactSlug` first; write RDD at `<artifactSlug>-requirements.md`; output `artifactSlug` + `requirementsPath` |
| **sdd-architect** | Read `artifactSlug` from inputs/state; write `<artifactSlug>.md`; link to `<artifactSlug>-requirements.md` |
| **orchestrator** | Persist `artifactSlug`, `requirementsPath`, `sddPath`, `execution.branchSlug` |
| **jira** | Rename SDD only: `<artifactSlug>.md` → `<EPIC-KEY>-<artifactSlug>.md` |
| **developer** | Branch name = `artifactSlug` only; one branch for all phases |
| **planning / qa / review / sdd-sync** | Use paths from `artifacts`; never assume `requirements.md` |
