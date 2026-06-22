# Hermes Console

A personal fork that turns the Hermes Console Obsidian plugin into a **native chat
panel** for [Hermes Agent](https://github.com/NousResearch/hermes-agent). Instead
of emulating a terminal, it drives `hermes acp` over the **Agent Client Protocol
(ACP)** and renders the conversation with Obsidian's own markdown renderer.

> Plugin id: `hermes-console-jpmoo`. This fork replaced the original
> xterm.js/node-pty terminal implementation with an ACP chat client. It is not
> published to Community Plugins — install it manually (below).

## Why a chat panel instead of a terminal

The terminal version replayed Hermes's TUI inside xterm.js, which brought
column-wrapping, ANSI-color, and theming problems into Obsidian. Talking to
Hermes over ACP instead means the plugin **owns the rendering**: clean markdown,
proper theming, a real input box, and structured tool/permission UI — no terminal
artifacts.

## Features

- **Native chat** — user/assistant turns with full markdown, rendered live as the
  response streams (throttled, leading-whitespace trimmed, no layout jump).
- **Reasoning & tools** — collapsible "thinking" blocks and compact tool-call
  chips that flip from *running* to *completed*; inline permission prompts when
  Hermes asks to run a tool.
- **Status line** — current model · live context-window usage · per-turn token
  counts · elapsed turn time · run state.
- **Model picker** — click the model name to switch models mid-session
  (via ACP `session/set_model`), even with custom-endpoint models.
- **Note context** — a header toggle that prepends the active note's selection
  (or cursor surroundings) to your prompt, captured continuously so it survives
  focus moving into the chat.
- **Conversation history** — **New conversation** and a **Continue** dropdown
  listing your recent Hermes conversations (by title, newest first); selecting one
  resumes it. Hermes replays the transcript and restores full context.
- **Persistence** — your conversation survives Obsidian restarts. Choose what
  opens on launch: your last conversation here, the most recent Hermes session,
  or a fresh one.
- **Summarization** — handled by Hermes itself (it compresses context as the
  window fills); nothing to manage in the plugin.

## Requirements

- Obsidian 1.7.2+ (desktop only).
- [Hermes Agent](https://github.com/NousResearch/hermes-agent) installed and
  configured (`hermes acp --check` should print OK). The plugin launches Hermes
  through your login shell, so whatever works in your terminal works here.

## Install (manual)

This fork isn't in Community Plugins. Build it and copy it into your vault:

```bash
git clone https://github.com/jpmoo/fork-obsidian-hermes-console.git
cd fork-obsidian-hermes-console
npm install
npm run build
node install.mjs "/path/to/your/vault"
```

Then restart Obsidian and enable **Hermes Console** under
**Settings → Community Plugins**. Open it from the ribbon icon or the
**Open Hermes Console** command.

`install.mjs` copies just `main.js`, `manifest.json`, and `styles.css` into
`.obsidian/plugins/hermes-console-jpmoo/` — no native modules, no companion files.

## Usage

- Type a message and press **Enter** (Shift+Enter for a newline).
- **Note context**: open a note, select text (or place your cursor), flip the
  **Note context** toggle in the header, then ask Hermes about it. The row under
  the header shows exactly what will be sent.
- **Switch models**: click the model name in the status line.
- **New / continue**: use the compose icon to start fresh, or the history icon to
  pick a past conversation.

## Settings

- **Default location** — right sidebar, bottom split, new tab, or vertical split.
- **On open** — resume your last conversation here / resume the most recent Hermes
  session / start a new conversation.
- **Conversations in history dropdown** — how many recent conversations to list
  (1–50).
- **Hermes command** — command name or absolute path to launch Hermes
  (blank = `hermes` from your shell PATH).
- **Ribbon icon** — any Lucide icon name.

## How it works

The plugin spawns `hermes acp` through your login shell
(`$SHELL -lc 'exec hermes acp'`) so it inherits your real environment, and speaks
newline-delimited JSON-RPC 2.0 over the process's stdio. It runs the ACP
`initialize` → `session/new`/`session/load` → `session/prompt` flow, renders the
streamed `session/update` notifications, and answers Hermes's permission and
file-read/write requests. Conversation persistence and resume use `session/load`
(Hermes replays the transcript); model switching uses `session/set_model`; the
history dropdown uses `session/list`.

See [CLAUDE.md](CLAUDE.md) for the developer-facing architecture and protocol notes.

## Development

```bash
npm install
npm run dev    # watch/rebuild
npm run build  # type-check + production bundle  (check `echo $?` — see CLAUDE.md)
npm test       # vitest
```

## Credits

Hermes Console began as [Lean Terminal](https://github.com/polyipseity/obsidian-lean-terminal)
by polyipseity, was adapted into the terminal-based
[obsidian-hermes-console](https://github.com/dannyshmueli/obsidian-hermes-console)
by Danny Shmueli, and this fork rebuilt it as an ACP chat client. Thanks to the
upstream authors and contributors for the foundation.

## License

[MIT](LICENSE)
