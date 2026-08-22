# BugBot setup (Cursor + GitHub)

BugBot is a **Cursor dashboard / GitHub App** integration — not a repo file. The SDLC workflow expects it on draft PRs (`BUGBOT_REVIEW`). Configure once per repository.

## 1. Prerequisites

- Cursor **team admin** (only admins can enable repos in BugBot settings)
- [GitHub setup](github-setup.md) complete (`gh auth login`, `repo` + `workflow` scopes)
- Repo listed in `project.mdc` → `bugbot.repoUrl` and `repositories.primary`

## 2. Connect GitHub to Cursor

1. Open [Cursor Dashboard → Integrations](https://cursor.com/dashboard?tab=integrations)
2. **Connect GitHub account** (or **Manage connections** if already linked)
3. Install the Cursor GitHub App on org **`ola-financial-services`**
4. Grant access to **`afm-orchestrator`** (or “All repositories” if policy allows)

If the org uses SAML SSO, authorize the app for the org in GitHub after connecting.

## 3. Enable BugBot for this repo

1. Open [Cursor Dashboard → BugBot](https://cursor.com/dashboard?tab=bugbot) (or BugBot section from docs)
2. Find **`ola-financial-services/afm-orchestrator`**
3. Toggle **Enable** for that repository

**Team admin API** (optional automation):

```bash
export CURSOR_API_KEY="<team-admin-api-key>"
curl -X POST https://api.cursor.com/bugbot/repo/update \
  -H "Authorization: Bearer $CURSOR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "repoUrl": "https://github.com/ola-financial-services/afm-orchestrator",
    "enabled": true
  }'
```

## 4. Verify

1. Open or create a **draft PR** on this repo
2. Comment on the PR:

   ```
   /bugbot
   ```

3. Within a few minutes you should see a BugBot comment or check run (author login often `cursor-bugbot` or similar)

```bash
gh pr view <number> --repo ola-financial-services/afm-orchestrator --comments
gh pr checks <number> --repo ola-financial-services/afm-orchestrator
```

## 5. SDLC workflow

When `project.mdc` → `bugbot.enabled: true`:

| State | Behavior |
|-------|----------|
| `DRAFT_PR_CREATION` | PR Manager opens **draft** PR |
| `BUGBOT_REVIEW` | BugBot agent polls (or posts `triggerComment` if `triggerOnDraftPr`) |
| Timeout / not configured | User may `skip bugbot` or fix dashboard setup |

See [bugbot-integration.md](../sdlc-system/integrations/bugbot-integration.md).

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| “Bugbot is disabled for this repository” | Re-enable in Cursor BugBot dashboard; confirm team admin; avoid duplicate Cursor GitHub App installs in the org |
| No response after `/bugbot` | Confirm GitHub App has PR + checks access; try a **new** PR |
| `BUGBOT_NOT_CONFIGURED` in SDLC | Complete steps 2–3; set `bugbot.enabled: true` in `project.mdc` |
| Not a team admin | Ask Cursor team admin to enable the repo or promote your role |
| Only one org Cursor install | GitHub → Org Settings → GitHub Apps → single Cursor installation |
