import { App, PluginSettingTab, Setting } from "obsidian";
import { HERMES_ICON_ID } from "./hermes-icon";
import type HermesPlugin from "./main";

export type ConsoleLocation = "bottom" | "right" | "tab" | "split-right";

export interface HermesPluginSettings {
  /** Lucide icon name (or registered custom id) for the ribbon button. */
  ribbonIcon: string;
  /** Where the console opens by default. */
  defaultLocation: ConsoleLocation;
  /** Command name or absolute path used to launch Hermes. Empty = "hermes". */
  hermesPath: string;
  /** Hermes session id to resume on next open (chat persistence). */
  lastSessionId?: string;
  /** How many past conversations to show in the "continue" dropdown. */
  historyCount: number;
  /** What to open when the console first loads. */
  startupBehavior: StartupBehavior;
}

export type StartupBehavior =
  | "resume-last-obsidian" // the conversation you last had in this plugin
  | "new";                 // a fresh conversation

export const DEFAULT_SETTINGS: HermesPluginSettings = {
  ribbonIcon: HERMES_ICON_ID,
  defaultLocation: "right",
  hermesPath: "",
  historyCount: 10,
  startupBehavior: "resume-last-obsidian",
};

const STARTUP_BEHAVIORS: StartupBehavior[] = ["resume-last-obsidian", "new"];

const LOCATIONS: ConsoleLocation[] = ["bottom", "right", "tab", "split-right"];

/** Merge stored data over defaults, keeping only known keys. */
export function normalizeSettings(stored: unknown): HermesPluginSettings {
  const source = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const settings: HermesPluginSettings = { ...DEFAULT_SETTINGS };
  if (typeof source.ribbonIcon === "string" && source.ribbonIcon) settings.ribbonIcon = source.ribbonIcon;
  if (typeof source.defaultLocation === "string" && (LOCATIONS as string[]).includes(source.defaultLocation)) {
    settings.defaultLocation = source.defaultLocation as ConsoleLocation;
  }
  if (typeof source.hermesPath === "string") settings.hermesPath = source.hermesPath;
  if (typeof source.lastSessionId === "string") settings.lastSessionId = source.lastSessionId;
  if (typeof source.historyCount === "number" && Number.isFinite(source.historyCount)) {
    settings.historyCount = Math.min(50, Math.max(1, Math.round(source.historyCount)));
  }
  if (typeof source.startupBehavior === "string" && (STARTUP_BEHAVIORS as string[]).includes(source.startupBehavior)) {
    settings.startupBehavior = source.startupBehavior as StartupBehavior;
  }
  return settings;
}

export class HermesSettingTab extends PluginSettingTab {
  constructor(app: App, private plugin: HermesPlugin) {
    super(app, plugin);
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl)
      .setName("Default location")
      .setDesc("Where the Hermes console opens.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("right", "Right sidebar")
          .addOption("bottom", "Bottom split")
          .addOption("tab", "New tab")
          .addOption("split-right", "Vertical split")
          .setValue(this.plugin.settings.defaultLocation)
          .onChange(async (value) => {
            this.plugin.settings.defaultLocation = value as ConsoleLocation;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("On open")
      .setDesc("What the console shows when it first opens.")
      .addDropdown((dropdown) => {
        dropdown
          .addOption("resume-last-obsidian", "Resume my last conversation here")
          .addOption("new", "Start a new conversation")
          .setValue(this.plugin.settings.startupBehavior)
          .onChange(async (value) => {
            this.plugin.settings.startupBehavior = value as StartupBehavior;
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Conversations in history dropdown")
      .setDesc(
        "How many recent conversations to list in the \"continue\" dropdown (1–50). " +
        "Only conversations started in this panel appear — sessions from the Hermes " +
        "desktop app or terminal are not listed.",
      )
      .addText((text) => {
        text
          .setPlaceholder("10")
          .setValue(String(this.plugin.settings.historyCount))
          .onChange(async (value) => {
            const n = Number(value);
            if (Number.isFinite(n) && n >= 1 && n <= 50) {
              this.plugin.settings.historyCount = Math.round(n);
              await this.plugin.saveSettings();
            }
          });
      });

    new Setting(containerEl)
      .setName("Hermes command")
      .setDesc("Command name or absolute path used to launch Hermes. Leave blank to use \"hermes\" from your shell PATH.")
      .addText((text) => {
        text
          .setPlaceholder("hermes")
          .setValue(this.plugin.settings.hermesPath)
          .onChange(async (value) => {
            this.plugin.settings.hermesPath = value.trim();
            await this.plugin.saveSettings();
          });
      });

    new Setting(containerEl)
      .setName("Ribbon icon")
      .setDesc("Lucide icon name for the ribbon button. Reload required to take effect.")
      .addText((text) => {
        text
          .setPlaceholder(HERMES_ICON_ID)
          .setValue(this.plugin.settings.ribbonIcon)
          .onChange(async (value) => {
            this.plugin.settings.ribbonIcon = value.trim() || HERMES_ICON_ID;
            await this.plugin.saveSettings();
            this.plugin.updateIcon(this.plugin.settings.ribbonIcon);
          });
      });
  }
}
