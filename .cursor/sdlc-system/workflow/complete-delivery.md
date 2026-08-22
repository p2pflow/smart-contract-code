# Complete delivery

**Every requirement** must result in a **working, end-to-end deliverable** in modifiable repos — not partial edits, not config-only stubs, not “left for later.”

Applies to **all** `workType` values. Stack-specific checklists live only in optional `project-context` stack rules (`codingStandards.documentation.stackRules`), never hardcoded in agent prompts.

## Definition of done

A workflow is **not complete** until:

| # | Criterion |
|---|-----------|
| 1 | **Acceptance criteria** from the RDD are satisfied in running code (verified by CI, local tests per MDC, or documented staging proof) |
| 2 | **All SDD in-scope layers** are implemented — every path in `architecture.layers` touched when the change affects that layer |
| 3 | **Tests** for changed behavior exist or are updated; test suite status recorded per MDC |
| 4 | **Superseded artifacts removed** — old files, routes, handlers, config keys, and tests deleted when replaced (see [entropy-management.md](entropy-management.md)) |
| 5 | **No dangling references** — no imports, routes, or config pointing at deleted code |
| 6 | **Not config-only** when source change is required — if SDD/plan lists application or test changes, a diff that only touches build/config files **fails** QA and review |

## Work types

Set in discovery (`outputs.workType` → `state.context.workType`):

| `workType` | Meaning | Delivery scope |
|------------|---------|----------------|
| `feature` | New or changed product behavior | All layers SDD specifies for the feature |
| `transformation` | Runtime, framework, dependency, or repo-wide technical change | **Entire affected codebase** — build, config, source, tests, CI; large diffs expected |
| `bugfix` | Defect repair | Minimal path to fix + regression tests |
| `refactor` | Structure change without new behavior | All touched modules; delete superseded paths |

**`transformation` triggers (examples only):** version upgrade, framework migration, dependency uplift, “modernize”, “upgrade to latest”, EOL runtime.

Do **not** encode stack-specific migrations (package renames, framework APIs) in this document — define them in the **SDD** and optional **stack rules** for that repo.

## Scope options (user chooses at SDD gate)

When a requirement has more than one reasonable scope, the **SDD § 1b** presents **radio options** (single-select) so the user decides how far to go:

- Options ordered **smallest → largest**; **Option 1 is the default**.
- Each option lists what it **includes** and **excludes**.
- A standing **cleanup checkbox** — "Remove unused files and dead code" — is offered, **unchecked by default**.

The user selects an option (and optionally checks cleanup) when approving the SDD. The orchestrator records `approvals.sdd.scopeSelection` and `approvals.sdd.cleanup` and passes both to planning, developer, qa, and review.

| Field | Effect |
|-------|--------|
| `scopeSelection` | Bounds planning and the diff — do not deliver a broader option than chosen |
| `cleanup: true` | Planning adds a cleanup phase; developer removes unused files/dead code in the affected area |
| `cleanup: false` | Apply only `remove-on-touch` entropy (no broad cleanup) |

**Generic example** (version/dependency change): Option 1 = upgrade target only; Option 2 = upgrade target + latest compatible dependencies. Cleanup checkbox toggles removal of unused files. Default = Option 1, cleanup off.

## Partial delivery is a failure

| Anti-pattern | Agent response |
|--------------|----------------|
| Only build/config files changed; no source/tests | QA **fail**; review **BLOCKER** |
| New path added; old path left in place | Developer must **delete** old path; review **BLOCKER** if still in diff |
| Phase goals skipped | Orchestrator does not accept `READY_FOR_QA` |
| “Will fix in follow-up” without SDD waiver | Not allowed — complete in this workflow or document explicit `outOfScope` in RDD with user approval |

## Agent responsibilities

| Agent | Complete delivery duty |
|-------|------------------------|
| **project-discovery** | Set `workType`; acceptance criteria must include **working end state**; for `transformation`, baseline inventory (current vs target, affected modules/layers) |
| **sdd-architect** | Scope table: layers, files/packages, **artifacts to remove**; verification checklist (from SDD, not hardcoded stack rules) |
| **planning** | Phases cover full scope; include **cleanup/removal** goals; `transformation` uses [phase pattern](#transformation-phase-pattern) |
| **developer** | Implement **all** phase goals; **delete** superseded files; list deletions in implementation summary; no `READY_FOR_QA` until complete |
| **qa** | Verify acceptance criteria + scope coverage + no config-only when source required; check deletion list vs SDD |
| **review** | Block partial scope, orphaned files, superseded code left behind |
| **orchestrator** | Reject `READY_FOR_QA` when summary shows incomplete scope; pass `workType` to all downstream agents |

## Baseline inventory (`transformation` only)

RDD section **§ Technical baseline** (generic):

| Field | Content |
|-------|---------|
| Current state | Versions, stack, module layout (from repo inspection) |
| Target state | What “done” means technically |
| Affected layers | From `architecture.layers` |
| Artifacts likely removed | Superseded configs, modules, adapters (estimate) |

## SDD required sections

For **all** work types when scope is non-trivial:

1. **Scope table** — layer → packages/paths → create / modify / **delete**
2. **Verification checklist** — how to prove done (tests, smoke, CI commands from MDC)
3. **Removal list** — files, routes, config keys, tests to delete when superseded

For **`transformation`**, also:

4. **Target state table** — runtime, framework, dependencies (repo-specific)
5. **Change inventory** — categories of code change (derive from recon — not from kit hardcoding)

## Transformation phase pattern

Planning **must** include phases that touch **source and tests**, not only toolchain:

| Phase | Goals |
|-------|--------|
| 1 — Toolchain & build | Build files, CI, container base images |
| 2 — Dependencies | Lockfiles, BOMs, plugins |
| 3 — Runtime & config | Framework config, env, feature flags |
| 4 — Application source | **All** production code in SDD scope |
| 5 — Tests | Unit/integration tests updated or added |
| 6 — Cleanup & release | **Delete** superseded files; docs; rollout |

Phases 4–6 are mandatory for `transformation`. Phase 6 must list concrete deletion goals.

## Developer rules

### All work types

- Implement **every** phase goal before handoff.
- **Delete** superseded files when replacing — do not leave parallel dead implementations.
- Record in implementation summary: **files deleted**, **routes removed**, **config keys dropped**.
- Satisfy acceptance criteria; **code must be written**.
- **Pre-PR (all work types):** reconcile dependencies/versions, run minimum compile, **`gh pr checks` green** — [pre-pr-verification.md](pre-pr-verification.md). During execution, defer extra test commands to CI when `runLocally: false`.

### `transformation` (overrides “minimal diff”)

- Touch every file/package in SDD scope; wide diffs are expected.
- Order: toolchain → dependencies → config → **source** → **tests** → **cleanup**.
- Same pre-PR gates as all work types; recommend `runLocally: true` during execution for faster fix loops.
- Stack-specific migration checks live in **SDD** and optional stack rule MDC — not hardcoded in the kit.

### Entropy (mandatory)

Per [entropy-management.md](entropy-management.md):

- Remove unused imports, dead classes, orphaned tests, stale config.
- When a file is fully superseded, **delete the file** — not only stop referencing it.
- `transformation` phases must include explicit removal goals.

## Verification (QA + review)

| Check | When |
|-------|------|
| Acceptance criteria | Always |
| SDD scope table fully addressed | Always |
| Deletion list executed | When SDD/plan lists removals |
| Config-only diff | **Fail** if SDD required source/test changes |
| Orphan routes/config | **Fail** if they reference deleted code |

## Orchestrator

On discovery, if `workType === "transformation"`:

> This is a technical transformation. Delivery includes **build, config, all affected source and tests, and removal of superseded files** — not config-only. Pre-PR: **dependencies/versions reconciled, compile pass, CI green** ([pre-pr-verification.md](pre-pr-verification.md)). Recommend `runLocally: true` during execution for faster fix loops.

## References

- [entropy-management.md](entropy-management.md)
- [artifact-naming.md](artifact-naming.md)
- [planning-agent.md](../agents/planning-agent.md)
- [developer-agent.md](../agents/developer-agent.md)
