import { App, FileSystemAdapter } from "obsidian";

export interface HermesHookStatusState {
  statusMtimeMs: number;
  pollTimer: number | null;
  watchHandle: { close: () => void } | null;
}

interface HermesHookStatusPayload {
  schema?: number;
  source?: string;
  tabId?: string;
  state?: string;
}

export function resolveHermesHookStatusDir(app: App): string {
  const adapter = app.vault.adapter;
  if (adapter instanceof FileSystemAdapter) {
    const pathMod = window.require("path") as { join: (...parts: string[]) => string };
    return pathMod.join(adapter.getBasePath(), ".obsidian", "hermes", "runtime");
  }
  return "";
}

export function hermesHookStatusFilePath(statusDir: string, tabId: string): string {
  if (!statusDir) return "";
  const pathMod = window.require("path") as { join: (...parts: string[]) => string };
  return pathMod.join(statusDir, `${tabId}.json`);
}

export function createHermesHookStatusState(): HermesHookStatusState {
  return {
    statusMtimeMs: 0,
    pollTimer: null,
    watchHandle: null,
  };
}

export function readHermesHookBusyStatus(filePath: string, tabId: string): boolean | null {
  if (!filePath) return null;
  try {
    const fs = window.require("fs") as {
      readFileSync: (path: string, encoding: string) => string;
      statSync: (path: string) => { mtimeMs: number };
    };
    const raw = fs.readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw) as HermesHookStatusPayload;
    if (
      payload.schema !== 1
      || payload.source !== "hermes-obsidian-status"
      || payload.tabId !== tabId
    ) {
      return null;
    }
    if (payload.state === "busy") return true;
    if (payload.state === "idle") return false;
    return null;
  } catch {
    return null;
  }
}
