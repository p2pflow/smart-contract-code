# BugBot Integration

## Enable for this repository

BugBot is turned on in the **Cursor dashboard**, not in git. Per-repo intent is recorded in `project.mdc` → `bugbot`:

```yaml
bugbot:
  enabled: true
  repoUrl: https://github.com/<org>/<repo>
  triggerOnDraftPr: true
  triggerComment: "/bugbot"
  botLogins: [cursor-bugbot, bugbot]
```

**Setup guide:** [bugbot-setup.md](../../docs/bugbot-setup.md)

If `enabled: false`, orchestrator may skip `BUGBOT_REVIEW` or require `skip bugbot` waiver. If `enabled: true` but dashboard is not configured → `BUGBOT_NOT_CONFIGURED`.

## Scope

The **BugBot Agent** runs **twice** when `bugbot.enabled`:

| Pass | When | Next |
|------|------|------|
| **First** | After `DRAFT_PR_CREATION` | `REVIEW` or `REVIEW_FIXES` |
| **Final** | After `PROJECT_CONTEXT_SYNC`, **before** `CI_VERIFICATION` and **`PRE_PR_APPROVAL`** | `CI_VERIFICATION` or `REVIEW_FIXES` |

Final pass ensures BugBot scanned the **current PR tip** (sync may have pushed). **Never** open gate 2 without final pass complete and `actionableFindingCount === 0` (unless `waivers.bugbot`).

## Trigger model

| Method | Description |
|--------|-------------|
| **Automatic** | BugBot runs on PR open/update (Cursor/GitHub app) |
| **Explicit** | Comment `/bugbot` or team-specific trigger on PR (if configured) |

v1: **Poll** PR comments and checks until BugBot completes or timeout.

## Wait policy

See [retry-logic.md](../workflow/retry-logic.md): up to 5 polls, backoff 30s–300s.

Detection signals:

- Comment author/login matches BugBot bot account
- Comment contains structured findings (severity, file, line)
- Check run name contains `Bugbot` / `bugbot`

## Fetch findings

1. `gh pr view <n> --comments` — filter BugBot author
2. Parse severity buckets: Critical, High, Medium, Low
3. Deduplicate by file+line+rule

Do **not** load full raw JSON payloads into context—extract comment bodies and locations only (aligns with babysit skill).

## PR comment (agent output)

Post via:

```bash
gh pr comment <n> --body "$(cat <<'EOF'
## BugBot Summary (SDLC Workflow)

**Workflow:** `<workflowId>`
**Findings:** N total (C critical, H high, ...)

### Action required
- [ ] Item 1 ...
...
EOF
)"
```

## Handoff output

```json
{
  "bugbotReportPath": ".cursor/sdlc-system/workflow-artifacts/<workflowId>/reports/bugbot-report.md",
  "actionableFindingCount": 3,
  "findings": [
    {
      "id": "bb-1",
      "severity": "high",
      "file": "app/services/Foo.java",
      "line": 42,
      "summary": "...",
      "valid": null
    }
  ],
  "prCommentUrl": "https://github.com/...#issuecomment-..."
}
```

## Transition rules

**`SDD_SYNC` is never a BugBot exit.** Pipeline after BugBot: `REVIEW` → … → `PRE_PR_APPROVAL` → `PR_PUBLICATION` → `SDD_SYNC`.

| Condition | `status` | `nextAction` | Next state |
|-----------|----------|--------------|------------|
| `actionableFindingCount > 0` | `READY_FOR_FIXES` | `invoke:developer` | `REVIEW_FIXES` |
| Zero actionable (dismissed only) | `READY_FOR_REVIEW` | `invoke:review` | `REVIEW` |
| Zero total findings | `READY_FOR_REVIEW` | `invoke:review` | `REVIEW` |

Legacy `NO_ACTIONABLE_FINDINGS` / `transition:SDD_SYNC` handoffs are **invalid** — orchestrator maps them to `REVIEW` and logs a correction.

## REVIEW_FIXES coordination

- Developer validates each finding (fix or dispute with reason)
- Re-run BugBot cycle after push (max 3 cycles)
- Human PR comments processed in same state (not only BugBot)

## Waiver

User: `skip bugbot` → orchestrator records `waivers.bugbot` and proceeds to **`REVIEW`** (engineering review still required) with warning in delivery report.

## Error codes

| Code | Retryable |
|------|-----------|
| `BUGBOT_TIMEOUT` | Yes |
| `BUGBOT_NOT_CONFIGURED` | No (waiver or fail) |

## Relation to Review Agent

- **Review Agent**: human-style engineering review (architecture, security)
- **BugBot Agent**: automated PR bot findings
- Both feed `REVIEW_FIXES`
