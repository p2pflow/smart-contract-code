# Example: QA → Impact Analysis → Flow Validation

Workflow `7f3e2a1b-…` · feature: **callback webhook retry**

## Pipeline segment

```
EXECUTION (complete)
  → QA
  → IMPACT_ANALYSIS
  → FLOW_VALIDATION
  → DRAFT_PR_CREATION
  → BUGBOT_REVIEW
  → REVIEW
  → …
```

## 1. QA Agent (unchanged scope)

**Validates:** requirements, SDD alignment, CI test evidence, coverage notes, acceptance criteria (FR-x).

**Output:** `.cursor/sdlc-system/workflow-artifacts/7f3e2a1b-…/reports/qa-report.md`

```json
{
  "agent": "qa",
  "status": "READY_FOR_IMPACT_ANALYSIS",
  "outputs": {
    "qaReportPath": ".cursor/sdlc-system/workflow-artifacts/7f3e2a1b-…/reports/qa-report.md",
    "passed": true
  },
  "nextAction": "invoke:impact-analysis"
}
```

## 2. Impact Analysis Agent (7A)

**Question:** *What else could break because of this change?*

**Reads:** diff, SDD §4 APIs, migration files, `conf/routes`, Feign clients.

**Output:** `impact-analysis-report.md` · `riskLevel: MEDIUM`

```json
{
  "agent": "impact-analysis",
  "status": "READY_FOR_FLOW_VALIDATION",
  "outputs": {
    "impactAnalysisReportPath": ".cursor/sdlc-system/workflow-artifacts/7f3e2a1b-…/reports/impact-analysis-report.md",
    "riskLevel": "MEDIUM",
    "breakingChangeCount": 0
  },
  "nextAction": "invoke:flow-validation"
}
```

**Findings (abbreviated):**

- **Direct:** `CallbackController`, `RetryPolicyService`, Ebean model `CallbackAttempt`
- **Downstream:** Partner webhook consumers (idempotency key contract unchanged)
- **Deployment:** Evolution script must run before traffic shift

## 3. Flow Validation Agent (7B)

**Question:** *Did this change break any business workflow?*

**Reads:** `business-flows.mdc`, QA report, impact report, SDD §6 sequences.

**Output:** `flow-validation-report.md` · `flowSafetyScore: 88`

| Flow | Status |
|------|--------|
| partner-callback | AT_RISK — retried path changed; regression recommended |
| journey-initiation | UNAFFECTED |
| loan-step | UNAFFECTED |
| user-auth | UNAFFECTED |

```json
{
  "agent": "flow-validation",
  "status": "READY_FOR_REVIEW",
  "outputs": {
    "flowValidationReportPath": ".cursor/sdlc-system/workflow-artifacts/7f3e2a1b-…/reports/flow-validation-report.md",
    "flowSafetyScore": 88,
    "reviewRequired": false
  },
  "nextAction": "invoke:pr-manager"
}
```

## 4. Downstream (unchanged)

PR Manager (draft) → BugBot → Review agent receives all three reports:

| Report | Path |
|--------|------|
| QA | `reports/qa-report.md` |
| Impact | `reports/impact-analysis-report.md` |
| Flow | `reports/flow-validation-report.md` |

## Failure examples

| Agent | Status | Orchestrator routes to |
|-------|--------|------------------------|
| QA | `QA_FAILED` | `EXECUTION` |
| Impact Analysis | `IMPACT_ANALYSIS_FAILED` | `EXECUTION` |
| Flow Validation | `FLOW_VALIDATION_FAILED` (score ≤60) | `EXECUTION` |
