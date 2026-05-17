import { Notice } from "obsidian";

export interface CwdValidationDeps {
  existsSync: (path: string) => boolean;
  statSync: (path: string) => { isDirectory(): boolean };
}

export function validateProtocolCwd(cwd: string, deps: CwdValidationDeps): string | null {
  if (!cwd) return null;

  try {
    if (!deps.existsSync(cwd)) return null;
    if (!deps.statSync(cwd).isDirectory()) return null;
    return cwd;
  } catch {
    return null;
  }
}

export function notifyProtocolHandlerError(error: unknown): void {
  console.error("[Hermes Console] URI handler failed", error);
  new Notice("Hermes Console URI failed. Check console for details.");
}
