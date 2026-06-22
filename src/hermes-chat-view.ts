import {
  FileSystemAdapter,
  ItemView,
  MarkdownRenderer,
  WorkspaceLeaf,
} from "obsidian";
import { VIEW_TYPE_TERMINAL } from "./constants";
import { AcpClient, type AcpSessionUpdate, type AcpPermissionRequest } from "./acp-client";
import type HermesPlugin from "./main";

/**
 * Native Hermes chat panel. Drives `hermes acp` and renders the streamed
 * conversation with Obsidian's own markdown renderer — no terminal emulation.
 */
export class HermesChatView extends ItemView {
  private plugin: HermesPlugin;
  private client: AcpClient | null = null;

  private messagesEl!: HTMLElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private statusEl!: HTMLElement;

  // The conversation is rendered as ordered segments in arrival order:
  // thought → text → tool → text → … Each segment is finalized (markdown
  // rendered) when a different segment type begins or the turn ends, so the
  // transcript reads top-to-bottom in the order Hermes produced it.
  private activeTextEl: HTMLElement | null = null;
  private activeTextBuf = "";
  private activeThoughtEl: HTMLElement | null = null;
  private activeThoughtBuf = "";
  private turnActive = false;
  private connected = false;

  constructor(leaf: WorkspaceLeaf, plugin: HermesPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE_TERMINAL;
  }

  getDisplayText(): string {
    return "Hermes Console";
  }

  getIcon(): string {
    return this.plugin.settings.ribbonIcon;
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("hermes-chat");

    this.messagesEl = container.createDiv({ cls: "hermes-chat-messages" });

    const inputRow = container.createDiv({ cls: "hermes-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "hermes-chat-input",
      attr: { placeholder: "Message Hermes…", rows: "1" },
    });
    this.sendButton = inputRow.createEl("button", { cls: "hermes-chat-send", text: "Send" });

    this.statusEl = container.createDiv({ cls: "hermes-chat-status" });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });
    this.inputEl.addEventListener("input", () => this.autoGrowInput());
    this.sendButton.addEventListener("click", () => void this.handleSend());

    // Connect in the background. Awaiting here would block Obsidian's
    // workspace restore on the multi-second `hermes acp` boot.
    void this.connect();
  }

  async onClose(): Promise<void> {
    this.client?.dispose();
    this.client = null;
  }

  // --- connection ------------------------------------------------------

  private async connect(): Promise<void> {
    this.setStatus("Starting Hermes…");
    let cwd: string;
    try {
      cwd = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
    } catch {
      cwd = process.cwd();
    }

    this.client = new AcpClient(
      {
        onSessionUpdate: (u) => this.handleUpdate(u),
        onRequestPermission: (req) => this.handlePermission(req),
        onError: (msg) => this.setStatus(`Error: ${msg}`),
        onExit: (code) => this.setStatus(`Hermes exited (code ${code ?? "?"}).`),
      },
      this.plugin.settings.hermesPath || "hermes",
    );

    try {
      await this.client.start(cwd);
      this.connected = true;
      this.setStatus("Ready.");
      this.inputEl.focus();
    } catch (err) {
      this.setStatus(`Failed to start Hermes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // --- sending ---------------------------------------------------------

  private async handleSend(): Promise<void> {
    const text = this.inputEl.value.trim();
    if (!text || this.turnActive) return;
    if (!this.client || !this.connected) {
      this.setStatus("Hermes is still starting — please wait…");
      return;
    }

    this.inputEl.value = "";
    this.autoGrowInput();
    this.addUserMessage(text);

    this.turnActive = true;
    this.sendButton.disabled = true;
    this.setStatus("Hermes is thinking…");
    this.resetSegments();

    try {
      await this.client.prompt(text);
      this.setStatus("Ready.");
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.finalizeSegments();
      this.turnActive = false;
      this.sendButton.disabled = false;
      this.inputEl.focus();
    }
  }

  // --- streamed updates ------------------------------------------------

  private handleUpdate(update: AcpSessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        this.appendText(update.content?.text ?? "");
        break;
      }
      case "agent_thought_chunk": {
        this.appendThought(update.content?.text ?? "");
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        // A tool boundary ends the current text/thought segment so later text
        // renders as its own block below the tool, preserving order.
        this.finalizeTextSegment();
        this.activeThoughtEl = null;
        this.upsertToolCall(update);
        break;
      }
      case "usage_update": {
        const used = update.used as number | undefined;
        const size = update.size as number | undefined;
        if (typeof used === "number" && typeof size === "number") {
          this.setStatus(`Context: ${Math.round((used / size) * 100)}% (${used.toLocaleString()} / ${size.toLocaleString()})`);
        }
        break;
      }
      default:
        break;
    }
  }

  private async handlePermission(req: AcpPermissionRequest): Promise<string | null> {
    return new Promise((resolve) => {
      const wrap = this.messagesEl.createDiv({ cls: "hermes-permission" });
      wrap.createDiv({
        cls: "hermes-permission-title",
        text: `Allow: ${req.toolCall?.title ?? "tool call"}?`,
      });
      const buttons = wrap.createDiv({ cls: "hermes-permission-buttons" });
      for (const opt of req.options) {
        const btn = buttons.createEl("button", { cls: "hermes-permission-btn", text: opt.name });
        if (opt.kind?.startsWith("allow")) btn.addClass("mod-cta");
        btn.addEventListener("click", () => {
          wrap.remove();
          resolve(opt.optionId);
        });
      }
      this.scrollToBottom();
    });
  }

  // --- message DOM -----------------------------------------------------

  private addUserMessage(text: string): void {
    const el = this.messagesEl.createDiv({ cls: "hermes-msg hermes-msg-user" });
    el.createDiv({ cls: "hermes-msg-role", text: "You" });
    const body = el.createDiv({ cls: "hermes-msg-body" });
    void MarkdownRenderer.render(this.app, text, body, "", this);
    this.scrollToBottom();
  }

  /** Reset per-turn segment state (no DOM is created up-front). */
  private resetSegments(): void {
    this.activeTextEl = null;
    this.activeTextBuf = "";
    this.activeThoughtEl = null;
    this.activeThoughtBuf = "";
  }

  /** Finalize any open text/thought segment at the end of a turn. */
  private finalizeSegments(): void {
    this.finalizeTextSegment();
    this.activeThoughtEl = null;
    this.scrollToBottom();
  }

  private appendText(text: string): void {
    if (!text) return;
    // Starting text closes any open thought block.
    this.activeThoughtEl = null;
    if (!this.activeTextEl) {
      const el = this.messagesEl.createDiv({ cls: "hermes-msg hermes-msg-assistant" });
      el.createDiv({ cls: "hermes-msg-role", text: "Hermes" });
      this.activeTextEl = el.createDiv({ cls: "hermes-msg-body hermes-streaming" });
      this.activeTextBuf = "";
    }
    this.activeTextBuf += text;
    this.activeTextEl.setText(this.activeTextBuf);
    this.scrollToBottom();
  }

  /** Render the current text segment as markdown and close it. */
  private finalizeTextSegment(): void {
    if (this.activeTextEl) {
      if (this.activeTextBuf.trim()) {
        this.activeTextEl.removeClass("hermes-streaming");
        this.activeTextEl.empty();
        void MarkdownRenderer.render(this.app, this.activeTextBuf, this.activeTextEl, "", this);
      } else {
        this.activeTextEl.parentElement?.remove();
      }
    }
    this.activeTextEl = null;
    this.activeTextBuf = "";
  }

  private appendThought(text: string): void {
    if (!text) return;
    // A thought starts a new block after any text segment.
    this.finalizeTextSegment();
    if (!this.activeThoughtEl) {
      const details = this.messagesEl.createEl("details", { cls: "hermes-thought" });
      details.createEl("summary", { text: "Thinking…" });
      this.activeThoughtEl = details.createDiv({ cls: "hermes-thought-body" });
      this.activeThoughtBuf = "";
    }
    this.activeThoughtBuf += text;
    this.activeThoughtEl.setText(this.activeThoughtBuf);
    this.scrollToBottom();
  }

  /** Create or update a tool-call chip, keyed by toolCallId. */
  private upsertToolCall(update: AcpSessionUpdate): void {
    const id = (update.toolCallId as string) ?? "";
    let el = id
      ? this.messagesEl.querySelector<HTMLElement>(`[data-tool-call-id="${id}"]`)
      : null;

    if (!el) {
      el = this.messagesEl.createDiv({ cls: "hermes-tool-call" });
      if (id) el.dataset.toolCallId = id;
      el.createSpan({ cls: "hermes-tool-icon", text: "›" });
      el.createSpan({ cls: "hermes-tool-title" });
      el.createSpan({ cls: "hermes-tool-status" });
    }

    const title = (update.title as string) || el.querySelector(".hermes-tool-title")?.textContent || "tool";
    el.querySelector(".hermes-tool-title")?.setText(title);

    // tool_call has no status (still running); tool_call_update carries it.
    const status = (update.status as string) || (update.sessionUpdate === "tool_call" ? "running" : "");
    if (status) {
      const statusEl = el.querySelector<HTMLElement>(".hermes-tool-status");
      statusEl?.setText(status);
      el.dataset.status = status;
    }
    this.scrollToBottom();
  }

  // --- helpers ---------------------------------------------------------

  private setStatus(text: string): void {
    this.statusEl.setText(text);
  }

  private scrollToBottom(): void {
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private autoGrowInput(): void {
    this.inputEl.style.height = "auto";
    this.inputEl.style.height = `${Math.min(this.inputEl.scrollHeight, 200)}px`;
  }

  /** Public hook used by the plugin to focus the input when revealed. */
  focusInput(): void {
    this.inputEl?.focus();
  }
}
