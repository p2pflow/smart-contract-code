# Jira Integration

## Scope

The **Jira Agent** creates and links Epic → Stories → Tasks → Subtasks from the approved SDD, then returns IDs for planning and PR linking.

## Prerequisites

| Requirement | Source |
|-------------|--------|
| `JIRA_BASE_URL` | e.g. `https://company.atlassian.net` |
| `JIRA_EMAIL` + `JIRA_API_TOKEN` | Atlassian API token |
| `JIRA_PROJECT_KEY` | e.g. `AFM` |
| Issue type IDs | Project-specific (discover via API or config) |

Store in environment or `config/jira.env` (gitignored)—**never** in handoff JSON.

## API approach (v1)

- REST API v3 (`/rest/api/3/issue`)
- Orchestrator/agent uses `curl` or `gh`-style shell with env vars
- Future: dedicated MCP Atlassian server

## Create sequence

1. **Epic**
   - Summary: from SDD title / business objective
   - Description: SDD overview (ADF or plain text)
   - Labels: `sdlc-workflow`, `workflowId:<uuid>`

2. **Stories** (one per major feature / component)
   - Link to Epic: `Epic Link` or parent field per project config
   - Acceptance criteria from SDD functional requirements

3. **Tasks** (implementation work units)
   - Parent: Story
   - Map to SDD components/APIs where possible

4. **Subtasks** (optional)
   - Parent: Task
   - Granular work (migrations, tests)

## Hierarchy linking

```
Epic (AFM-100)
├── Story AFM-101
│   ├── Task AFM-102
│   └── Task AFM-103
└── Story AFM-104
```

Use `parent` field (team-managed) or Epic Link (company-managed)—agent reads `JIRA_PROJECT_STYLE` from config.

## Idempotency

Before create, search:

```
jql=labels = "workflowId:<uuid>" AND project = <KEY>
```

If epic exists, reuse IDs and skip duplicate creation.

## SDD rename

After epic created:

- From: `docs/sdlc/<workflowId>/<sddSlug>.md`
- To: `docs/sdlc/<workflowId>/<EPIC-KEY>-<sddSlug>.md` (see [artifact-naming.md](../workflow/artifact-naming.md))
- Update references in state `artifacts.sddPath`

## Handoff output shape

```json
{
  "jira": {
    "epicId": "AFM-100",
    "epicKey": "AFM-100",
    "storyIds": ["AFM-101", "AFM-104"],
    "taskIds": ["AFM-102", "AFM-103"],
    "subtaskIds": [],
    "browseUrl": "https://company.atlassian.net/browse/AFM-100"
  },
  "sddPath": "docs/sdlc/<workflowId>/AFM-100-<sddSlug>.md"
}
```

## PR / commit linking

- PR title/body: `AFM-100` or `Closes AFM-102` per team convention
- PR Manager appends: `## Jira\n- Epic: [AFM-100](url)\n- Stories: ...`

## Error codes

| Code | Retryable |
|------|-----------|
| `JIRA_401` | No |
| `JIRA_403` | No |
| `JIRA_400` | No (fix payload) |
| `JIRA_429` | Yes |
| `JIRA_503` | Yes |

## Permissions

API user needs: Create issues, Edit issues, Link issues in target project.
