# Hermes Console

Obsidian desktop plugin that embeds a native **chat** panel for Hermes Agent. It
drives `hermes acp` over the Agent Client Protocol (ACP) and renders the
conversation with Obsidian's own markdown renderer — no terminal emulation.

> History: this started as a fork of a fork of an xterm.js/node-pty terminal
> plugin. That terminal implementation has been fully removed; the plugin is now
> an ACP chat client. Git history has the old code if needed.

## Stack

- TypeScript 5.8, Obsidian Plugin API (1.7.2+)
- esbuild (bundler), Vitest (tests)
- No runtime dependencies — talks to `hermes acp` via Node `child_process`

## Commands

```bash
npm install              # Install dev dependencies
npm run dev              # Watch mode (auto-rebuild on changes)
npm run build            # tsc -noEmit type-check + production esbuild bundle
npm test                 # vitest run
node install.mjs <vault> # Copy main.js/manifest.json/styles.css into a vault
```

The build masks failures if piped through `tail` (pipeline exit code is `tail`'s).
Check `echo $?` after `npm run build`, or read the tsc output directly.

## Architecture

```
src/
  main.ts              # Plugin lifecycle: view registration, ribbon, commands, settings
  hermes-chat-view.ts  # The chat ItemView — UI, streaming render, history, note context
  acp-client.ts        # ACP client: spawns `hermes acp`, JSON-RPC, sessions, streaming
  settings.ts          # Settings model + tab (location, hermes path, startup, history count)
  constants.ts         # View type constant (VIEW_TYPE_TERMINAL = "terminal-view")
  hermes-icon.ts       # Inline ribbon/settings SVG icons
```

Plugin → HermesChatView → AcpClient. The view owns all rendering and state; the
client owns the process and the wire protocol.

## ACP protocol notes (verified against hermes 0.17.0)

- **Transport**: newline-delimited JSON-RPC 2.0 over the `hermes acp` process stdio.
- **Handshake**: `initialize` → `session/new` (or `session/load`) → `session/prompt`.
- **Streaming**: the agent emits `session/update` notifications —
  `agent_thought_chunk`, `agent_message_chunk`, `tool_call` (no status — it's
  running), `tool_call_update` (carries `status`), `usage_update`
  (`{used,size}`), and `user_message_chunk` (only during load replay).
- **Prompt result**: `{ stopReason, usage:{inputTokens,outputTokens,...} }`.
- **Sessions**: `session/new` and `session/load` return `models` (availableModels +
  currentModelId). `session/load` **replays** the full transcript as
  `session/update` notifications and restores context server-side. `session/list`
  returns `{sessions:[{sessionId,title,updatedAt,cwd}]}`. `session/set_model`
  switches the active model. Hermes compresses context itself
  (`_meta.hermes.sessionProvenance.compressionDepth`) — no client summarization.
- **Agent→client requests** the client must answer: `session/request_permission`
  (reply `{outcome:{outcome:"selected",optionId}}`), `fs/read_text_file`,
  `fs/write_text_file`.

## Key details

- **Desktop-only** (`isDesktopOnly: true`).
- **Launching hermes**: spawned via the user's login shell —
  `$SHELL -lc 'exec <hermes> acp'` — so it inherits the same PATH/environment as
  the terminal (GUI Obsidian's env is too stripped; a bare spawn fails to find
  `hermes` or its MCP-server subprocesses → exit 127). `exec` keeps stdout a
  clean JSON stream. The hermes command/path is configurable (blank = `hermes`).
- **Connect is non-blocking**: `onOpen` builds the UI and connects in the
  background — awaiting the multi-second ACP boot there would stall Obsidian's
  workspace restore. The handshake has a 60s timeout.
- **Persistence**: the Hermes session id is stored in plugin data; on open the
  plugin resumes it (or the most recent / a new one, per the "On open" setting).
- **Note context**: the header toggle, when on, prepends the active note's
  selection (or cursor surroundings) to the prompt. Context is captured
  continuously from the active MarkdownView so it survives focus moving to the
  chat input.
- **Streaming render**: assistant text is rendered as markdown live, throttled to
  one render per animation frame, with leading whitespace trimmed.

## Plugin commands

- `open-terminal` / `close-terminal` / `toggle-terminal` (Open/Close/Toggle Hermes Console)
- `open-terminal-split` (Open in new pane)

(Command IDs retain the `terminal` prefix for backward compatibility with
existing hotkeys; they operate on the chat view.)

## Conventions

- Match the surrounding code style; keep the view as the single owner of DOM/state.
- When changing protocol handling, verify against a real `hermes acp` process
  (a short Node probe script over stdio) rather than assuming shapes.
- Run `npm run build` (check the real exit code) and `npm test` before committing.
