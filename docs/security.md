# Security

Hermes Console is a desktop Obsidian plugin that embeds a real PTY. It also includes a Hermes-side plugin for opt-in selected-note/cursor context and tab busy/idle status. This page documents the current security posture and the main boundaries to understand.

## Local-only architecture

Hermes Console does not run a network server for the context bridge.

The Obsidian plugin and the Hermes-side bridge use local JSON files inside the active vault:

```text
<vault>/.obsidian/hermes/context.json
<vault>/.obsidian/hermes/runtime/<tab-id>.json
```

The context file carries note context only when note context sharing is enabled for a Hermes Console terminal tab; disabled tabs write a detach marker. The runtime file carries tab busy/idle status.

The Hermes process launched by Hermes Console receives explicit environment variables such as `OBSIDIAN_CONTEXT_BRIDGE_PATH` and `OBSIDIAN_HERMES_STATUS_PATH`. The Hermes-side `obsidian-context-bridge` plugin reads/writes those local files through Hermes hooks.

There is no socket, clipboard trick, browser extension, or external service in this bridge.

Note context sharing is controlled per Hermes Console terminal tab by the **Send context to Hermes** header toggle, or by the command palette command **Toggle note context for active Hermes Console tab** for users who want a hotkey. It defaults off after plugin reload or Obsidian restart. Enabled tabs send the current selection first; if nothing is selected, they send cursor/file context for the active Markdown note.

## Native terminal boundary

Hermes Console uses `node-pty` to run the configured shell and startup command. This is the point of the plugin: it is a real terminal, not a restricted command runner.

Security implications:

- Commands typed into the terminal run with the same permissions as the local user.
- The startup command defaults to `hermes` for fresh tabs.
- Restored terminal tabs restore scrollback/history visually; the old shell process does not survive Obsidian quit.
- Hermes session restore runs `hermes --resume <session-id>` for a selected live Hermes session.

## Native binary download integrity

Community Plugins and BRAT install the Obsidian plugin assets, but native `node-pty` binaries are downloaded from GitHub Releases after the user clicks **Settings > Hermes Console > Download binaries**.

Hermes Console verifies each downloaded ZIP with SHA-256 against the `checksums.json` file published alongside the release. Checksum verification is mandatory: if `checksums.json` is unreachable or does not contain the downloaded asset, installation is aborted.

SHA-256 checksums for each release are attached to every GitHub Release:

https://github.com/dannyshmueli/obsidian-hermes-console/releases

## Context injection safety

Selected note text is treated as untrusted data.

The bridge injects context into Hermes using serialized fields rather than raw markdown fences. This avoids common boundary breaks such as selected text containing triple backticks, fake XML/system tags, or closing tags.

Large selections can be exposed through the explicit `obsidian_context()` Hermes tool instead of forcing the full text into the prompt body.

## Filesystem scope

Expected filesystem access:

- spawn the configured shell through `node-pty`
- read/write plugin settings and workspace state through Obsidian APIs where possible
- download and unpack platform-specific `node-pty` binaries into the plugin directory
- write/read bridge JSON files under `<vault>/.obsidian/hermes/`
- validate explicit user-provided directories for URI/open-here flows

The bridge files stay inside the active vault's `.obsidian/hermes/` directory.

## Review checks performed

Recent release checks cover:

- PTY spawn path handling and shell/startup command behavior
- URI handler input validation for `cwd` and `resume`
- path traversal risks in binary ZIP extraction and bridge file paths
- checksum enforcement for native binary downloads
- Obsidian UI rendering paths: no dynamic HTML injection for terminal metadata
- hardcoded secrets and sensitive logs
- GitHub Actions release workflow and release assets
- npm dependency audit posture

## No known issues in current release path

No known release-blocking issues are open in the current Community Plugin path for:

- binary checksum verification
- selected-note/cursor context bridge installation model
- Hermes busy/idle status bridge
- public manifest metadata
- default new-install behavior
