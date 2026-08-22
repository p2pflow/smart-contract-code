# Project-context sync (before pre-PR approval)

**Runs after engineering review passes** and **before** `PRE_PR_APPROVAL`. Reconciles `.cursor/project-context/*.mdc` with the as-built branch, verifies **dependencies, versions, compatibility, and compile** — then orchestrator runs **CI verification**.

Spec: [pre-pr-verification.md](pre-pr-verification.md).

## Why this exists

Bootstrap ([project-context-bootstrap.md](project-context-bootstrap.md)) runs only when MDC files are **missing** — it never overwrites existing files. After any feature, build files, dependencies, and routes can change while MDC and `workflowContext` stay stale.

## When to run

| Trigger | Action |
|---------|--------|
| `REVIEW` → `READY_FOR_PRE_PR` | **Always** — developer `mode: project-context-sync` |
| All `workType` values | **Mandatory** — block pre-PR until sync + compile pass and CI green |

```
REVIEW (READY_FOR_PRE_PR) → PROJECT_CONTEXT_SYNC → BUGBOT_REVIEW (final, if enabled) → CI_VERIFICATION → PRE_PR_APPROVAL
```

On `PROJECT_CONTEXT_SYNC_FAILED` → `REVIEW_FIXES` or `EXECUTION`.

## Procedure (developer, `mode: project-context-sync`)

### Step 1 — Recon as-built branch

Re-read the **feature branch** per [project-context-bootstrap.md](project-context-bootstrap.md) § Step 2:

| Signal source | Compare against MDC |
|---------------|---------------------|
| Build files (`pom.xml`, `build.sbt`, `package.json`, …) | `technology.*`, `dependencies.*` |
| Lock files / BOM / version catalogs | Declared dependency versions |
| `.java-version`, CI workflows, Docker bases | `languageVersions`, CI JDK/runtime |
| Source tree, routes | `architecture.mdc`, `business-flows.mdc` |
| Test tree | `coding-standards.mdc` → `testing.*` |
| Stack rule files | `coding-standards.mdc` → `documentation.stackRules` |

### Step 2 — Dependencies and versions

1. Extract **direct dependencies** and **language/framework versions** from as-built build files.
2. Diff against `project.mdc` → `technology`, `dependencies`, and related deployment CI fields.
3. **Update MDC** with current versions — list every change in the sync report (`was → now`).
4. If the feature changed dependencies in build files but MDC still lists old versions → update before handoff.

### Step 3 — Diff and update live MDC

For each file under `.cursor/project-context/`:

1. Parse YAML; list drift vs recon.
2. **Update** stale fields (sync may overwrite — unlike bootstrap).
3. Preserve org-specific fields (`jira.projectKey`, etc.) unless the feature changed them.
4. Create missing stack rule files from kit template when stack detected and file absent.

**Minimum fields to keep current after any build-touching feature:**

| File | Fields |
|------|--------|
| `project.mdc` | `languageVersions`, `frameworks`, `dependencies`, `agentVerification.ciCommands` |
| `deployment.mdc` | CI images, workflow compile/test steps |
| Stack rules (if present) | `targetVersion`, `buildFiles`, `verify` / `verification` |

### Step 4 — Compatibility (repo-defined)

Read `codingStandards.documentation.stackRules`. For each listed stack MDC file:

1. Run `verify` / `verification` entries defined **in that repo's file** (and SDD checks when listed).
2. Record pass/fail in sync report.
3. Blocking failures → `PROJECT_CONTEXT_SYNC_FAILED`.

No stack rules → proceed; **compile** (Step 5) is the compatibility proof.

### Step 5 — Compile verification (all work types)

**Mandatory** — [pre-pr-verification.md](pre-pr-verification.md) § Compile.

1. Run `agentVerification.ciCommands.compile`, or default for `technology.buildTool` (`sbt compile`, `mvn -q compile -DskipTests`, etc.).
2. On failure → fix and re-run, or `PROJECT_CONTEXT_SYNC_FAILED`.
3. Write `compile-verification-report.md` with `status: pass` before `PROJECT_CONTEXT_SYNCED`.

**Overrides** `runLocally: false` for this step only.

### Step 6 — Commit MDC updates

If `.cursor/project-context/` changed:

```bash
git add .cursor/project-context
git commit -m "chore(sdlc): sync project-context after <EPIC-KEY> <short feature>"
git push origin HEAD
```

Record SHA in sync report.

### Step 7 — Write sync report

Path: `.cursor/sdlc-system/workflow-artifacts/<workflowId>/reports/project-context-sync-report.md`

```markdown
# Project-context sync

**Workflow:** `<workflowId>`
**Branch:** `<branch>`
**workType:** `<workType>`

## Dependencies & versions

| Component | Was (MDC) | Now (build) | MDC updated |
|-----------|-----------|-------------|-------------|
| Java | 8 | 25 | yes |

## Drift (other MDC)

| File | Field | Was | Now | Updated |

## Compatibility (stack rules)

| Check | Status | Notes |

## Compile

| Command | Status |
|---------|--------|
| `sbt compile` | pass |

See `compile-verification-report.md`.

## MDC commit

`<sha>` or "no changes"

## Result

`PROJECT_CONTEXT_SYNCED` | `PROJECT_CONTEXT_SYNC_FAILED`
```

### Handoff statuses

| Status | Meaning | Next state |
|--------|---------|------------|
| `PROJECT_CONTEXT_SYNCED` | MDC current; deps/versions reconciled; compile pass | `BUGBOT_REVIEW` (final) if `bugbot.enabled`; else `CI_VERIFICATION` |
| `PROJECT_CONTEXT_SYNC_FAILED` | Drift, failed stack check, or compile fail | `REVIEW_FIXES` or `EXECUTION` |

## Orchestrator — gate 2 package

Include: sync report, compile report, CI check table ([approval-workflow.md](approval-workflow.md)).

## Relation to bootstrap

| | Bootstrap (`start`) | Sync (before pre-PR) |
|--|---------------------|----------------------|
| When | Missing MDC only | Every feature |
| Overwrite | Never | Yes — stale fields |
| Compile | No | **Yes — always** |
