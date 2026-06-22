import {
  FileSystemAdapter,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Notice,
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

  // Status bar fields (model · context · tokens · time · state).
  private stateEl!: HTMLElement;
  private modelEl!: HTMLElement;
  private ctxEl!: HTMLElement;
  private tokensEl!: HTMLElement;
  private timeEl!: HTMLElement;

  private turnStart = 0;
  private timeTimer: number | null = null;

  // Note-context feature: a toggle in the header, plus the most recent
  // markdown selection/cursor captured before focus moved to the chat.
  private contextToggleEl!: HTMLElement;
  private contextInfoEl!: HTMLElement;
  private contextEnabled = false;
  private lastNoteContext: {
    path: string;
    basename: string;
    selection: string;
    cursorLine: number;
    around: string;
  } | null = null;

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

    // Header — title (matches the pane/tab name) + note-context toggle.
    const header = container.createDiv({ cls: "hermes-chat-header" });
    header.createDiv({ cls: "hermes-chat-title", text: "Hermes Console" });
    this.contextInfoEl = header.createDiv({ cls: "hermes-context-info" });
    this.contextToggleEl = header.createDiv({ cls: "hermes-context-toggle" });
    this.contextToggleEl.createDiv({ cls: "hermes-context-switch" }).createDiv({ cls: "hermes-context-knob" });
    this.contextToggleEl.createSpan({ cls: "hermes-context-label", text: "Note context" });
    this.contextToggleEl.addEventListener("click", () => this.toggleContext());

    this.messagesEl = container.createDiv({ cls: "hermes-chat-messages" });

    const inputRow = container.createDiv({ cls: "hermes-chat-input-row" });
    this.inputEl = inputRow.createEl("textarea", {
      cls: "hermes-chat-input",
      attr: { placeholder: "Message Hermes…", rows: "1" },
    });
    this.sendButton = inputRow.createEl("button", { cls: "hermes-chat-send", text: "Send" });

    const status = container.createDiv({ cls: "hermes-chat-status" });
    this.modelEl = status.createSpan({ cls: "hermes-stat hermes-stat-model" });
    this.modelEl.addEventListener("click", (e) => this.openModelMenu(e));
    this.ctxEl = status.createSpan({ cls: "hermes-stat hermes-stat-ctx" });
    this.tokensEl = status.createSpan({ cls: "hermes-stat hermes-stat-tokens" });
    this.timeEl = status.createSpan({ cls: "hermes-stat hermes-stat-time" });
    this.stateEl = status.createSpan({ cls: "hermes-stat hermes-stat-state" });

    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        void this.handleSend();
      }
    });
    this.inputEl.addEventListener("input", () => this.autoGrowInput());
    this.sendButton.addEventListener("click", () => void this.handleSend());

    // Track the active note's selection/cursor so it's available after focus
    // moves into the chat input. Captured continuously while a note is active.
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => this.captureNoteContext()));
    this.registerEvent(this.app.workspace.on("file-open", () => this.captureNoteContext()));
    this.registerDomEvent(document, "selectionchange", () => this.captureNoteContext());
    this.captureNoteContext();
    this.updateContextUI();

    // Connect in the background. Awaiting here would block Obsidian's
    // workspace restore on the multi-second `hermes acp` boot.
    void this.connect();
  }

  async onClose(): Promise<void> {
    this.stopTurnTimer();
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
      this.updateModel();
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

    // Prepend the active note's context when the toggle is on.
    const contextBlock = this.buildContextBlock();
    const prompt = contextBlock ? `${contextBlock}\n\n${text}` : text;

    this.turnActive = true;
    this.sendButton.disabled = true;
    this.setStatus("Thinking…");
    this.resetSegments();
    this.startTurnTimer();

    try {
      const result = await this.client.prompt(prompt);
      if (result.usage) this.updateTokens(result.usage);
      this.setStatus("Ready.");
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.stopTurnTimer();
      this.renderElapsed();
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
          this.updateContext(used, size);
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

  // --- note context ----------------------------------------------------

  /** Remember the active markdown note's selection/cursor for later sends. */
  private captureNoteContext(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return; // chat focused / no note — keep the last capture
    const editor = view.editor;
    const cursor = editor.getCursor();
    const from = Math.max(0, cursor.line - 10);
    const to = Math.min(editor.lineCount() - 1, cursor.line + 10);
    const around: string[] = [];
    for (let i = from; i <= to; i++) around.push(editor.getLine(i));
    this.lastNoteContext = {
      path: view.file.path,
      basename: view.file.basename,
      selection: editor.getSelection(),
      cursorLine: cursor.line,
      around: around.join("\n"),
    };
    if (this.contextEnabled) this.updateContextUI();
  }

  private toggleContext(): void {
    this.contextEnabled = !this.contextEnabled;
    this.updateContextUI();
  }

  private updateContextUI(): void {
    this.contextToggleEl.toggleClass("hermes-context-toggle--on", this.contextEnabled);
    if (!this.contextEnabled) {
      this.contextInfoEl.setText("");
      return;
    }
    const c = this.lastNoteContext;
    if (!c) {
      this.contextInfoEl.setText("no active note");
      return;
    }
    const kind = c.selection.trim() ? "selection" : `cursor · line ${c.cursorLine + 1}`;
    this.contextInfoEl.setText(`${c.basename} · ${kind}`);
  }

  /** Build the context preamble sent to Hermes, or null when disabled/empty. */
  private buildContextBlock(): string | null {
    if (!this.contextEnabled || !this.lastNoteContext) return null;
    const c = this.lastNoteContext;
    const body = c.selection.trim()
      ? `Selected text:\n"""\n${c.selection}\n"""`
      : `Text around the cursor (line ${c.cursorLine + 1}):\n"""\n${c.around}\n"""`;
    return [
      "[Obsidian note context — provided automatically; treat as reference]",
      `Note: ${c.basename} (${c.path})`,
      body,
      "[End note context]",
    ].join("\n");
  }

  private setStatus(text: string): void {
    this.stateEl.setText(text);
  }

  private updateModel(): void {
    const name = this.client?.model?.name ?? "";
    this.modelEl.setText(name ? `${name} ▾` : "");
    const hasChoices = (this.client?.availableModels.length ?? 0) > 1;
    this.modelEl.toggleClass("hermes-stat-model--clickable", hasChoices);
    this.modelEl.setAttr("title", hasChoices ? "Click to switch model" : "");
  }

  private openModelMenu(evt: MouseEvent): void {
    const client = this.client;
    if (!client) return;
    // Embedding models can't drive a chat turn — keep them out of the picker.
    const models = client.availableModels.filter((m) => !/embed/i.test(m.modelId));
    if (models.length < 2) return;

    const menu = new Menu();
    for (const m of models) {
      menu.addItem((item) => {
        item.setTitle(m.name).setChecked(m.modelId === client.model?.id);
        item.onClick(() => void this.switchModel(m.modelId));
      });
    }
    menu.showAtMouseEvent(evt);
  }

  private async switchModel(modelId: string): Promise<void> {
    if (!this.client || this.turnActive) {
      if (this.turnActive) new Notice("Wait for the current turn to finish before switching models.");
      return;
    }
    try {
      await this.client.setModel(modelId);
      this.updateModel();
      this.setStatus(`Switched to ${this.client.model?.name}`);
    } catch (err) {
      new Notice(`Failed to switch model: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  private updateContext(used: number, size: number): void {
    const pct = size > 0 ? Math.round((used / size) * 100) : 0;
    this.ctxEl.setText(`ctx ${pct}%`);
    this.ctxEl.setAttr("title", `Context: ${used.toLocaleString()} / ${size.toLocaleString()} tokens`);
  }

  private updateTokens(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }): void {
    const fmt = (n?: number) => (typeof n === "number" ? (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n)) : "0");
    this.tokensEl.setText(`↑${fmt(usage.inputTokens)} ↓${fmt(usage.outputTokens)}`);
    this.tokensEl.setAttr("title", `Tokens — in: ${usage.inputTokens ?? 0}, out: ${usage.outputTokens ?? 0}, total: ${usage.totalTokens ?? 0}`);
  }

  private startTurnTimer(): void {
    this.turnStart = Date.now();
    this.stopTurnTimer();
    this.timeTimer = window.setInterval(() => this.renderElapsed(), 1000);
    this.renderElapsed();
  }

  private stopTurnTimer(): void {
    if (this.timeTimer !== null) {
      window.clearInterval(this.timeTimer);
      this.timeTimer = null;
    }
  }

  private renderElapsed(): void {
    const secs = Math.round((Date.now() - this.turnStart) / 1000);
    this.timeEl.setText(secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs}s`);
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
