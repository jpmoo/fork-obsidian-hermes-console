# Historical code quality review — 2026-04-28

This document is intentionally historical. It reviewed the upstream-era `lean-obsidian-terminal` codebase around version `0.12.2`, before Hermes Console became a public Community Plugin.

Do not treat this as current release documentation or a live security review. Several names, settings, and behaviors changed after this review, including:

- product identity moved from Lean Terminal / Claude-focused copy to Hermes Console
- session integration moved to Hermes terminology
- background completion notification was rebuilt as Hermes busy/idle status
- selected-note/cursor context bridge became part of the public Hermes Console flow
- Community Plugins became the recommended install path
- fresh installs now default to right sidebar and context sharing on

The original detailed review was removed from published docs to avoid stale public guidance. Use current docs instead:

- `README.md`
- `docs/settings.md`
- `docs/usage.md`
- `docs/security.md`
- `docs/hermes-obsidian-context-bridge.md`
- `docs/session-persistence.md`
- `docs/uri-handler.md`
