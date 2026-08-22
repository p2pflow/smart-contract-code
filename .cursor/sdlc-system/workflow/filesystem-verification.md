# Filesystem verification (disk-first)

Agents must treat the **repository filesystem** as the only source of truth for whether a path exists. Do **not** infer existence from chat memory, prior turn summaries, open editor tabs, `state/*.json`, cached `workflowContext`, or flags like `projectContextBootstrapped`.

## Rule

Before **reading**, **loading**, **citing**, or **skipping bootstrap** for any path:

1. **Verify on disk** — use `Glob`, `Read`, or a shell `test -f` / `ls` in the workspace.
2. **If the tool reports missing** — the file does **not** exist. Regenerate, fail, or report missing. Never say "already present".
3. **If state or memory disagrees with disk** — **disk wins**. Clear stale state flags and fix.

## What is NOT proof a file exists

| Source | Why unreliable |
|--------|----------------|
| Earlier message in the chat | User may have deleted files since |
| `state.workflowContext` | Persisted from a prior session; may be stale |
| `context.projectContextBootstrapped: true` | Set when files were generated earlier; user may have deleted them |
| `.cursor/templates/project-context/` | Schema only — not live config |
| "We bootstrapped on start" in a summary | Must re-check disk on every `start` / `resume` |

## Project-context (`.cursor/project-context/`)

**Required live files** (all six must exist on disk before MDC load):

- `README.md`
- `project.mdc`
- `architecture.mdc`
- `coding-standards.mdc`
- `deployment.mdc`
- `business-flows.mdc`

### On every `start`

1. **Glob or list** `.cursor/project-context/` in the workspace.
2. For **each** required file, confirm it exists on disk (not in templates).
3. If the folder or **any** required file is missing → run bootstrap for **missing files only** ([project-context-bootstrap.md](project-context-bootstrap.md)).
4. Set `projectContextBootstrapped: true` only when files were **generated this run**; set `false` if all six were already on disk.
5. If `state` from a prior run says bootstrapped but disk is empty → **ignore state**; bootstrap.

### On every `resume`

Before continuing from `currentState`:

1. Re-run the same disk check for all six required MDC files.
2. Bootstrap any missing files.
3. **Re-read** all MDC from disk and rebuild `workflowContext` — do not reuse `state.workflowContext` without fresh reads.

### On MDC load (§0.1)

- **Read** each file from `.cursor/project-context/`.
- If `Read` fails → treat as `MDC_INCOMPLETE`; bootstrap missing file or stop with Missing Context Report.
- Never populate `workflowContext` from memory or templates.

## Workflow artifacts

Before citing a report in a handoff, approval prompt, or user message:

| Artifact | Typical path |
|----------|----------------|
| QA report | `.cursor/sdlc-system/workflow-artifacts/<workflowId>/reports/qa-report.md` |
| Review summary | `.../reports/review-summary.md` |
| Project-context sync | `.../reports/project-context-sync-report.md` |
| State file | `.cursor/sdlc-system/state/<workflowId>.json` |

If the path is missing on disk → do not claim it exists; regenerate the artifact or route to the agent that produces it.

## User-visible reporting

When reporting bootstrap status, list each required file with status from **this run's disk check**:

- `present` — verified on disk
- `generated` — created this run
- `missing` — not on disk (bootstrap or stop)

Never report `already present` without a successful disk read in the current session.
