# Hermes Obsidian context bridge

Hermes Console uses one Obsidian plugin and one Hermes plugin, connected by local JSON files inside your vault.

The Obsidian plugin is **Hermes Console**. It owns the terminal UI, tabs, PTY sessions, selected-note/cursor capture, and the busy/idle tab indicators.

The Hermes plugin is **obsidian-context-bridge**. It appears in Hermes Plugins because it runs inside Hermes. It registers Hermes hooks, injects selected-note/cursor context before the LLM call, exposes the `obsidian_context()` tool for large selections, and writes per-tab busy/idle status for the Obsidian UI.

It is not a second Obsidian plugin.

## Fast path

Community Plugins installs the Obsidian plugin assets only. It does not install Hermes Agent and it does not auto-enable Hermes plugins.

1. Install **Hermes Console** from **Settings > Community Plugins**.
2. Enable **Hermes Console**.
3. Click **Settings > Hermes Console > Download binaries**.
4. Make sure `hermes` is installed and available to the shell launched by Obsidian.
5. Install and enable the Hermes-side bridge once:

   ```bash
   hermes plugins install dannyshmueli/obsidian-hermes-console --enable
   ```

6. Open Hermes Console, select text or put your cursor in a note, type a prompt, and press Enter.

New installs default **Send Obsidian context to Hermes** to on. Existing users keep their saved setting, so turn it on manually if you installed before this default changed.

## What users see in Hermes Plugins

Seeing `obsidian-context-bridge` in Hermes Plugins is expected.

Call it the **Hermes plugin** or **Hermes companion plugin** when explaining the architecture. Do not call it an Obsidian plugin.

It is dashboard-only/no-UI in Hermes because its job is not to render a tab. Its job is to:

- read `<vault>/.obsidian/hermes/context.json`
- inject fresh selected-text or cursor context before the LLM call
- expose `obsidian_context()` for large selections
- write `<vault>/.obsidian/hermes/runtime/<tab-id>.json` so Hermes Console can show busy/idle tab state

## Architecture

```text
Obsidian note selection/cursor
  -> Hermes Console Obsidian plugin
  -> <vault>/.obsidian/hermes/context.json
  -> OBSIDIAN_CONTEXT_BRIDGE_PATH
  -> obsidian-context-bridge Hermes plugin
  -> current Hermes turn
```

Busy/idle status uses a second local JSON side channel:

```text
Hermes hooks
  -> obsidian-context-bridge Hermes plugin
  -> <vault>/.obsidian/hermes/runtime/<tab-id>.json
  -> Hermes Console tab spinner / unread dot / optional Obsidian Notice
```

These bridge files are just JSON. They are not sockets, servers, clipboard paste, or network connections.

## Context bridge file

Hermes Console writes the current attachment state to:

```text
<vault>/.obsidian/hermes/context.json
```

Plain Enter writes a fresh marker before the PTY receives Enter.

When **Send Obsidian context to Hermes** is off, the marker has:

```json
{"attach":{"enabled":false},"context":null}
```

Hermes consumers must treat that as a fresh detach and clear any previously accepted selected text.

## Busy/idle status files

For each terminal tab, Hermes Console sets environment variables before spawning the PTY:

```text
OBSIDIAN_HERMES_TAB_ID=terminal-1
OBSIDIAN_HERMES_STATUS_PATH=<vault>/.obsidian/hermes/runtime/terminal-1.json
OBSIDIAN_HERMES_STATUS_DIR=<vault>/.obsidian/hermes/runtime
```

The Hermes plugin writes status JSON on these hooks:

- `pre_llm_call` -> `busy`
- `post_llm_call` -> `idle`
- `on_session_end` -> `idle`
- `on_session_finalize` -> `idle`

Hermes Console watches the status file and uses it for:

- spinner while a Hermes turn is running
- unread dot when a background Hermes tab becomes idle
- optional Obsidian Notice when a background Hermes turn finishes

This replaced the older OSC/prompt-parsing experiment. Terminal output is not the source of truth for Hermes busy state.

## Manual Hermes plugin installation

Most users should use the one-line install:

```bash
hermes plugins install dannyshmueli/obsidian-hermes-console --enable
```

Use manual install only when you run Hermes outside Hermes Console or maintain a custom Hermes profile.

The Hermes plugin files live in this repository under:

```text
hermes/plugin.yaml
hermes/__init__.py
hermes/obsidian_context_bridge.js
hermes/obsidian_status_bridge.py
```

If you copy the plugin manually, install those files as a Hermes plugin named `obsidian-context-bridge`, then enable it in Hermes config.

For context injection, the Hermes process must receive:

```text
OBSIDIAN_CONTEXT_BRIDGE_PATH=/path/to/vault/.obsidian/hermes/context.json
```

For tab busy/idle state, the Hermes process must receive the `OBSIDIAN_HERMES_*` variables listed above.

Hermes Console sets these environment variables automatically for terminal sessions it launches.

## Runtime behavior

- Missing or unreadable context bridge file: no context injected; `obsidian_context()` returns null.
- `attach.enabled=false`: no context injected; previously accepted context is cleared.
- Selection context: small selections are injected inline as serialized text.
- Large selections: Hermes gets a preview and can call `obsidian_context()` for the full text.
- Cursor context: Hermes gets file path, cursor position, current line, and nearby lines.
- Freshness window: stale payloads are rejected.
- Reuse guard: the same bridge payload is not injected twice.
- Missing or unreadable status file: no busy/idle UI update for that tab until a fresh status file is written.

## Troubleshooting

If Obsidian writes the bridge file but Hermes does not see context:

1. Confirm Hermes was launched from Hermes Console, not an unrelated external terminal.
2. Confirm the Hermes Plugins screen shows `obsidian-context-bridge` enabled.
3. Confirm the terminal environment contains `OBSIDIAN_CONTEXT_BRIDGE_PATH`.
4. Confirm `<vault>/.obsidian/hermes/context.json` updates when you press Enter.
5. Confirm **Send Obsidian context to Hermes** is on.
6. Restart Hermes Console after changing plugin settings or binaries.

If the tab spinner or background-finished notice does not work:

1. Confirm Hermes was launched from Hermes Console.
2. Confirm the Hermes Plugins screen shows `obsidian-context-bridge` enabled.
3. Confirm the terminal environment contains `OBSIDIAN_HERMES_STATUS_PATH` and `OBSIDIAN_HERMES_TAB_ID`.
4. Confirm `<vault>/.obsidian/hermes/runtime/<tab-id>.json` updates during a Hermes turn.
5. Disable and re-enable Hermes Console, or restart Obsidian, after changing plugin files.

Do not install another Obsidian plugin. There is only one Obsidian plugin: Hermes Console.
