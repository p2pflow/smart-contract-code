# Pre-PR verification (all work types)

**Runs before `PRE_PR_APPROVAL` for every feature** — `feature`, `bugfix`, `refactor`, and `transformation`.

Code review alone cannot prove dependencies resolve, versions match the build, or the project compiles. This gate reconciles **as-built facts** with MDC, runs **compile**, then requires **CI green**.

## Requirements before gate 2

| # | Requirement | Who | When | Evidence |
|---|-------------|-----|------|----------|
| 1 | **Dependencies & versions** | Developer — project-context sync | After review | `project-context-sync-report.md` — drift table; MDC updated |
| 2 | **Compatibility** | Developer — stack rules (if any) + compile | Same step | Stack `verify` results; compile catches toolchain mismatches |
| 3 | **Local compile** (minimum) | Developer — project-context sync | Same step | `compile-verification-report.md` — `status: pass` |
| 4 | **CI PR checks green** | Orchestrator — `CI_VERIFICATION` | Before gate 2 | `gh pr checks` all `pass`; `state.ciVerification` |

**No waiver** for (3) or (4) unless user explicitly says `waive compile` / `waive ci` with justification in `state.waivers`.

## Pipeline position

```
REVIEW (READY_FOR_PRE_PR)
  → PROJECT_CONTEXT_SYNC (MDC + deps/versions + compile)
  → BUGBOT_REVIEW (final pass on PR tip — when bugbot.enabled)
  → CI_VERIFICATION (gh pr checks green)
  → PRE_PR_APPROVAL (user)
  → PR_PUBLICATION
```

**BugBot before gate 2:** First BugBot runs after draft PR (before engineering review). **Final BugBot** runs after project-context sync so gate 2 never approves publish on a PR tip BugBot has not scanned (sync may push new commits).

Spec for sync procedure: [project-context-sync.md](project-context-sync.md).

---

## 1. Dependencies and versions

### Recon sources (as-built branch)

Read current build and lock files — do not trust MDC or chat memory:

| Source | Extract |
|--------|---------|
| `pom.xml`, `build.gradle*`, `build.sbt`, `project/*.sbt` | Language version, framework versions, direct dependencies |
| `package.json`, `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml` | Runtime, deps, engines |
| `pyproject.toml`, `requirements.txt`, `poetry.lock` | Python version, packages |
| `go.mod`, `Cargo.toml`, `Gemfile.lock` | Module versions |
| `.java-version`, `.tool-versions`, CI workflow JDK/node images | Runtime pins |
| `Dockerfile`, `docker-compose.yml` | Base image tags |

### Reconcile with MDC

Update live `.cursor/project-context/project.mdc` (and stack rules when applicable):

- `technology.languageVersions`
- `technology.frameworks` (name + version when inferable)
- `dependencies.external` / `dependencies.internal`
- `agentVerification.ciCommands`
- `deployment.mdc` CI JDK/runtime images when changed

List every drift in the sync report: **was → now → updated yes/no**.

### On unresolved drift

- Build file shows new major dependency or version bump but MDC not updated → fix MDC before `PROJECT_CONTEXT_SYNCED`.
- Obvious incompatibility in declared ranges (document in report) → `PROJECT_CONTEXT_SYNC_FAILED` or fix before handoff.

---

## 2. Compatibility

The kit does **not** hardcode framework rules. Compatibility is established by:

1. **Repo-defined checks** — `verify` / `verification` in stack rule MDC (`coding-standards.mdc` → `documentation.stackRules`) and SDD migration sections.
2. **Compile** — authoritative proof that dependencies, annotation processors, and APIs work together on the target toolchain.

Run stack checks before compile when listed; record in sync report.

---

## 3. Local compile (mandatory — all work types)

**Overrides** the default “no local build” rule in [sdlc.md](../../docs/sdlc.md) § MDC agent rules for the **pre-PR sync step** on every workflow.

### When

During `PROJECT_CONTEXT_SYNC` (`inputs.mode: project-context-sync`), after dependency/version reconciliation and stack checks, **before** `PROJECT_CONTEXT_SYNCED`.

### Command (from MDC — in order)

1. `projectContext.agentVerification.ciCommands.compile`
2. Else infer from `technology.buildTool`:
   - `sbt` → `sbt compile`
   - `maven` → `mvn -q compile -DskipTests`
   - `gradle` → `./gradlew compileJava`
   - `npm` → `npm run build` only if that is the repo’s compile step per MDC/README
3. Record exact command in report.

### On failure

Fix per compile output, SDD, and stack rules; re-run until pass or return `PROJECT_CONTEXT_SYNC_FAILED`.

### `runLocally` in `project.mdc`

| Setting | Pre-PR sync | During execution |
|---------|-------------|------------------|
| `runLocally: false` | **Compile still required** at sync | Defer other test commands to CI |
| `runLocally: true` | Compile at sync | May also compile during phases |

### Report

Path: `.cursor/sdlc-system/workflow-artifacts/<workflowId>/reports/compile-verification-report.md`

```markdown
# Compile verification

**Command:** `<command>`
**Status:** pass | fail
**workType:** `<workType>`
**Toolchain:** <JDK/node/etc. from build or env>
**Output excerpt:** <errors or last lines>
```

---

## 4. CI PR checks green (mandatory — all work types)

Orchestrator runs **after** `PROJECT_CONTEXT_SYNCED`, **before** `PRE_PR_APPROVAL`.

```bash
gh pr checks <pr-number> --repo <org>/<repo>
gh pr checks <pr-number> --repo <org>/<repo> --watch
```

- **All checks `pass`.** Pending → poll or wait — **do not** open gate 2.
- Failed → `REVIEW_FIXES` / `EXECUTION`; re-enter `CI_VERIFICATION` after push.

Persist `state.ciVerification` (`allGreen`, `checks[]`, `verifiedAt`).

---

## Transformation (`workType: transformation`)

Same gates as above — **not a subset**. Additionally:

- Wider MDC refresh scope (all layer paths, stack rules, CI JDK).
- SDD must include migration verification; stack rule files expected when upgrading JVM/frameworks.
- See [complete-delivery.md](complete-delivery.md) for phase pattern.

---

## References

- [project-context-sync.md](project-context-sync.md)
- [approval-workflow.md](approval-workflow.md) § Gate 2
- [complete-delivery.md](complete-delivery.md)
- [filesystem-verification.md](filesystem-verification.md)
