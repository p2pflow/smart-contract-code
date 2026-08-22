# GitHub Integration

Single reference for **Developer**, **PR Manager**, and any agent using `gh` and git.

## Agent rules

- When `gh auth status` succeeds, use **`gh`** for PR operations — do not ask the user to open PRs manually.
- Do **not** run local build, test, or runtime (commands from MDC `technology.testCommands` / `agentVerification.ciCommands`) unless the user explicitly requests it or MDC sets `agentVerification.runLocally: true`. See [sdlc.md § MDC — agent rules](../../docs/sdlc.md#agent-rules-all-downstream-agents).

## Setup

See [github-setup.md](../../docs/github-setup.md) (one-time `gh auth login`).

| Requirement | Notes |
|-------------|-------|
| `gh auth login` | Scopes `repo`, `workflow`, `read:org` |
| Org SSO | `gh auth refresh -s repo,workflow,read:org` and authorize your org in the browser |
| Repo access | From MDC `projectContext.repositories` |

**PR timing (SDLC v1.1):**

1. **`DRAFT_PR_CREATION`** — `gh pr create --draft` (minimal body) for BugBot
2. **BugBot + review + fixes**
3. **`PRE_PR_APPROVAL`** — user gate
4. **`PR_PUBLICATION`** — `gh pr edit` with body from `.cursor/sdlc-system/workflow-artifacts/<workflowId>/pr-body.md` (or HEREDOC); `gh pr ready`; **delete** `workflow-artifacts/<workflowId>/` before push

Do not publish the full PR description before `approvals.prePr.approved`. Ephemeral artifacts are **gitignored** and must not be committed.

## Repository roles

| Role | Operations allowed |
|------|-------------------|
| **Modifiable** | Branch, commit, push, open PR |
| **Read-only** | Clone/read, no writes |
| **Reference** | Dependency docs only; no clone required |

Enforced in developer handoff `inputs.repoPolicy`.

## Developer Agent flows

### Branch naming

```
<artifactSlug>
```

Example: `callback-webhook-retry` — generic kit rule (`artifact-naming.md`); not per-project MDC. One branch for all phases.

### Base branch (before create)

Developer agent **must** run locally (phase 0, each repo):

```bash
git fetch origin
git checkout <baseBranch>
git pull origin <baseBranch>
git checkout -b <artifactSlug>
```

Default `<baseBranch>`: `master` (user may override at requirements with `base branch: <name>`).

### Commit policy

- Conventional commits aligned with repo history
- One logical commit per task when possible
- Never force-push `main`/`master`
- Never commit secrets (`.env`, keys)

### Multi-repo

For each repo in `inputs.phases[current].repos`:

1. `cd` to workspace path
2. `fetch` + pull latest `master`, then create/checkout feature branch (`artifact-naming.md`)
3. Implement → push for CI (do not run local build/test — see README § MDC agent rules)
4. Commit; handoff lists `commits[]` per repo

## PR Manager flows

### Pre-PR checks

- Branch pushed to `origin`
- `git status` clean
- Base branch up to date (merge or rebase per team rule)

### Create PR

```bash
gh pr create --title "..." --body "$(cat <<'EOF'
...
EOF
)" --base main
```

### PR body sections (required)

Embed content in the PR description (do not link-only to gitignored report files):

1. **Summary** — user-facing change description
2. **Jira** — epic/story links
3. **Implementation** — bullets from implementation summary
4. **Review** — checklist from review summary
5. **Test plan** — from QA report / CI status

### Metadata handoff

```json
{
  "pr": {
    "url": "https://github.com/org/repo/pull/42",
    "number": 42,
    "branch": "callback-webhook-retry",
    "base": "main",
    "repo": "org/repo"
  }
}
```

## Review comments (REVIEW_FIXES)

PR Manager / Developer:

```bash
gh pr view <n> --comments
gh api repos/{owner}/{repo}/pulls/{n}/comments
```

Filter **unresolved** threads; ignore resolved per babysit skill pattern.

## CI

- Watch checks: `gh pr checks <n>`
- QA agent uses `gh pr checks` / workflow logs—not local test commands from MDC

## Error codes

| Code | Retryable |
|------|-----------|
| `GITHUB_AUTH` | No |
| `GITHUB_PUSH_REJECTED` | Yes once after `git pull --rebase origin <feature-branch>` (not base) |
| `GITHUB_PR_EXISTS` | No (reuse existing PR in handoff) |

## Security

- Use `gh` credential helper; no tokens in prompts
- Sign commits only if repo requires (follow existing config)
