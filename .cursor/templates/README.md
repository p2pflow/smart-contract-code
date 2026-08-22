# Kit templates (read-only bootstrap source)

All starter files the SDLC kit copies or scaffolds from. **Do not edit in application repos** — kit upgrades overwrite `.cursor/` except `.cursor/project-context/`.

| Subfolder | Purpose | Becomes |
|-----------|---------|---------|
| [`project-context/`](project-context/README.md) | Per-repo MDC config | `.cursor/project-context/` on `start` (then editable) |
| [`workflow/`](workflow/) | RDD, SDD, implementation-plan scaffolds | Filled artifacts under `.cursor/sdlc-system/workflow-artifacts/` |

See [`.cursor/README.md`](../README.md) and [bootstrap spec](../sdlc-system/workflow/project-context-bootstrap.md).
