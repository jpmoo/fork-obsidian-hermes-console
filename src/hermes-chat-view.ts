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

  /** The assistant bubble currently being streamed into. */
  private streamingEl: HTMLElement | null = null;
  private streamingText = "";
  /** The thought block for the in-flight turn (collapsible). */
  private thoughtBodyEl: HTMLElement | null = null;
  private thoughtText = "";
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
      this.plugin.settings.shellPath || "hermes",
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
    this.beginAssistantMessage();

    try {
      await this.client.prompt(text);
      this.setStatus("Ready.");
    } catch (err) {
      this.setStatus(`Error: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      this.finishAssistantMessage();
      this.turnActive = false;
      this.sendButton.disabled = false;
      this.inputEl.focus();
    }
  }

  // --- streamed updates ------------------------------------------------

  private handleUpdate(update: AcpSessionUpdate): void {
    switch (update.sessionUpdate) {
      case "agent_message_chunk": {
        const text = update.content?.text ?? "";
        this.streamingText += text;
        if (this.streamingEl) this.streamingEl.setText(this.streamingText);
        this.scrollToBottom();
        break;
      }
      case "agent_thought_chunk": {
        const text = update.content?.text ?? "";
        this.thoughtText += text;
        this.ensureThoughtBlock();
        this.thoughtBodyEl?.setText(this.thoughtText);
        this.scrollToBottom();
        break;
      }
      case "tool_call": {
        this.addToolCall(update);
        break;
      }
      case "tool_call_update": {
        this.updateToolCall(update);
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

  private beginAssistantMessage(): void {
    this.streamingText = "";
    this.thoughtText = "";
    this.thoughtBodyEl = null;

    const el = this.messagesEl.createDiv({ cls: "hermes-msg hermes-msg-assistant" });
    el.createDiv({ cls: "hermes-msg-role", text: "Hermes" });
    this.streamingEl = el.createDiv({ cls: "hermes-msg-body hermes-streaming" });
    this.scrollToBottom();
  }

  private finishAssistantMessage(): void {
    if (this.streamingEl && this.streamingText) {
      this.streamingEl.removeClass("hermes-streaming");
      this.streamingEl.empty();
      void MarkdownRenderer.render(this.app, this.streamingText, this.streamingEl, "", this);
    } else if (this.streamingEl && !this.streamingText) {
      // No visible output (e.g. tool-only turn) — drop the empty bubble.
      this.streamingEl.parentElement?.remove();
    }
    this.streamingEl = null;
    this.scrollToBottom();
  }

  private ensureThoughtBlock(): void {
    if (this.thoughtBodyEl) return;
    const details = this.messagesEl.createEl("details", { cls: "hermes-thought" });
    details.createEl("summary", { text: "Thinking…" });
    this.thoughtBodyEl = details.createDiv({ cls: "hermes-thought-body" });
  }

  private addToolCall(update: AcpSessionUpdate): void {
    const title = (update.title as string) ?? (update.kind as string) ?? "Tool call";
    const id = (update.toolCallId as string) ?? "";
    const el = this.messagesEl.createDiv({ cls: "hermes-tool-call" });
    if (id) el.dataset.toolCallId = id;
    el.createSpan({ cls: "hermes-tool-icon", text: "⚙" });
    el.createSpan({ cls: "hermes-tool-title", text: title });
    const status = (update.status as string) ?? "pending";
    el.createSpan({ cls: "hermes-tool-status", text: status });
    this.scrollToBottom();
  }

  private updateToolCall(update: AcpSessionUpdate): void {
    const id = (update.toolCallId as string) ?? "";
    if (!id) return;
    const el = this.messagesEl.querySelector<HTMLElement>(`[data-tool-call-id="${id}"]`);
    if (!el) return;
    const status = (update.status as string) ?? "";
    const statusEl = el.querySelector<HTMLElement>(".hermes-tool-status");
    if (statusEl && status) statusEl.setText(status);
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
