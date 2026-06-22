/**
 * Installs the plugin into an Obsidian vault's .obsidian/plugins directory.
 *
 * Usage: node install.mjs [vault-path]
 * Default vault: D:\LOS Test
 */

import { cpSync, mkdirSync, existsSync } from "fs";
import { resolve, join } from "path";

const vaultPath = process.argv[2] || "D:\\LOS Test";
const pluginDir = join(vaultPath, ".obsidian", "plugins", "hermes-console-jpmoo");

if (!existsSync(join(vaultPath, ".obsidian"))) {
  console.error(`Error: ${vaultPath} does not appear to be an Obsidian vault (no .obsidian folder)`);
  process.exit(1);
}

const srcDir = resolve(import.meta.dirname);
mkdirSync(pluginDir, { recursive: true });

// The ACP-based chat plugin is a single bundle plus its manifest and styles —
// no native modules, no shell integration, no companion files.
const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  const src = join(srcDir, file);
  if (!existsSync(src)) {
    console.error(`Error: ${file} not found. Run 'npm run build' first.`);
    process.exit(1);
  }
  cpSync(src, join(pluginDir, file));
  console.log(`  Copied ${file}`);
}

console.log(`\nPlugin installed to: ${pluginDir}`);
console.log("Restart Obsidian and enable the 'Hermes Console' plugin in Settings > Community Plugins.");
