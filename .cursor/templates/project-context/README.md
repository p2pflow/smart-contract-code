# Project context templates (schema reference — read-only)

**Not live config.** These files define the **YAML schema** for `.cursor/project-context/`.

## What live `project-context/` must contain

On `start`, the orchestrator **reads the entire repository** and generates **`.cursor/project-context/`** with **all information agents need about this repo**:

| Live file | Repo facts captured |
|-----------|---------------------|
| `README.md` | Index of MDC files and coverage summary |
| `project.mdc` | Identity, repos, stack, build, tests, Jira, constraints |
| `architecture.mdc` | Layers, paths, integrations, auth, errors, boundaries |
| `coding-standards.mdc` | Languages, testing, review, stack rule refs |
| `deployment.mdc` | CI, environments, deploy, rollback, observability |
| `business-flows.mdc` | User/partner journeys and entry points |

Templates specify **which fields exist**; the repository supplies **values**.

## On `start`

1. Check **`.cursor/project-context/`** (live path)
2. If missing → full repo recon → generate all MDC files with project-specific content
3. Never load `workflowContext` from this `templates/` folder

See [project-context-bootstrap.md](../../sdlc-system/workflow/project-context-bootstrap.md).

## Edit live files only

Customize **`.cursor/project-context/`** per application repo — not these templates.
