# Hermes Obsidian Context Bridge

Hermes Console uses one Obsidian plugin and one Hermes plugin.

The Obsidian plugin is **Hermes Console**. It owns the terminal UI inside Obsidian.

The Hermes plugin is **obsidian-context-bridge**. It appears in Hermes Plugins because it runs inside Hermes, registers the `pre_llm_call` hook, and exposes the `obsidian_context()` tool. It is not a second Obsidian plugin.

## Fast path

If you installed Hermes Console with BRAT or Community Plugins and you launch Hermes from the built-in console, you normally do not install anything else manually.

1. Enable **Hermes Console** in Obsidian.
2. Click **Settings > Hermes Console > Download binaries**.
3. Open Hermes Console.
4. Make sure `hermes` is available in the shell launched by Obsidian.
5. Turn on **Send Obsidian context to Hermes**.
6. Select text in a note, type a prompt in Hermes Console, and press Enter.

Hermes Console passes `OBSIDIAN_CONTEXT_BRIDGE_PATH` to the terminal process. The Hermes `obsidian-context-bridge` plugin reads that path before each LLM call.

## What users see in Hermes Plugins

Seeing `obsidian-context-bridge` in Hermes Plugins is expected.

Call it the **Hermes plugin** or **Hermes companion plugin** when explaining the architecture. Do not call it an Obsidian plugin.

It is dashboard-only/no-UI in Hermes because its job is not to render a tab. Its job is to:

- read `<vault>/.obsidian/hermes/context.json`
- inject fresh selected-text or cursor context before the LLM call
- expose `obsidian_context()` for large selections

## Architecture

```text
Obsidian note selection/cursor
  -> Hermes Console Obsidian plugin
  -> <vault>/.obsidian/hermes/context.json
  -> OBSIDIAN_CONTEXT_BRIDGE_PATH
  -> obsidian-context-bridge Hermes plugin
  -> current Hermes turn
```

The bridge file is just JSON. It is not a socket, server, clipboard paste, or network connection.

## Bridge file

Hermes Console writes the current attachment state to:

```text
<vault>/.obsidian/hermes/context.json
```

Plain Enter always writes a fresh marker before the PTY receives Enter.

When **Send Obsidian context to Hermes** is off, the marker has:

```json
{"attach":{"enabled":false},"context":null}
```

Hermes consumers must treat that as a fresh detach and clear any previously accepted selected text.

## Manual Hermes plugin installation

Most users should not need this. Use it only when you run Hermes outside Hermes Console or maintain a custom Hermes profile.

The Hermes plugin lives in this repository under:

```text
hermes/obsidian_context_bridge.js
```

Install or copy it into your Hermes plugin directory as `obsidian-context-bridge`, then enable it in Hermes config.

The plugin must receive the bridge path through:

```text
OBSIDIAN_CONTEXT_BRIDGE_PATH=/path/to/vault/.obsidian/hermes/context.json
```

Hermes Console sets this environment variable automatically for terminal sessions it launches.

## Runtime behavior

- Missing or unreadable bridge file: no context injected; `obsidian_context()` returns null.
- `attach.enabled=false`: no context injected; previous accepted context is cleared.
- Selection context: small selections are injected inline as serialized text.
- Large selections: Hermes gets a preview and can call `obsidian_context()` for the full text.
- Cursor context: Hermes gets file path, cursor position, current line, and nearby lines.
- Freshness window: stale payloads are rejected.
- Reuse guard: the same bridge payload is not injected twice.

## Troubleshooting

If Obsidian writes the bridge file but Hermes does not see context:

1. Confirm Hermes was launched from Hermes Console, not an unrelated external terminal.
2. Confirm the Hermes Plugins screen shows `obsidian-context-bridge` enabled.
3. Confirm the terminal environment contains `OBSIDIAN_CONTEXT_BRIDGE_PATH`.
4. Confirm `<vault>/.obsidian/hermes/context.json` updates when you press Enter.
5. Restart Hermes Console after changing plugin settings or binaries.

Do not install another Obsidian plugin. There is only one Obsidian plugin: Hermes Console.
