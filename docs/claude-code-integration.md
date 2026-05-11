# Claude Code Integration

Disabled by default. When enabled in settings, the plugin:

- Scans `~/.claude/projects/` for conversation sessions associated with the current vault
- Generates a markdown registry note on demand (**Refresh Claude session registry** command) with clickable Resume links
- Registers the `obsidian://lean-terminal?resume=<session-id>` URI so links in the registry (or any note) open a new terminal tab and run `claude --resume <session-id>` once the shell is ready
- Includes Claude sessions alongside recently closed tabs in the **Restore recent terminal session** picker, sorted by most recent

Sessions started by typing `claude` manually inside a tab are not auto-tracked, but appear in the picker on its next open (the scan runs fresh each time) - click to resume.
