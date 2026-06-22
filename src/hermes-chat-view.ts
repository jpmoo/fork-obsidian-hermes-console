import {
  FileSystemAdapter,
  ItemView,
  MarkdownRenderer,
  MarkdownView,
  Menu,
  Notice,
  WorkspaceLeaf,
  setIcon,
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
  private emptyEl!: HTMLElement;
  private newBtn!: HTMLButtonElement;
  private inputEl!: HTMLTextAreaElement;
  private sendButton!: HTMLButtonElement;
  private messageObserver: MutationObserver | null = null;

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
    fromCursor: string;
  } | null = null;

  // The conversation is rendered as ordered segments in arrival order:
  // thought → text → tool → text → … Each segment is finalized (markdown
  // rendered) when a different segment type begins or the turn ends, so the
  // transcript reads top-to-bottom in the order Hermes produced it.
  private activeTextEl: HTMLElement | null = null;
  private activeTextBuf = "";
  private activeThoughtEl: HTMLElement | null = null;
  private activeThoughtBuf = "";
  private streamRenderScheduled = false;
  // Used only during session-load replay, to rebuild past user messages.
  private activeUserEl: HTMLElement | null = null;
  private activeUserBuf = "";
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
    this.contextToggleEl = header.createDiv({ cls: "hermes-context-toggle" });
    this.contextToggleEl.createDiv({ cls: "hermes-context-switch" }).createDiv({ cls: "hermes-context-knob" });
    this.contextToggleEl.createSpan({ cls: "hermes-context-label", text: "Note context" });
    this.contextToggleEl.addEventListener("click", () => this.toggleContext());

    this.newBtn = header.createEl("button", { cls: "hermes-chat-iconbtn", attr: { "aria-label": "New conversation" } });
    setIcon(this.newBtn, "square-pen");
    this.newBtn.title = "New conversation";
    this.newBtn.addEventListener("click", () => void this.newConversation());

    const historyBtn = header.createEl("button", { cls: "hermes-chat-iconbtn", attr: { "aria-label": "Continue a conversation" } });
    setIcon(historyBtn, "history");
    historyBtn.title = "Continue a conversation";
    historyBtn.addEventListener("click", (e) => void this.openHistoryMenu(e));

    // Context detail on its own row beneath the header (single truncated line).
    this.contextInfoEl = container.createDiv({ cls: "hermes-context-info" });

    this.messagesEl = container.createDiv({ cls: "hermes-chat-messages" });
    this.emptyEl = this.messagesEl.createDiv({ cls: "hermes-empty" });
    this.emptyEl.setText("Start typing to Hermes, or use the dropdown above to continue an existing conversation.");

    // Keep the empty-state placeholder and the dimmed "new" button in sync
    // with whether the transcript has any content.
    this.messageObserver = new MutationObserver(() => this.updateEmptyState());
    this.messageObserver.observe(this.messagesEl, { childList: true });
    this.updateEmptyState();

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
    this.messageObserver?.disconnect();
    this.messageObserver = null;
    this.client?.dispose();
    this.client = null;
  }

  // --- connection ------------------------------------------------------

  private cwd(): string {
    try {
      return (this.app.vault.adapter as FileSystemAdapter).getBasePath();
    } catch {
      return process.cwd();
    }
  }

  private async connect(): Promise<void> {
    this.setStatus("Starting Hermes…");
    const cwd = this.cwd();

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
      await this.openInitialSession(cwd);
      this.setStatus("Ready.");
      this.inputEl.focus();
    } catch (err) {
      this.setStatus(`Failed to start Hermes: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Decide which session to open on first load, per the user's setting. */
  private async openInitialSession(cwd: string): Promise<void> {
    const behavior = this.plugin.settings.startupBehavior;

    if (behavior === "new") {
      this.deferNewSession();
      return;
    }

    // resume-last-obsidian (default)
    const id = this.plugin.settings.lastSessionId;
    if (id && this.client?.supportsLoad) {
      try {
        await this.resumeSession(cwd, id);
        return;
      } catch (err) {
        console.warn("[Hermes] resume failed, starting fresh:", err);
      }
    }
    this.deferNewSession();
  }

  /** Prepare a blank conversation without creating a Hermes session — the
   *  session is created lazily on the first send (see handleSend). */
  private deferNewSession(): void {
    this.client?.clearSession();
    this.updateModel();
  }

  private async resumeSession(cwd: string, sessionId: string): Promise<void> {
    if (!this.client) return;
    this.setStatus("Loading conversation…");
    // Replay arrives via session/update during loadSession and renders here.
    await this.client.loadSession(cwd, sessionId);
    this.finalizeSegments();
    this.updateModel();
    await this.persistSessionId();
  }

  private async persistSessionId(): Promise<void> {
    const sid = this.client?.getSessionId();
    if (sid && sid !== this.plugin.settings.lastSessionId) {
      this.plugin.settings.lastSessionId = sid;
      await this.plugin.saveSettings();
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

    this.turnActive = true;
    this.sendButton.disabled = true;

    // Lazily create the Hermes session on first send, so a new conversation
    // never hits Hermes until the user actually sends something.
    if (!this.client.getSessionId()) {
      this.setStatus("Starting conversation…");
      try {
        await this.client.newSession(this.cwd());
        this.updateModel();
        await this.persistSessionId();
      } catch (err) {
        this.setStatus(`Failed to start: ${err instanceof Error ? err.message : String(err)}`);
        this.turnActive = false;
        this.sendButton.disabled = false;
        return;
      }
    }

    this.inputEl.value = "";
    this.autoGrowInput();
    this.addUserMessage(text);

    // Prepend the active note's context when the toggle is on.
    const contextBlock = this.buildContextBlock();
    const prompt = contextBlock ? `${contextBlock}\n\n${text}` : text;

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
      case "user_message_chunk": {
        // Emitted when Hermes replays history on session/load. A new user
        // message closes the previous turn's assistant text/thought segments.
        this.finalizeTextSegment();
        this.activeThoughtEl = null;
        this.appendUserText(update.content?.text ?? "");
        break;
      }
      case "agent_message_chunk": {
        this.finalizeUserSegment();
        this.appendText(update.content?.text ?? "");
        break;
      }
      case "agent_thought_chunk": {
        this.finalizeUserSegment();
        this.appendThought(update.content?.text ?? "");
        break;
      }
      case "tool_call":
      case "tool_call_update": {
        // A tool boundary ends the current text/thought segment so later text
        // renders as its own block below the tool, preserving order.
        this.finalizeUserSegment();
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
    this.activeUserEl = null;
    this.activeUserBuf = "";
  }

  /** Finalize any open user/text/thought segment at the end of a turn. */
  private finalizeSegments(): void {
    this.finalizeUserSegment();
    this.finalizeTextSegment();
    this.activeThoughtEl = null;
    this.scrollToBottom();
  }

  /** Accumulate a replayed user message (session/load) into a user bubble. */
  private appendUserText(text: string): void {
    if (!text) return;
    if (!this.activeUserEl) {
      const el = this.messagesEl.createDiv({ cls: "hermes-msg hermes-msg-user" });
      el.createDiv({ cls: "hermes-msg-role", text: "You" });
      this.activeUserEl = el.createDiv({ cls: "hermes-msg-body" });
      this.activeUserBuf = "";
    }
    this.activeUserBuf += text;
    this.activeUserEl.setText(this.activeUserBuf);
    this.scrollToBottom();
  }

  private finalizeUserSegment(): void {
    if (this.activeUserEl && this.activeUserBuf.trim()) {
      this.activeUserEl.empty();
      void MarkdownRenderer.render(this.app, this.activeUserBuf, this.activeUserEl, "", this);
    }
    this.activeUserEl = null;
    this.activeUserBuf = "";
  }

  private appendText(text: string): void {
    if (!text) return;
    // Starting text closes any open thought block.
    this.activeThoughtEl = null;
    if (!this.activeTextEl) {
      const el = this.messagesEl.createDiv({ cls: "hermes-msg hermes-msg-assistant" });
      el.createDiv({ cls: "hermes-msg-role", text: "Hermes" });
      this.activeTextEl = el.createDiv({ cls: "hermes-msg-body" });
      this.activeTextBuf = "";
    }
    this.activeTextBuf += text;
    this.scheduleStreamRender();
  }

  /** Re-render the streaming buffer as markdown, throttled to one paint. */
  private scheduleStreamRender(): void {
    if (this.streamRenderScheduled) return;
    this.streamRenderScheduled = true;
    window.requestAnimationFrame(() => {
      this.streamRenderScheduled = false;
      if (this.activeTextEl) this.renderMarkdownInto(this.activeTextEl, this.activeTextBuf);
      this.scrollToBottom();
    });
  }

  /** Render the current text segment as markdown and close it. */
  private finalizeTextSegment(): void {
    if (this.activeTextEl) {
      if (this.activeTextBuf.trim()) {
        this.renderMarkdownInto(this.activeTextEl, this.activeTextBuf);
      } else {
        this.activeTextEl.parentElement?.remove();
      }
    }
    this.activeTextEl = null;
    this.activeTextBuf = "";
  }

  /** Replace an element's content with rendered markdown (leading blank
   *  lines trimmed so there's no gap under the role band while streaming). */
  private renderMarkdownInto(el: HTMLElement, markdown: string): void {
    el.empty();
    void MarkdownRenderer.render(this.app, markdown.replace(/^\s+/, ""), el, "", this);
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

  /** Start a fresh conversation. The previous one is kept in Hermes history
   *  (resumable from the dropdown), so no destructive confirm is needed. */
  private async newConversation(): Promise<void> {
    if (this.turnActive) {
      new Notice("Wait for the current turn to finish first.");
      return;
    }
    if (!this.client || !this.connected) {
      new Notice("Hermes is still starting…");
      return;
    }
    this.clearTranscript();
    this.clearStats();
    // Defer the Hermes session until the first message is sent.
    this.deferNewSession();
    this.setStatus("Ready.");
    this.inputEl.focus();
  }

  /** Open a menu of recent Hermes conversations to continue. */
  private async openHistoryMenu(evt: MouseEvent): Promise<void> {
    if (!this.client || !this.connected) {
      new Notice("Hermes is still starting…");
      return;
    }
    let sessions: Awaited<ReturnType<AcpClient["listSessions"]>>;
    try {
      sessions = await this.client.listSessions();
    } catch (err) {
      new Notice(`Could not list conversations: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const list = sessions.slice(0, this.plugin.settings.historyCount);
    if (!list.length) {
      new Notice("No past conversations yet.");
      return;
    }
    const menu = new Menu();
    const current = this.client.getSessionId();
    for (const s of list) {
      menu.addItem((item) => {
        item
          .setTitle(`${s.title || "(untitled)"}  ·  ${this.timeAgo(s.updatedAt)}`)
          .setChecked(s.sessionId === current)
          .onClick(() => void this.loadConversation(s.sessionId));
      });
    }
    menu.showAtMouseEvent(evt);
  }

  /** Clear the buffer and load a past conversation. */
  private async loadConversation(sessionId: string): Promise<void> {
    if (this.turnActive) {
      new Notice("Wait for the current turn to finish first.");
      return;
    }
    if (!this.client || !this.connected) return;
    if (sessionId === this.client.getSessionId()) return; // already open
    this.clearTranscript();
    this.clearStats();
    try {
      await this.resumeSession(this.cwd(), sessionId);
      this.setStatus("Ready.");
    } catch (err) {
      new Notice(`Failed to load conversation: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /** Remove all transcript nodes but keep the empty-state placeholder. */
  private clearTranscript(): void {
    this.messagesEl.empty();
    this.messagesEl.appendChild(this.emptyEl);
    this.resetSegments();
  }

  private clearStats(): void {
    this.tokensEl.setText("");
    this.timeEl.setText("");
    this.ctxEl.setText("");
  }

  /** Show the placeholder and dim the New button when the transcript is empty. */
  private updateEmptyState(): void {
    const hasContent = !!this.messagesEl.querySelector(
      ".hermes-msg, .hermes-tool-call, .hermes-thought, .hermes-permission",
    );
    this.emptyEl.toggle(!hasContent);
    this.newBtn?.toggleClass("is-dimmed", !hasContent);
  }

  private timeAgo(iso: string): string {
    const then = new Date(iso).getTime();
    if (!Number.isFinite(then)) return "";
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.round(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.round(hrs / 24)}d ago`;
  }

  // --- note context ----------------------------------------------------

  /** Remember the active markdown note's selection/cursor for later sends. */
  private captureNoteContext(): void {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.file) return; // chat focused / no note — keep the last capture
    const editor = view.editor;
    const cursor = editor.getCursor();
    // From the cursor line through the end of the note.
    const lines: string[] = [];
    for (let i = cursor.line; i < editor.lineCount(); i++) lines.push(editor.getLine(i));
    this.lastNoteContext = {
      path: view.file.path,
      basename: view.file.basename,
      selection: editor.getSelection(),
      cursorLine: cursor.line,
      fromCursor: lines.join("\n"),
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
      this.contextInfoEl.setText("sending: no active note");
      return;
    }
    const kind = c.selection.trim() ? "selection" : `from line ${c.cursorLine + 1} → end`;
    this.contextInfoEl.setText(`sending: ${c.basename} · ${kind}`);
  }

  /** Build the context preamble sent to Hermes, or null when disabled/empty. */
  private buildContextBlock(): string | null {
    if (!this.contextEnabled || !this.lastNoteContext) return null;
    const c = this.lastNoteContext;
    const body = c.selection.trim()
      ? `Selected text:\n"""\n${c.selection}\n"""`
      : `Note text from the cursor (line ${c.cursorLine + 1}) to the end:\n"""\n${c.fromCursor}\n"""`;
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
