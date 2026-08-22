# Humanless — phase details (1–13)

Detailed per-phase actions for `@humanless`. Read alongside `SKILL.md` (spine), [orchestration.md](orchestration.md) (multi-agent routing + handoff contract + state), and [agent-rules.md](agent-rules.md) (phase → kit agent mapping).

**Each phase is invoked as its named agent** (a `Task` subagent with its own context) that reads the referenced agent file on disk and returns a validated JSON handoff to the parent — see [orchestration.md](orchestration.md). The parent validates the handoff, persists state, applies caps/hard-stops, and routes. The sections below describe what each agent must produce.

---

## PHASE 1 — REQUIREMENT ANALYSIS

**Read:** [project-discovery-agent.md](../../sdlc-system/agents/project-discovery-agent.md)

Input (any form):
- PRD/requirement document as an **attachment** (`.md`, `.pdf`, …), **pasted text**, or a **free-text description** in chat.
- Completeness matters more than format — if the input is thin or ambiguous, use the **clarification budget** below before proceeding.

Actions:

1. Read and analyze the entire requirement document.
2. Extract:
   - Business objective
   - Feature requirements
   - Functional requirements
   - Non-functional requirements
   - Acceptance criteria
   - Dependencies
   - Constraints
   - Risks
3. Identify missing or ambiguous requirements.
4. Detect conflicts or unclear behavior.
5. **Classify `workType`:** `feature` \| `transformation` \| `bugfix` \| `refactor`
6. **Derive `artifactSlug`** (4–5 word kebab-case) — used for branch name, artifacts
7. **Read-only repo recon** against `architecture.layers` and `packageRoots`
8. **Write RDD** to `docs/sdlc/<workflowId>/<artifactSlug>-requirements.md` (template: [requirements-discovery-document.md](../../templates/workflow/requirements-discovery-document.md))
9. For `transformation`: include RDD § Technical baseline (current vs target inventory)

**Clarification budget (batch, don't drip):** front-load **all** clarification questions here. If critical information is missing, ambiguous, or conflicting:
- Compile **one consolidated list** of questions.
- Stop execution and ask them together — do not proceed part-way and stop again per question.
- If new ambiguity is genuinely discovered in a later phase (3/4/5/8), stop **once** with a consolidated list rather than repeated single-question stops.

Create a requirement understanding summary before implementation.

### Phase 1b — SDD generation (autonomous, no gate)

**Read:** [sdd-architect-agent.md](../../sdlc-system/agents/sdd-architect-agent.md)

- Write SDD to `docs/sdlc/<workflowId>/<artifactSlug>.md`
- Include scope table, removal list, verification checklist, mermaid diagrams
- Present scope options internally — **auto-select default (Option 1)**; `cleanup: false` unless PRD explicitly requires removal of unused code
- Record `scopeSelection` and `cleanup` for planning, implementation, QA, review

---

## PHASE 2 — JIRA CREATION

**Read:** [jira-agent.md](../../sdlc-system/agents/jira-agent.md)

**Precondition:** SDD exists (Phase 1b).

Create a Jira issue for the requirement.

The Jira must contain:

- Clear title
- Business context
- Requirement summary
- Acceptance criteria
- Technical impact summary
- Labels/components if applicable
- Relevant metadata from PRD
- Labels: `sdlc-workflow`, `workflowId:<uuid>`

Create hierarchy: **Epic → Stories → Tasks** mapped to SDD components.

**Rename SDD:** `<artifactSlug>.md` → `<EPIC-KEY>-<artifactSlug>.md`

The Jira becomes the single tracking reference for the implementation.

**Manifest-only fallback:** when `jira.enabled: false` or `jira.projectKey` is `TBD`, pass `inputs.jiraDryRunApproved: true`. The agent writes `jira-manifest.md` instead of calling Jira, the SDD keeps its `<artifactSlug>.md` name, and the pipeline continues. Never stop the workflow or ask for Jira credentials.

---

## PHASE 3 — SCOPE IDENTIFICATION (lightweight, parent-run)

**Purpose:** identify **where** the change lands so planning can be scoped — **not** a full impact analysis. The authoritative, diff-based impact analysis runs post-QA in **Phase 8** (`impact-analysis` agent). Do **not** duplicate it here.

Identify (from `repoPolicy`, `architecture.mdc`, and the SDD — no code changes yet):

- Relevant repository/repositories (`repoPolicy.modifiable`)
- Applications/services, modules/components likely touched
- APIs, data, config, and feature flags in scope
- Obvious security or infra considerations to plan for

Write a short `scope-notes.md` to workflow-artifacts as planning input. Keep it brief — deep analysis (risk level, breaking-change count, diff-based) is Phase 8.

---

## PHASE 4 — IMPLEMENTATION PLANNING

**Read:** [planning-agent.md](../../sdlc-system/agents/planning-agent.md)

Before modifying code, create an implementation plan.

The plan must include:

- Proposed architecture changes
- Files expected to change
- Components impacted
- Implementation sequence (phased — one developer loop per phase)
- Jira task → phase mapping (100% coverage)
- Testing strategy
- Risks
- Rollback strategy
- Cleanup/removal goals when SDD lists artifacts to remove or `cleanup: true`
- For `transformation`: 6-phase pattern (toolchain → source → tests → config → CI → cleanup)

Write plan to `.cursor/sdlc-system/workflow-artifacts/<workflowId>/implementation-plan.md`.

Bound delivery by `scopeSelection` — do not exceed chosen SDD scope.

Only proceed after the plan is internally validated.

---

## PHASE 5 — CODE IMPLEMENTATION

**Read:** [developer-agent.md](../../sdlc-system/agents/developer-agent.md), [complete-delivery.md](../../sdlc-system/workflow/complete-delivery.md)

Implement the requirement **one plan phase per loop**.

Rules:

- Modify only code required by the PRD/SDD in **`repoPolicy.modifiable`** repos.
- Follow existing architecture patterns (`architecture.layers`).
- Follow existing coding standards and stack rules.
- Do not introduce unrelated refactoring.
- Do not modify unrelated repositories/files.
- Maintain backward compatibility unless explicitly required.
- **Phase 0 git:** `git fetch origin && git checkout <baseBranch> && git pull origin <baseBranch> && git checkout -b <artifactSlug>`
- **Branch name = `artifactSlug` only** — [artifact-naming.md](../../sdlc-system/workflow/artifact-naming.md)
- **Delete superseded files** when replacing; list deletions in implementation summary
- Commit bootstrapped `project-context/` on phase 0 when `projectContextBootstrapped`
- Do not claim tests passed without CI evidence unless `runLocally: true`

### Delivery-safety defaults

- **Feature flag first** — when the PRD implies gradual rollout or the change is risky, gate new behavior behind a flag **defaulting off**.
- **Backward compatibility** — API changes must be **additive or versioned** unless the PRD explicitly authorizes a breaking change.
- **Migrations reversible** — every DB/schema migration must be backward-compatible and include documented rollback steps. **No destructive DDL** (drop/rename column/table, data deletion) without explicit PRD authorization → otherwise hard-stop.
- **Blast-radius check** — if the diff grows materially beyond the plan's estimated files, or would touch a repo outside `repoPolicy.modifiable`, **stop** and report (see SKILL.md § Autonomous decision boundary).
- **Multi-repo coordination** — when `repoPolicy.modifiable` spans multiple repos, create one `artifactSlug` branch **per repo**, land contract/producer changes before consumers, and open coordinated PRs cross-linked by Jira epic. Never leave a consumer repo referencing an unmerged contract.

Validate:

- Correctness
- Maintainability
- Error handling
- Logging
- Security considerations
- Performance considerations

Write `implementation-summary.md` to workflow-artifacts when all phases complete.

---

## PHASE 6 — TESTING

**Read:** [qa-agent.md](../../sdlc-system/agents/qa-agent.md)

**↳ Run as an independent `Task` subagent** (`generalPurpose`, fresh context) — see SKILL.md § Execution model. Give it the branch, diff range, RDD, SDD, acceptance criteria, and `qa-agent.md` to read on disk. Do **not** pass the implementer's self-assessment or the expected verdict. It returns `{ passed, failedRequirements[], qaReportPath }`; the parent applies caps and does any fixes.

The tests themselves (unit/integration/etc.) are authored by the **parent** in Phase 5; the QA subagent **validates** coverage and results independently.

Create/update tests as required.

Cover:

- Unit tests
- Integration tests
- API tests
- UI tests (if applicable)
- Regression tests
- Performance tests (if applicable)
- Security tests (if applicable)

Ensure:

- Existing tests continue passing (CI evidence — do not trust local claims alone).
- New functionality has sufficient coverage.
- Test coverage is maintained or improved.
- FR/NFR traceability matrix in `qa-report.md`.
- **Fail** config-only delivery when source/tests required ([complete-delivery.md](../../sdlc-system/workflow/complete-delivery.md)).
- Verify SDD deletion list executed.

Also verify **NFRs** extracted in Phase 1 (performance budgets, logging, metrics/alerts, security). If an NFR is testable and unmet → treat as QA fail.

Run all relevant test suites per `agentVerification` — locally only when `runLocally: true`; otherwise record CI commands.

If QA fails → return to Phase 5 with `retryFeedback`. **Cap: 2 QA→implementation cycles** — on the 3rd failure, hard-stop and report failing requirements (see SKILL.md § Autonomous decision boundary).

### Draft PR + BugBot (first pass) — before Phase 7

**Read:** [pr-manager-agent.md](../../sdlc-system/agents/pr-manager-agent.md), [bugbot-agent.md](../../sdlc-system/agents/bugbot-agent.md)

After QA passes (parent pushes the branch):

1. Push branch; `gh pr create --draft` with minimal body
2. **↳ Subagent** (`generalPurpose`, reads `bugbot-agent.md`) runs BugBot **first pass** on the draft PR and returns `{ actionableFindingCount, findings[], bugbotReportPath }`.
3. If `actionableFindingCount > 0` → the **parent** applies fixes, re-pushes, and re-spawns the BugBot subagent. **Cap: 3 cycles** — if findings remain, hard-stop and report.

---

## PHASE 7 — CODE REVIEW & VALIDATION

**Read:** [review-agent.md](../../sdlc-system/agents/review-agent.md)

**Precondition:** Draft PR exists; BugBot first pass complete (or waived).

**↳ Run as an independent `Task` subagent** (`generalPurpose`, fresh context). Give it the diff, RDD, SDD, QA/impact/BugBot report paths, and `review-agent.md` to read on disk — **review the diff cold**, do not inherit the implementer's reasoning. It returns `{ blockingCount, findings[], reviewSummaryPath }`. The **parent** fixes BLOCKERs; the review subagent never edits code.

Perform a complete review incorporating QA results, Phase 3 scope notes, and BugBot findings. (Full diff-based impact + flow validation run next, in Phase 8.)

Verify:

- Only PRD-related changes exist.
- No accidental file modifications.
- No unnecessary refactoring.
- No dead code.
- No duplicate code.
- No debugging statements.
- No temporary code.
- No commented-out unused code.
- No TODOs introduced without justification.
- Scope matches `scopeSelection`; no config-only partial delivery.
- Superseded files deleted per SDD.
- `entropy.blockReview` items → BLOCKER.

Check:

- Security
- Performance
- Scalability
- Error handling
- API compatibility

Severity-tag findings (BLOCKER / MAJOR / MINOR). Fix BLOCKERs before proceeding.

The final code must strictly match the requirement document.

---

## PHASE 8 — QA VALIDATION (impact + flow + acceptance)

**Read:** [impact-analysis-agent.md](../../sdlc-system/agents/impact-analysis-agent.md), [flow-validation-agent.md](../../sdlc-system/agents/flow-validation-agent.md)

**↳ Run as two independent `Task` subagents in parallel** (`generalPurpose`, fresh contexts) — impact analysis and flow validation have no dependency, so spawn both in one turn. Each reads its agent file on disk and works from the diff. Impact returns `{ riskLevel, breakingChangeCount, impactAnalysisReportPath }`; flow returns `{ flowSafetyScore, reviewRequired, flowValidationReportPath }`. The **parent** reads both reports and applies routing (hard-stop on CRITICAL; retry on flow FAIL within cap).

### Post-QA impact analysis

- Diff-based analysis: `git diff origin/<baseBranch>...HEAD`
- Assess impact across **all** categories:
  - Repositories / applications / services affected
  - Modules / components affected
  - APIs affected
  - Database impact
  - Infrastructure impact
  - Configuration changes
  - Feature flags
  - Security impact
  - Documentation impact
  - Test impact
- Assign `riskLevel`: LOW \| MEDIUM \| HIGH \| CRITICAL; count breaking changes
- Stop on CRITICAL unless PRD accepts risk

### Flow validation

- Load flows from `business-flows.mdc`
- Per-flow status: UNAFFECTED \| AT_RISK \| LIKELY_BROKEN \| UNKNOWN
- **Flow Safety Score** 0–100: 0–60 FAIL; 61–80 REVIEW REQUIRED; 81–100 PASS
- Write `flow-validation-report.md`

### Acceptance sign-off

Validate:

- All acceptance criteria are satisfied.
- Feature works as expected.
- Existing functionality is not broken.
- Regression checks pass.

Generate a QA summary. If flow validation FAIL → return to Phase 5 (shares the **2-cycle** QA→implementation cap). If impact `riskLevel` is CRITICAL or a breaking change is required and the PRD does not authorize it → **hard-stop** (see SKILL.md § Autonomous decision boundary).

---

## PHASE 9 — DOCUMENTATION UPDATE

**Read:** [sdd-sync-agent.md](../../sdlc-system/agents/sdd-sync-agent.md), [project-context-sync.md](../../sdlc-system/workflow/project-context-sync.md)

Required updates:

### 1. Version history (business-readable)

Maintain a `history/` folder at the repo root.

For every feature/requirement:

- Create a **new** file — **never** overwrite or append to existing history files.
- **Filename:** `history/YYYY-MM-DD-<artifactSlug>.md`  
  Example: `history/2026-07-02-callback-webhook-retry.md`  
  Use delivery date (UTC) and `artifactSlug` from Phase 1.
- **Audience:** product managers, business stakeholders, and support — **not** engineers reviewing diffs.
- **Do not** include line-by-line diffs, file paths as the primary narrative, or raw commit lists. Those belong in the PR / implementation summary only.

Write in plain language — what changed from a **product and process** perspective. Examples:

- "A new cancellation API allows partners to cancel bookings before check-in."
- "Auto-refund on cancellation has been disabled; refunds now require manual approval."
- "Users see an updated confirmation email when a booking is modified."

**Document template:**

```markdown
# <Feature name>

| Field | Value |
|-------|-------|
| Date | YYYY-MM-DD |
| Jira | <EPIC-KEY> — <url> |
| Release version | <version or TBD> |
| PR | <url> |

## Summary

One short paragraph: what this delivery does and why it matters to the business.

## What changed

Bullet list in **business-readable** language. Group by theme when helpful:

- **API / integrations:** e.g. new endpoint, deprecated webhook, changed response fields (describe behavior, not class names)
- **User journeys / flows:** e.g. new step, removed step, changed rule (e.g. refund timing, eligibility)
- **Policies / rules:** e.g. limits, fees, approval gates, feature flags turned on/off
- **Notifications / reporting:** e.g. new email, dashboard metric, export format
- **Data / records:** e.g. new fields stored, migration impact described in business terms (only if relevant to readers)

## Who is affected

- **Customers / partners / internal roles** impacted and how

## How to verify

Short checklist a PM or QA can follow without reading code (aligned with acceptance criteria).

## Rollback / limitations

- What to expect if rolled back
- Known limitations or follow-up work in plain language

## Reference (optional, brief)

- Requirement / PRD title
- Jira epic or story keys
```

Commit the new history file with the feature branch.

### 2. Central architecture documentation

Update:

- Architecture diagrams
- Components
- Dependencies
- Data flow
- Integration points

### 3. Business flow documentation

Update:

- User journeys
- Process flows
- Business logic
- Workflows

### 4. SDD sync (as-built)

- Reconcile SDD with implemented code; mark `IMPLEMENTED`
- Add Implementation Notes; record drift

### 5. Project-context sync

- Recon feature branch vs MDC; update stale fields in `.cursor/project-context/*.mdc`
- Write `project-context-sync-report.md`
- Commit MDC changes if updated

Also update when applicable:

- README
- API documentation
- OpenAPI/Swagger
- Deployment documentation
- Runbooks
- Changelog
- Release notes

---

## PHASE 10 — STATIC & QUALITY CHECKS

**Read:** [pre-pr-verification.md](../../sdlc-system/workflow/pre-pr-verification.md), [developer-agent.md](../../sdlc-system/agents/developer-agent.md) (sync mode)

Run available checks:

- Build validation
- Compilation (**mandatory** — overrides `runLocally: false` for pre-PR)
- Linting
- Formatting
- Type checking
- Static analysis
- Dependency vulnerability checks
- Dependency/version reconciliation vs as-built build files
- Stack rule `verify` entries from `documentation.stackRules`

Write `compile-verification-report.md` with `status: pass`.

### BugBot (final pass)

After project-context sync — **BugBot on current PR tip**. **↳ Run as an independent `Task` subagent** (reads `bugbot-agent.md`); the **parent** fixes and re-pushes between cycles:

- `actionableFindingCount === 0` required
- Fix loop (**cap: 3 cycles**) — if findings remain, hard-stop and report

### CI verification

- `gh pr checks <number>` — **all checks must pass**
- Do not publish PR while checks pending or failing
- Poll with `--watch` or fix and re-push
- **Bounded poll** (MDC `watchCommand` timeout or ~15 min) — on timeout, stop; do not publish

### Secret scan (pre-publish)

Scan **this workflow's diff**, staged files, and new untracked files for credentials, tokens, private keys, and `.env` content. If any would be committed → **hard-stop**; never commit or publish. Fix issues before proceeding.

Pre-existing tracked secrets outside the diff are **not** a hard-stop: leave them untouched, list them under Risks in the PR body and final report, and continue.

---

## PHASE 11 — GIT OPERATIONS

**Read:** [artifact-naming.md](../../sdlc-system/workflow/artifact-naming.md)

Finalize git state:

- Feature branch = `artifactSlug` (created in Phase 5 phase 0)
- Meaningful conventional commit messages with Jira keys
- Push all commits including MDC sync
- Confirm `git fetch` + pull base was done at branch creation

Only create commits when implementing; autonomous delivery includes commit. Push before PR publish.

**Before Phase 12, satisfy the Definition of Done gate in `SKILL.md`.**

---

## PHASE 12 — PULL REQUEST CREATION

**Read:** [pr-manager-agent.md](../../sdlc-system/agents/pr-manager-agent.md)

**Precondition:** Definition of Done gate 100% green (SKILL.md); BugBot final pass complete (or waived); CI all green; compile pass; no review BLOCKERs.

Publish pull request (`gh pr ready` if draft).

PR must contain:

**Title:**
- `[EPIC-KEY] <clear feature summary>`

**Description:**

```
Summary:
Business Context:
Jira Link:
Implementation Details:
Architecture Changes:
Documentation Updates:
Testing Performed:
QA Results:
Impact Analysis:
Flow Validation:
BugBot:
Breaking Changes:
Rollback Plan:
Known Limitations:
```

**Checklist:**

- Requirement completed
- Tests added/updated
- QA completed
- Flow validation passed
- Documentation updated
- MDC synced
- CI green
- No unrelated changes
- Ready for review

Delete `.cursor/sdlc-system/workflow-artifacts/<workflowId>/` before final push. Keep only RDD + SDD under `docs/sdlc/<workflowId>/`.

Use `gh pr create` / `gh pr ready` per user rules. **Never merge, close, or force-push** — delivery stops at an open PR.

---

## PHASE 13 — JIRA UPDATE

Skip when Phase 2 ran manifest-only — record "Jira: manifest-only (`jira.enabled: false`)" in the final report instead.

Update Jira with:

- Pull Request URL
- Implementation summary
- Testing summary
- QA status
- Documentation status
- Flow safety score and risk level
