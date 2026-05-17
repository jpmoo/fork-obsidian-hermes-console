import { describe, expect, it, vi } from "vitest";
import { validateProtocolCwd } from "./uri-cwd";

describe("validateProtocolCwd", () => {
  it("uses Obsidian's already-decoded cwd without decoding percent characters again", () => {
    const cwd = "/vault/100% Notes";
    const deps = {
      existsSync: vi.fn((path: string) => path === cwd),
      statSync: vi.fn(() => ({ isDirectory: () => true })),
    };

    expect(validateProtocolCwd(cwd, deps)).toBe(cwd);
    expect(deps.existsSync).toHaveBeenCalledWith(cwd);
    expect(deps.statSync).toHaveBeenCalledWith(cwd);
  });

  it("rejects missing paths", () => {
    const deps = {
      existsSync: vi.fn(() => false),
      statSync: vi.fn(() => ({ isDirectory: () => true })),
    };

    expect(validateProtocolCwd("/vault/missing", deps)).toBeNull();
    expect(deps.statSync).not.toHaveBeenCalled();
  });

  it("rejects existing non-directory paths", () => {
    const deps = {
      existsSync: vi.fn(() => true),
      statSync: vi.fn(() => ({ isDirectory: () => false })),
    };

    expect(validateProtocolCwd("/vault/file.md", deps)).toBeNull();
  });

  it("rejects paths when filesystem validation throws", () => {
    const deps = {
      existsSync: vi.fn(() => true),
      statSync: vi.fn(() => {
        throw new Error("permission denied");
      }),
    };

    expect(validateProtocolCwd("/vault/private", deps)).toBeNull();
  });
});
