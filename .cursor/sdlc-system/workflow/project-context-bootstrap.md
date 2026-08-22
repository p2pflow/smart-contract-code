# Project-context bootstrap (on `start`)

**First step** when the user runs `start` (before MDC load/validate and before `DISCOVERY`).

## Purpose — complete repo knowledge in one folder

**`.cursor/project-context/` must hold all information agents need about this repository.**

Agents do **not** infer stack, layout, CI, flows, or constraints from training data — they read **only** live `project-context/`. Bootstrap **reads the entire repo** and **writes every MDC file** with project-specific facts. Templates are **YAML schema only** — not the output.

| Repo information | Lives in |
|------------------|----------|
| Identity, repos, stack, build, test commands, Jira, constraints | `project.mdc` |
| Layers, paths, integrations, auth, errors, boundaries | `architecture.mdc` |
| Languages, frameworks, testing, review, entropy, stack rules | `coding-standards.mdc` |
| Environments, CI/CD, deploy, rollback, observability | `deployment.mdc` |
| Named user/partner journeys and entry points | `business-flows.mdc` |
| JVM/Play/etc. upgrade rules (when applicable) | optional `java.mdc`, `play.mdc`, … |

**Goal:** After bootstrap, a developer or agent can understand **how this repo works** from `project-context/` alone — with only org-specific gaps (e.g. `jira.projectKey`) marked `TBD`.

## Templates are NOT live project-context

| Path | Role |
|------|------|
| `.cursor/templates/project-context/` | **YAML schema** + field reference — read for structure; **never** load as `workflowContext` |
| `.cursor/project-context/` | **Live config** — generated from repo analysis on first `start`; edited per repo |

**Wrong:** Copy template files verbatim into `project-context/` and call bootstrap done.

**Right:** Recon the project → **generate** each MDC file with values inferred from the actual codebase, build, CI, and docs.

## When to run

| Condition | Action |
|-----------|--------|
| `.cursor/project-context/` missing on **disk** | Create folder + **generate** all required MDC from repo analysis |
| Any required file missing on **disk** under live path | Generate that file from repo analysis |
| All six files **verified present on disk** (Glob/Read this session) | Skip generation for those files (do not overwrite) |
| Only `templates/project-context/` exists | **Run bootstrap** — generate live files (do not treat templates as live) |
| `state.projectContextBootstrapped === true` but files deleted | **Ignore state** — bootstrap missing files ([filesystem-verification.md](filesystem-verification.md)) |

**Never overwrite** files verified **present on disk** in the current session.

**Never modify** kit paths (`docs/`, `skills/`, `sdlc-system/agents/`, `templates/`, etc.) in application repos.

**Disk-first:** existence = successful Glob/Read in **this** session — not chat memory, not `state.workflowContext`, not a prior "already present" message.

## Required output files

| Live path | Must contain (from repo) |
|-----------|--------------------------|
| `.cursor/project-context/README.md` | Index of all MDC files + one-line summary of what each captures for **this** repo |
| `.cursor/project-context/project.mdc` | Name, repos, languages, frameworks, build tool, test commands, package roots, CI commands, constraints |
| `.cursor/project-context/architecture.mdc` | Summary, style, **all** layer paths, boundaries, integrations, auth, error handling |
| `.cursor/project-context/coding-standards.mdc` | Languages, frameworks, test framework/runner/location, review rules, stack rule file refs |
| `.cursor/project-context/deployment.mdc` | CI provider, environments, deploy/rollback, cloud, observability |
| `.cursor/project-context/business-flows.mdc` | **All** identifiable flows with entry points — routes, README journeys, OpenAPI tags |

Use `.cursor/templates/project-context/*.mdc` only to know **which YAML keys exist** — fill them from the project.

## Bootstrap procedure (orchestrator)

### Step 1 — Check live path on disk

**Glob or list** `.cursor/project-context/` only. For each required file, **Read** (or `test -f`) in this session:

- `README.md`, `project.mdc`, `architecture.mdc`, `coding-standards.mdc`, `deployment.mdc`, `business-flows.mdc`

If folder or any file fails disk check → proceed to Step 2 for **missing** files only. Do **not** skip because `projectContextBootstrapped` or a prior chat turn said files exist.

### Step 2 — Full repository reconnaissance (mandatory)

Read the **entire repository** — root to leaves — before writing any MDC. Minimum scope:

| Signal source | Discover |
|---------------|----------|
| `git remote get-url origin` | `org/repo`, `bugbot.repoUrl` |
| Repo folder name, `README.md`, `AGENTS.md` | `project.name`, `displayName`, `architecture.summary` hints |
| `pom.xml`, `build.gradle*`, `build.sbt`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod` | `buildTool`, languages, frameworks, versions, `testCommands` |
| `package.json` scripts, Maven Surefire, Gradle test task, `pytest.ini` | `fullSuite`, `singleClass`, test runner |
| Source tree (`src/`, `app/`, `lib/`, `internal/`) | `packageRoots`, `architecture.layers[].paths` |
| Controllers, routes, handlers, `router.*`, Play `routes` | HTTP layer paths; business-flow **entryPoints** |
| Services, domain, use-cases folders | `business` layer paths |
| Repos, clients, adapters, `infra/` | `infrastructure` layer paths |
| Existing `test/`, `__tests__/`, `spec/` | `codingStandards.testing.location`, framework, runner |
| `.github/workflows/`, `Jenkinsfile`, `gitlab-ci.yml` | `deployment.ci`, compile/test CI commands → `agentVerification.ciCommands` |
| `Dockerfile`, `helm/`, `k8s/`, deploy docs | `deployment` environments, cloud hints |
| `application.conf`, `application.yml`, env samples | config patterns (no secrets) |
| OpenAPI / Swagger / route tables | integrations, business flow candidates |
| `docker-compose.yml`, service mesh, k8s manifests | consumed services, environments |
| Linter/formatter config (`.eslintrc`, `checkstyle`, `scalafmt`) | coding standards hints |
| Existing `.cursor/project-context/` (if partial) | merge facts; do not wipe user edits on re-run |

**Do not assume** Java, Python, React, etc. — derive from files present. **Do not skip** directories — empty or sparse MDC when the repo has rich structure is a bootstrap failure.

### Step 3 — Generate project-specific MDC (not copy)

For each missing live file, **write new content** following the template YAML **structure** with recon values:

#### `README.md` (live folder index)

Generate a short index listing every file in `.cursor/project-context/` and what repo facts it holds (stack, layers, CI, flows). State bootstrap date and remaining `TBD` fields.

#### `project.mdc` — identity, stack, verification

| Field | Fill from recon |
|-------|-----------------|
| `project.name`, `displayName`, `type` | Folder name, README — `backend-service`, `frontend-app`, `monolith`, `library` |
| `repositories.primary`, `modifiable`, `involved` | `git remote`; related repos from README, submodules, docker-compose |
| `technology.languages`, `languageVersions` | Build file properties, `.java-version`, `.nvmrc`, `go` directive |
| `technology.frameworks` | Spring, Play, Express, Django, React, etc. — from deps and imports |
| `technology.buildTool`, `testCommands.fullSuite`, `singleClass` | **Real commands** from build/CI — never `TBD` when inferable |
| `technology.packageRoots`, `routeConfigPatterns` | All main source roots; routes file paths (e.g. Play `conf/routes`) |
| `bugbot.repoUrl`, `enabled: true` | GitHub remote when applicable — set `enabled: false` only if BugBot not used |
| `agentVerification.ciCommands` | Compile/test steps from `.github/workflows/` |
| `agentVerification.runLocally` | Default **`true`** when build tool and test commands are inferable |
| `branching.defaultBranch` | `master` / `main` from remote HEAD or repo convention |
| `dependencies.internal`, `external` | Notable libs from build file (DB driver, HTTP client, framework) |
| `constraints` | Keep kit defaults + repo-specific rules from `AGENTS.md` / README |
| `jira.enabled`, `jira.projectKey`, `jira.baseUrl` | **Jira evidence rule:** set `enabled: true` with a real key/URL only when the repo proves it (issue keys in README, commits, or CI; Jira URL in docs). No evidence → `enabled: false`, `projectKey: TBD`, `baseUrl: TBD` — never carry the template placeholder over, never ask the user |

#### `architecture.mdc` — read project, fill template schema

Use [templates/project-context/architecture.mdc](../../templates/project-context/architecture.mdc) for **YAML shape only**. **Read the project** and write **all architecture** into live `.cursor/project-context/architecture.mdc`.

**Not acceptable:** empty `layers[].paths`, `summary: TBD`, or verbatim template copy when the repo has source and docs.

| Field | How to fill from project |
|-------|--------------------------|
| `summary` | One paragraph from `README.md`, `AGENTS.md`, `docs/` — what **this** system does, who uses it, major dependencies |
| `style` | `modular-monolith` / `monolith` (single deployable); `microservices` (multiple deployables); `serverless` (`functions/`, Lambda) |
| `layers` | Map template names `http`, `business`, `infrastructure` to **real directory paths** |

**Layer detection** (apply matching patterns — do not assume a stack):

| Layer | Folder/name patterns |
|-------|----------------------|
| http | `controller`, `handler`, `api`, `routes`, `router`, `resource`, `web`, `presentation`, `app/api/` |
| business | `service`, `domain`, `usecase`, `application`, `core`, `logic`, `actions`, `features/` |
| infrastructure | `repository`, `persistence`, `dao`, `adapter`, `client`, `gateway`, `infra`, `data`, `messaging` |

- List **all** major roots per layer — concrete paths relative to repo root.
- Non-standard layout (e.g. `adapters/in`) → map to closest template layer.

| Field | How to fill from project |
|-------|--------------------------|
| `boundaries` | Layer rules from import direction (e.g. http must not import infrastructure directly) |
| `integrations` | DB, queues, HTTP clients, cache — from build deps, config, `*Client` / `*Gateway` packages |
| `auth` | JWT, OAuth, API keys, Spring Security — from `security/`, `application.yml`, `.env.example` |
| `errorHandling` | Custom exception classes; error code enums; `@ControllerAdvice` / error middleware |
| `repositoryRelationships` | `primary` from `git remote`; `consumes` from README, docker-compose, client code |
| `diagrams.existing` | `docs/architecture`, `diagrams/`, mermaid in README |

**Example** (fill with **this** repo's paths):

```yaml
architecture:
  summary: <from README — this system's purpose>
  style: modular-monolith
  layers:
    - name: http
      paths: [<all controller/route roots>]
    - name: business
      paths: [<all service/domain roots>]
    - name: infrastructure
      paths: [<all repo/client/adapter roots>]
  boundaries: [<rules inferred from imports>]
  integrations: [<real DB, queue, HTTP partner names>]
  repositoryRelationships:
    - primary: <org>/<repo>
      consumes: [<downstream services if found>]
```

#### `coding-standards.mdc` — languages, testing, review

| Field | Fill from recon |
|-------|-----------------|
| `languages` | Versions and conventions from build + linter config |
| `frameworks` | Framework-specific rules (e.g. Play evolutions, Spring profiles) when detectable |
| `testing.framework`, `runner`, `location` | JUnit/pytest/Jest/etc. from deps + existing test tree — **real paths** |
| `testing.requirements` | Keep Principal Architect bar; add repo-specific test rules if documented |
| `review.dimensions`, `securityChecks` | Defaults + any rules from `AGENTS.md` or CONTRIBUTING |
| `documentation.stackRules` | List `java.mdc`, `play.mdc`, etc. when generated or present |
| `documentation.projectGuide` | `AGENTS.md` path when present |

#### `deployment.mdc` — CI, environments, ops

| Field | Fill from recon |
|-------|-----------------|
| `ci.provider` | `github-actions`, `jenkins`, `gitlab-ci`, `circleci` from workflow files |
| `ci.prChecks`, `watchCommand` | `gh pr checks` when GitHub; match repo PR policy |
| `environments[]` | local, staging, production — `runCommand` from README/Makefile when stated |
| `strategy.type`, `rollback` | From deploy docs or team defaults |
| `cloudProvider` | AWS/GCP/Azure from k8s, terraform, serverless config |
| `observability.apm`, `logs` | Datadog, Prometheus, CloudWatch, etc. from config |

#### `business-flows.mdc` — all identifiable journeys

| Field | Fill from recon |
|-------|-----------------|
| `businessFlows[]` | **Every** flow found: README user journeys, route groups, OpenAPI tags, main CRUD paths |
| `id`, `name`, `description` | Concrete names from product/domain language in repo |
| `entryPoints` | Real routes, controllers, handlers, GraphQL operations |
| `criticality` | `high` for core revenue/auth paths; `medium`/`low` for admin/secondary |
| Gaps | `TBD` flow only when routes exist but product names unknown — ask user to name |

#### Optional stack rules

Copy `java.mdc` / `play.mdc` from kit templates into **live** `project-context/` only when JVM/Play detected **and** file missing — then patch `targetVersion`, `buildFiles` from repo.

### Step 4 — Completeness gate (all repo facts captured)

Before continuing, verify **project-context holds the repo's information**:

- [ ] **All six files** exist under `.cursor/project-context/` (+ optional stack rules)
- [ ] **README.md** indexes every MDC and summarizes coverage
- [ ] No file is a **verbatim template copy** when recon provided signals
- [ ] `project.mdc`: real `org/repo`, languages, frameworks, build tool, test commands, package roots
- [ ] `architecture.mdc`: summary, all layer paths, integrations (or explicit none), boundaries
- [ ] `coding-standards.mdc`: test framework, runner, location filled from repo
- [ ] `deployment.mdc`: CI provider and environments reflect actual pipeline/docs
- [ ] `business-flows.mdc`: every major route/journey documented — not empty when API surface exists
- [ ] Remaining `TBD` listed explicitly (typically Jira key, unnamed flows, prod-only secrets paths)

Set `context.projectContextBootstrapped: true` when files were created.

### Step 5 — Validate and stop if incomplete

Stop **only** on the blocking set — the mandatory fields in [sdlc.md](../../docs/sdlc.md) § Mandatory fields.

| Still `TBD` / placeholder after recon | Action |
|---------------------------------------|--------|
| Blocking field (`project.name`, repos, languages, `buildTool`, `testCommands.fullSuite`, `architecture.summary`/`style`/`layers`, testing runner/framework, review dimensions, entropy, ≥1 environment, `rollback.code`) | Missing Context Report, **STOP** before `DISCOVERY` |
| `jira.projectKey` | Write `jira.enabled: false` (§ Step 3 Jira evidence); Jira phases run manifest-only — do **not** stop |
| Everything else (`cloudProvider`, `deployMechanism`, `featureFlags`, `observability`, `ci.provider`, `jira.baseUrl`, secret-injection details, unnamed flows) | Keep `TBD`, list in the report, **continue** |

**Never ask the user for non-blocking fields.** Deployment, cloud, CI, and secret-handling details are optional context, not delivery prerequisites.

## User message template (generated — not copied)

```markdown
## Project context bootstrap

Analyzed this repository and **generated** `.cursor/project-context/` (project-specific — not a template copy).

| File | Status |
|------|--------|
| project.mdc | generated |
| architecture.mdc | generated |
| … | … |

**Inferred from project:**
- Repo: `ola/example-service` (git remote)
- Stack: Java 17, Spring Boot, Maven — `mvn test`
- Layers: `src/main/java/.../controller` (http), `.../service` (business), `.../repository` (infrastructure)
- Tests: `src/test/java`, JUnit 5
- CI: GitHub Actions — `mvn verify`

**Still need your input:** `jira.projectKey`, confirm business flow names in `business-flows.mdc`.

Reply **`start`** after editing, or paste values and I will update the MDC files.
```

## After features — sync (not bootstrap)

Bootstrap runs **once** when files are missing and **never overwrites** existing MDC. After implementation, [project-context-sync.md](project-context-sync.md) re-recons the feature branch, updates stale MDC (versions, CI, plugins, layers), and runs before `PRE_PR_APPROVAL`.

## After bootstrap — validation

If **blocking** YAML fields (§ Step 5) are still `TBD`, empty, or obvious placeholders:

- Write **Missing Context Report** (list file + field paths)
- **STOP** before `DISCOVERY`
- Ask user to edit `.cursor/project-context/*.mdc` or supply values in chat — list **only** blocking fields

Do **not** proceed with discovery while `technology.testCommands.fullSuite` or `architecture.layers` are unfilled. Non-blocking gaps are reported, not asked.

## Version control

`.cursor/project-context/*.mdc` is per-repo config — committed on developer phase 0 in the feature PR.

- Bootstrap does not commit.
- Orchestrator sets `context.projectContextBootstrapped: true` when it generated files.

## Portable kit note

Kit ships generic **templates** only. Each application repo gets a **custom-generated** `project-context/` on first `start`.
