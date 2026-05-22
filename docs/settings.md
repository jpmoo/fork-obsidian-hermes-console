# Settings

| Setting | Default | Description |
|---------|---------|-------------|
| Shell path | Auto-detect | Path to shell executable. Leave empty for auto-detection |
| Startup command | `hermes` | Command to run automatically when a fresh new terminal tab opens. Restored tabs, serialized buffers, and resume commands do not re-run it |
| Font size | 14 | Terminal font size in pixels |
| Font family | Menlo, Monaco, 'Courier New', monospace | Terminal font stack |
| Theme | Obsidian Dark | Color theme for the terminal |
| Icon | Hermes wing/caduceus | Custom icon for the ribbon and panel tab. Any Lucide icon name also works |
| Cursor blink | On | Whether the cursor blinks |
| Scrollback | 500000 | Number of lines kept in scroll history |
| Background color | Theme default | Override the theme background with any CSS color (hex, RGB, etc.) |
| Default location | Right | Where new terminal panels open (Right, Bottom, New tab, or Split right) |
| Notify when background Hermes finishes | On | Sound + Obsidian notice when a background Hermes turn finishes |
| Notification sound | Beep | Choose from Beep, Chime, Ping, or Pop |
| Notification volume | 50 | Volume for notification sounds (0–100) |
| Persist terminal buffer | On | Save scrollback history across restarts. Disable to reduce workspace.json size |
| Enable Hermes session integration | On | Include live `hermes sessions list` results when the user opens Obsidian's command palette and runs **Restore console or Hermes session**; picking one opens a fresh terminal that runs `hermes --resume <session-id>` |
| Hermes sessions to show | 25 | Max live Hermes CLI sessions included in **Restore console or Hermes session**. Sessions are not shown directly in settings |
| Copy on select | Off | Automatically copy selected text to the clipboard |
| Search shortcut | Ctrl+Alt+F | Keyboard shortcut to open the in-terminal search bar |
| Wiki-link autocomplete | Off | Type `[[` in the terminal to open a searchable vault note picker |
| Wiki-link insertion format | Wiki-link | How an accepted note is inserted: `[[Note]]`, vault-relative path, or absolute path |
| Line height | 1.0 | Terminal line height multiplier (1.0-2.0). Changes apply instantly to open tabs |
| Tab bar position | Top | Position of the tab bar: Top (horizontal, default), Left, or Right (vertical stacking) |

Note context sharing is not controlled by a global settings toggle. It is opt-in per Hermes Console terminal tab with the **Send context to Hermes** header toggle, and it defaults off again after plugin reload or Obsidian restart. You can also run **Toggle note context for active Hermes Console tab** from the command palette and bind that command under Settings > Hotkeys. When enabled, Hermes Console sends the current selection first; if nothing is selected, it sends cursor/file context for the active Markdown note.
