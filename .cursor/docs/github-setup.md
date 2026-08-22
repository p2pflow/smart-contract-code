# GitHub access for agents

One-time setup so Cursor agents can **push branches** and **open PRs** via `gh`.

## 1. Install and log in

```bash
brew install gh   # if not installed
gh auth login
```

| Prompt | Recommendation |
|--------|----------------|
| GitHub.com | Yes |
| HTTPS or SSH | **SSH** if remotes are `git@github.com:...` |
| Authenticate | Browser or token |
| Scopes | **`repo`**, **`workflow`**, **`read:org`** |

If your org uses **SAML SSO**:

```bash
gh auth refresh -h github.com -s repo,workflow,read:org
```

Authorize the token for your org in the browser.

Verify:

```bash
gh auth status
gh repo view <org>/<repo>
```

## 2. Optional: token for non-interactive agents

Create a **fine-grained** or **classic** PAT with `repo`, `workflow`, `read:org` and SSO authorized for your org.

Do **not** commit tokens. Use env or a local file outside the repo:

```bash
export GITHUB_TOKEN="ghp_..."
# or
gh auth login --with-token < ~/.config/github/token
```

## 3. Cursor agent permissions

When the agent creates a PR, allow terminal with **network** and **git_write**.

## 4. BugBot (Cursor PR review)

Enable BugBot for this repo in the Cursor dashboard — see [bugbot-setup.md](bugbot-setup.md). Set `project.mdc` → `bugbot.enabled: true`.

## 5. SDLC PR flow

See [integrations/github-integration.md](../sdlc-system/integrations/github-integration.md) for draft → BugBot → review → publish. PR body draft lives in `.cursor/sdlc-system/workflow-artifacts/<workflowId>/pr-body.md` (gitignored).

## Troubleshooting

| Issue | Fix |
|-------|-----|
| `gh: command not found` | `brew install gh` |
| `You are not logged in` | `gh auth login` |
| SSO / integration errors | `gh auth refresh -s repo,workflow,read:org` and authorize org |
| `push rejected` on feature branch | `git fetch origin && git pull --rebase origin <feature-branch>` then push again — not base |
| Agent won't run `gh` | Grant network + git_write; run `gh auth status` in agent terminal |
