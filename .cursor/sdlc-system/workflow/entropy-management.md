# Entropy management

**Entropy** = dead code, stale code, and orphaned assets that accumulate when changes leave leftovers behind.

Applies to **all stacks** (Java, Python, Spring, Play, React, Vue, etc.). Rules are configured in `coding-standards.mdc` → `entropy` and enforced by **developer**, **review**, **qa**, and **sdd-sync** agents.

## Definitions

| Term | Examples |
|------|----------|
| **Dead code** | Unused classes, methods, functions, exports, routes, handlers, components; unreachable branches |
| **Stale code** | Commented-out blocks kept "just in case"; duplicate implementations after a refactor; deprecated paths still wired |
| **Orphaned assets** | Tests/fixtures/mocks for deleted code; config keys for removed features; docs/comments referencing removed APIs |

## Policy (default: `remove-on-touch`)

1. **In files you change** — remove dead/stale/orphaned items touched by the change. Do not add new entropy.
2. **When replacing behavior** — **delete** the superseded implementation and **delete the file** if nothing remains. Do not leave parallel dead paths or unused files on disk.
3. **`transformation` work type** — removal is **in scope** by default: delete superseded modules, routes, config files, tests, and assets listed in SDD/plan. See [complete-delivery.md](complete-delivery.md).
4. **Outside phase scope** (feature/bugfix only) — do not drive repo-wide cleanup crusades unless the plan phase explicitly includes it. **Report** pre-existing entropy in the implementation summary or review report instead.
5. **Comments** — update or remove stale comments; do not commit large commented-out code blocks. Short `// reason` for a deliberate temporary guard is OK only if tracked (Jira/handoff note).

## Agent responsibilities

| Agent | Must do |
|-------|---------|
| **developer** | Clean entropy in modified files; **delete** superseded files (not only stop referencing); remove orphaned tests/config; list deletions in implementation summary |
| **review** | Block (per MDC `entropy.blockReview`) on new entropy in diff; **BLOCKER** if superseded file left on disk when SDD/plan required deletion |
| **qa** | Fail if tests reference deleted symbols, FR coverage points at removed endpoints, or SDD removal list not executed |
| **sdd-sync** | Remove stale API/component sections from SDD; record drift when docs lagged code |

## Diff checklist (developer + review)

- [ ] No new commented-out code blocks
- [ ] No unused imports, variables, or exports introduced
- [ ] Superseded code deleted (not shadowed)
- [ ] Orphaned tests removed when production code removed
- [ ] Routes/handlers/components/config aligned — no dangling registrations
- [ ] Comments and inline docs match current behavior

## MDC configuration

See `coding-standards.mdc` → `codingStandards.entropy`. Review agent treats `entropy.blockReview` items as **BLOCKER** when `strictReview` or team policy requires it.
