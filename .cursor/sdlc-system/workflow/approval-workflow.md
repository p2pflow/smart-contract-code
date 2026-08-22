# Approval Workflow

**Two mandatory human gates only.** No approval between implementation phases.

| Gate | State | When |
|------|--------|------|
| **1. SDD** | `SDD_APPROVAL` | After SDD is written, before Jira and all implementation |
| **2. Pre-PR** | `PRE_PR_APPROVAL` | After all phases, BugBot, and engineering review (and fix loops) — **before** the public PR is finalized |

---

## Gate 1: SDD approval (`SDD_APPROVAL`)

### Trigger

- Entered automatically after `sdd-architect` returns `READY_FOR_JIRA`.

### Orchestrator presentation

1. One-paragraph summary
2. Path to full SDD (and RDD)
3. Checklist: architecture, APIs, data model, risks, test strategy
4. **Scope options** (from SDD § 1b / handoff `scopeOptions`) — radio list, **Option 1 pre-selected** as default
5. **Cleanup checkbox** (`scopeOptions.cleanupOption`) — "Remove unused files and dead code", unchecked by default
6. **Approve SDD (and confirm scope) to proceed?**

Present options like:

```markdown
### Scope (choose one — default: Option 1)
- (x) Option 1 — <minimal>
- ( ) Option 2 — <broader>

### Cleanup (optional)
- [ ] Remove unused files and dead code

Reply **approve** to accept the defaults (Option 1, no cleanup), or e.g.
**approve option 2 + cleanup**, **approve with cleanup**, **option 2**, etc.
```

### Valid user responses (intent-based — not exact commands)

| User intent | Examples | Action |
|-------------|----------|--------|
| Approve (defaults) | `approve`, `approved`, `yes`, `ok`, `continue`, `proceed`, `looks good`, `lgtm`, `approve sdd` | Record Option 1, cleanup off → `JIRA_CREATION` |
| Approve + scope choice | `approve option 2`, `option 2`, `approve with option 2 and cleanup`, `approve + cleanup`, `option 1 with cleanup` | Record chosen option + cleanup flag → `JIRA_CREATION` |
| Reject | `reject`, `no`, `needs changes`, `reject sdd: <feedback>` | → `SDD_GENERATION` |
| Abort | `abort`, `cancel`, `stop` | → `FAILED` |

Orchestrator interprets intent from context at `SDD_APPROVAL` — do not require exact `approve sdd` wording. If the user approves without naming an option, **use Option 1 (default) and cleanup off**.

### Persisted record

```json
{
  "approvals": {
    "sdd": {
      "approved": true,
      "approvedAt": "ISO-8601",
      "approvedBy": "user",
      "scopeSelection": { "optionId": 1, "label": "<chosen option>" },
      "cleanup": false,
      "feedback": null
    }
  }
}
```

### Rules

- **No Jira, no code, no plan execution** without `approvals.sdd.approved === true`.
- The recorded **scope selection** bounds planning and the implementation diff. Do not implement a broader option than the user chose.
- When **cleanup** is checked, planning adds a cleanup phase and the developer removes unused files/dead code in the affected area; when unchecked, apply only the default `remove-on-touch` entropy rule.

---

## Auto-proceed (no user gate)

After SDD approval, the Orchestrator sets `context.autoRun: true` and runs **without stopping** for user confirmation (no "continue?", no per-phase prompts):

| Step | States | Notes |
|------|--------|-------|
| Jira | `JIRA_CREATION` | Epic/tasks (or dry-run) |
| Plan | `PLANNING` | Plan written; **no `PLAN_APPROVAL`** — record `approvals.plan.autoApproved: true` |
| All phases | `EXECUTION` | Loop every phase until `READY_FOR_QA` |
| QA | `QA` | Requirements, SDD, test evidence, coverage, acceptance criteria |
| Impact Analysis | `IMPACT_ANALYSIS` | System-wide impact; `impact-analysis-report.md` |
| Flow Validation | `FLOW_VALIDATION` | Business flow safety score; `flow-validation-report.md` |
| Draft PR | `DRAFT_PR_CREATION` | **Draft** PR for BugBot only (not the final publish) |
| BugBot | `BUGBOT_REVIEW` | Poll/trigger; fix loop if needed |
| Review | `REVIEW` | Engineering review on same branch/PR |
| Fixes | `REVIEW_FIXES` | Developer fixes; re-BugBot up to cycle limit |
| Project-context sync | `PROJECT_CONTEXT_SYNC` | Reconcile deps/versions; update MDC; compatibility checks; **compile** (all work types) |
| CI verification | `CI_VERIFICATION` | `gh pr checks` — all green before gate 2 |

Do **not** ask the user to approve individual phases or the plan unless they explicitly say `pause` / `step` / `abort`.

**Wrong (do not do):** "Phase 0 complete — approve to continue?" or "Proceed to Phase 1?"
**Right:** Chain phases silently; only stop at `PRE_PR_APPROVAL` with **`approve pr`**.

---

## Gate 2: Pre-PR approval (`PRE_PR_APPROVAL`)

### Trigger

- All `execution.phases` completed
- `BUGBOT_REVIEW` finished (or waived with justification)
- `REVIEW` returned `READY_FOR_PRE_PR` (no unresolved BLOCKERs, or waived)
- Any `REVIEW_FIXES` loops resolved
- `PROJECT_CONTEXT_SYNC` passed — dependencies/versions reconciled; `compile-verification-report.md` shows **pass**
- **BugBot final pass complete** when `bugbot.enabled` — `bugbot-report.md` on current PR tip; `actionableFindingCount === 0` (or `waivers.bugbot` documented)
- **`CI_VERIFICATION` passed** — `gh pr checks` all **green** on the PR (not pending)

**Order:** `PROJECT_CONTEXT_SYNC` → **`BUGBOT_REVIEW` (final)** → `CI_VERIFICATION` → **`PRE_PR_APPROVAL`** — BugBot always finishes before gate 2.

### Orchestrator presentation

Present **one consolidated package** before GitHub PR is finalized:

1. **Implementation summary** (phases completed)
2. **QA report** (incl. CI status / pending CI)
3. **Impact analysis** (`riskLevel`, breaking changes)
4. **Flow validation** (`flowSafetyScore`, impacted flows)
5. **BugBot report** (actionable count; link to draft PR comment)
6. **Review summary** (BLOCKER/MAJOR resolved or waived)
7. **Project-context sync** (`project-context-sync-report.md`) — MDC files updated, version/plugin validation
8. **Dependencies & versions** — from `project-context-sync-report.md`
9. **Compile verification** — `compile-verification-report.md`
10. **CI checks** — `gh pr checks` table (all green)
11. Link to **`pr-body.md`** (what will be pasted into the PR description)
12. Draft PR link (if open)
13. Question: **Approve publishing this PR?**

### Valid user responses (intent-based — not exact commands)

| User intent | Examples | Action |
|-------------|----------|--------|
| Approve | `approve`, `yes`, `continue`, `proceed`, `publish`, `approve pr`, `approve release`, `ship it` | → `PR_PUBLICATION` |
| Reject | `reject`, `no`, `reject pr: <feedback>` | → `REVIEW_FIXES` or `EXECUTION` per feedback |
| Abort | `abort`, `cancel`, `stop` | → `FAILED` |

### Persisted record

```json
{
  "approvals": {
    "prePr": {
      "approved": true,
      "approvedAt": "ISO-8601",
      "approvedBy": "user",
      "feedback": null
    }
  }
}
```

### Rules

- **No `gh pr create` (non-draft) or PR body finalize** without `approvals.prePr.approved === true`.
- **No gate 2** without deps/version sync, compile pass, or while CI is pending/failing — see [pre-pr-verification.md](pre-pr-verification.md).
- **PR description must include** embedded summary, QA, reviewer checklist, and test plan (`pr-body.md`), not links only.

---

## Removed gate: Plan approval

`PLAN_APPROVAL` is **not used**. On `READY_FOR_EXECUTION`, Orchestrator sets:

```json
{
  "approvals": {
    "plan": {
      "approved": true,
      "autoApproved": true,
      "approvedAt": "ISO-8601",
      "approvedBy": "orchestrator"
    }
  }
}
```

and immediately starts `EXECUTION` phase 0.

---

## Optional waivers

| Waiver | When | User phrase | Record |
|--------|------|-------------|--------|
| QA fail proceed | Non-critical QA | `waive qa and continue` | `waivers.qa` |
| Skip BugBot | Not configured / timeout | `skip bugbot` | `waivers.bugbot` |
| Review blocking | Accept risk | `waive review blockers` | `waivers.review` |

Waivers require one-line justification in state.

---

## Notification template (orchestrator)

```markdown
## Approval required: [SDD | Pre-PR publish]

**Workflow:** `<workflowId>`
**State:** `SDD_APPROVAL` | `PRE_PR_APPROVAL`

### Summary
<bullets>

### Artifacts
<paths>

### Actions
- SDD: **approve** / **continue** / **yes** (or **approve sdd**) | **reject** | **abort**
- Pre-PR: **approve** / **continue** / **yes** (or **approve pr**) | **reject** | **abort**
```
