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
}

export const DEFAULT_SETTINGS: HermesPluginSettings = {
  ribbonIcon: HERMES_ICON_ID,
  defaultLocation: "right",
  hermesPath: "",
};

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
