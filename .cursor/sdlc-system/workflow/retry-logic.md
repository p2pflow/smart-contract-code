# Retry Logic

- Retries are **orchestrator-owned**; agents return failure in handoff `errors[]` without silent retry loops.
- Exponential backoff for external APIs (Jira, GitHub, BugBot).
- **Idempotent** operations: Jira create uses idempotency keys; git push retries safe.

## Default policy

| Category | Max attempts | Backoff (seconds) | Notes |
|----------|--------------|-------------------|-------|
| Agent validation failure | 2 | 0 | Re-invoke same agent with `inputs.retryFeedback` |
| Jira API | 3 | 2, 4, 8 | 429/5xx only |
| GitHub (`gh`) | 3 | 2, 4, 8 | Network/auth |
| BugBot wait | 5 | 30, 60, 120, 180, 300 | Poll PR checks/comments |
| Test run (QA) | 2 | 0 | Flaky test policy in QA agent |
| User approval timeout | — | — | No auto-retry; remind user |

## Handoff retry fields

On retry, orchestrator adds to `inputs`:

```json
{
  "retry": {
    "attempt": 2,
    "maxAttempts": 3,
    "previousError": "JIRA_503",
    "orchestratorNote": "Retry after backoff"
  }
}
```

## Error classification

| Code | Retry? | Escalation |
|------|--------|------------|
| `VALIDATION_FAILED` | Yes (agent) | After max → `FAILED` |
| `JIRA_TRANSIENT` | Yes | — |
| `JIRA_AUTH` | No | `FAILED`; user fixes credentials |
| `GITHUB_PUSH_REJECTED` | Yes once after `git pull --rebase origin <feature-branch>` | Then `FAILED` — not pull from base |
| `TESTS_FAILED` | Route to `EXECUTION` | Not orchestrator retry |
| `USER_REJECTED_APPROVAL` | No | Return to prior state |
| `BUGBOT_TIMEOUT` | Yes | User may approve skip |

## State persistence on retry

```json
{
  "retryCounters": {
    "jira": 1,
    "bugbot": 2,
    "developer_phase_2": 0
  },
  "lastError": {
    "code": "JIRA_503",
    "at": "2026-06-04T10:00:00Z",
    "state": "JIRA_CREATION"
  }
}
```

## Circuit breaker (optional)

After **5** cumulative failures in same state within one workflow:

- Set `state.circuitOpen = true` for that integration.
- Require explicit user command: `resume with override` to continue.

## Abort

User says `abort` → immediate `FAILED` with `failureReason: USER_ABORT`.
