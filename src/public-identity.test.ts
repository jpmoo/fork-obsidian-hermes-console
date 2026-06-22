import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const rootDir = fileURLToPath(new URL("..", import.meta.url));

function readRepoFile(path: string): string {
  return readFileSync(resolve(rootDir, path), "utf-8");
}

describe("plugin identity", () => {
  it("uses the hermes-console-jpmoo id consistently", () => {
    const manifest = JSON.parse(readRepoFile("manifest.json")) as {
      id: string;
      name: string;
      description: string;
    };
    const pkg = JSON.parse(readRepoFile("package.json")) as { name: string };

    expect(manifest.id).toBe("hermes-console-jpmoo");
    expect(pkg.name).toBe("hermes-console-jpmoo");
    expect(manifest.name).toBe("Hermes Console");
  });

  it("installs under the hermes-console-jpmoo plugin folder", () => {
    const installScript = readRepoFile("install.mjs");
    expect(installScript).toContain('".obsidian", "plugins", "hermes-console-jpmoo"');
    expect(installScript).not.toContain("lean-terminal");
  });
});
