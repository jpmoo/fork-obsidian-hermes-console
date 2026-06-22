/**
 * Minimal Agent Client Protocol (ACP) client for `hermes acp`.
 *
 * ACP is JSON-RPC 2.0 framed as newline-delimited JSON over the agent
 * process's stdio. This client spawns `hermes acp`, performs the
 * initialize/session-new handshake, sends prompts, and surfaces the
 * streamed `session/update` notifications to the UI. It also answers the
 * agent's own requests (permission prompts and filesystem reads/writes).
 */

import type { ChildProcess } from "child_process";

/** A single content block in a prompt or update (text is all we send). */
export interface AcpContentBlock {
  type: "text" | "image" | "resource";
  text?: string;
  [key: string]: unknown;
}

/** The `update` payload inside a session/update notification. */
export interface AcpSessionUpdate {
  sessionUpdate: string;
  content?: { type: string; text?: string };
  [key: string]: unknown;
}

/** Options for a permission request coming from the agent. */
export interface AcpPermissionOption {
  optionId: string;
  name: string;
  kind?: string;
}

export interface AcpPermissionRequest {
  sessionId: string;
  toolCall?: { title?: string; [key: string]: unknown };
  options: AcpPermissionOption[];
}

export interface AcpClientCallbacks {
  /** Streamed session/update notification (thoughts, message chunks, tool calls). */
  onSessionUpdate(update: AcpSessionUpdate): void;
  /** Agent asks the user to approve a tool call. Resolve with the chosen optionId. */
  onRequestPermission(req: AcpPermissionRequest): Promise<string | null>;
  /** Fatal client error (spawn failure, protocol error). */
  onError(message: string): void;
  /** Agent process exited. */
  onExit(code: number | null): void;
}

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
}

type SpawnFn = typeof import("child_process").spawn;
type FsModule = typeof import("fs");

export class AcpClient {
  private proc: ChildProcess | null = null;
  private buf = "";
  private nextId = 1;
  private pending = new Map<number, PendingCall>();
  private sessionId: string | null = null;
  private disposed = false;

  constructor(
    private readonly callbacks: AcpClientCallbacks,
    private readonly hermesPath = "hermes",
  ) {}

  /** Spawn `hermes acp` in the given working directory and run the handshake. */
  async start(cwd: string): Promise<void> {
    const { spawn } = window.require("child_process") as { spawn: SpawnFn };
    const proc = spawn(this.hermesPath, ["acp"], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });
    this.proc = proc;

    proc.stdout?.on("data", (d: Buffer) => this.onData(d.toString()));
    proc.stderr?.on("data", () => { /* hermes logs to stderr; ignored */ });
    proc.on("error", (err: Error) => this.callbacks.onError(err.message));
    proc.on("exit", (code: number | null) => {
      if (!this.disposed) this.callbacks.onExit(code);
    });

    // Bound the handshake — `hermes acp` boots MCP servers first and can
    // stall; without a ceiling the UI would wait forever on "Starting…".
    await this.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: true, writeTextFile: true } },
    }, 60000);

    const newSession = (await this.request("session/new", {
      cwd,
      mcpServers: [],
    }, 60000)) as { sessionId: string };
    this.sessionId = newSession.sessionId;
  }

  /** Send a user prompt. Resolves with the stop reason when the turn ends. */
  async prompt(text: string): Promise<string> {
    if (!this.sessionId) throw new Error("ACP session not started");
    const result = (await this.request("session/prompt", {
      sessionId: this.sessionId,
      prompt: [{ type: "text", text }],
    })) as { stopReason: string };
    return result.stopReason;
  }

  /** Ask the agent to cancel the in-flight turn. */
  cancel(): void {
    if (!this.sessionId || !this.proc) return;
    this.notify("session/cancel", { sessionId: this.sessionId });
  }

  dispose(): void {
    this.disposed = true;
    for (const { reject } of this.pending.values()) {
      reject(new Error("ACP client disposed"));
    }
    this.pending.clear();
    this.proc?.kill();
    this.proc = null;
  }

  // --- wire protocol ---------------------------------------------------

  private onData(chunk: string): void {
    this.buf += chunk;
    let nl: number;
    while ((nl = this.buf.indexOf("\n")) >= 0) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (!line) continue;
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      this.dispatch(msg);
    }
  }

  private dispatch(msg: Record<string, unknown>): void {
    // Response to one of our requests
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const pending = this.pending.get(msg.id as number);
      if (!pending) return;
      this.pending.delete(msg.id as number);
      if (msg.error) {
        const err = msg.error as { message?: string };
        pending.reject(new Error(err.message ?? "ACP error"));
      } else {
        pending.resolve(msg.result);
      }
      return;
    }

    // Request or notification from the agent
    if (typeof msg.method === "string") {
      if (msg.id !== undefined) {
        void this.handleAgentRequest(msg.id as number, msg.method, msg.params);
      } else if (msg.method === "session/update") {
        const params = msg.params as { update: AcpSessionUpdate };
        this.callbacks.onSessionUpdate(params.update);
      }
    }
  }

  private async handleAgentRequest(
    id: number,
    method: string,
    params: unknown,
  ): Promise<void> {
    try {
      const result = await this.routeAgentRequest(method, params);
      this.send({ jsonrpc: "2.0", id, result });
    } catch (err) {
      this.send({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: err instanceof Error ? err.message : String(err) },
      });
    }
  }

  private async routeAgentRequest(method: string, params: unknown): Promise<unknown> {
    const p = (params ?? {}) as Record<string, unknown>;
    switch (method) {
      case "session/request_permission": {
        const optionId = await this.callbacks.onRequestPermission(p as unknown as AcpPermissionRequest);
        if (!optionId) return { outcome: { outcome: "cancelled" } };
        return { outcome: { outcome: "selected", optionId } };
      }
      case "fs/read_text_file": {
        const fs = window.require("fs") as FsModule;
        let content = fs.readFileSync(p.path as string, "utf8");
        if (typeof p.line === "number" || typeof p.limit === "number") {
          const lines = content.split("\n");
          const start = typeof p.line === "number" ? Math.max(0, (p.line as number) - 1) : 0;
          const end = typeof p.limit === "number" ? start + (p.limit as number) : lines.length;
          content = lines.slice(start, end).join("\n");
        }
        return { content };
      }
      case "fs/write_text_file": {
        const fs = window.require("fs") as FsModule;
        fs.writeFileSync(p.path as string, p.content as string);
        return null;
      }
      default:
        throw new Error(`Unhandled agent request: ${method}`);
    }
  }

  private request(method: string, params: unknown, timeoutMs?: number): Promise<unknown> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | null = null;
      if (timeoutMs) {
        timer = setTimeout(() => {
          if (this.pending.delete(id)) {
            reject(new Error(`ACP request "${method}" timed out after ${timeoutMs}ms`));
          }
        }, timeoutMs);
      }
      this.pending.set(id, {
        resolve: (v) => { if (timer) clearTimeout(timer); resolve(v); },
        reject: (e) => { if (timer) clearTimeout(timer); reject(e); },
      });
      this.send({ jsonrpc: "2.0", id, method, params });
    });
  }

  private notify(method: string, params: unknown): void {
    this.send({ jsonrpc: "2.0", method, params });
  }

  private send(obj: Record<string, unknown>): void {
    if (!this.proc?.stdin) return;
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }
}
