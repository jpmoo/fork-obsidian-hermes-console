import { Plugin, WorkspaceLeaf, addIcon, setIcon } from "obsidian";
import { VIEW_TYPE_TERMINAL } from "./constants";
import { HermesChatView } from "./hermes-chat-view";
import {
  HermesSettingTab,
  DEFAULT_SETTINGS,
  normalizeSettings,
  type ConsoleLocation,
  type HermesPluginSettings,
} from "./settings";
import {
  HERMES_ICON_ID,
  HERMES_ICON_SVG,
  HERMES_SETTINGS_ICON_ID,
  HERMES_SETTINGS_ICON_SVG,
} from "./hermes-icon";

export default class HermesPlugin extends Plugin {
  settings: HermesPluginSettings = DEFAULT_SETTINGS;
  private ribbonEl: HTMLElement | null = null;

  async onload(): Promise<void> {
    addIcon(HERMES_ICON_ID, HERMES_ICON_SVG);
    addIcon(HERMES_SETTINGS_ICON_ID, HERMES_SETTINGS_ICON_SVG);
    await this.loadSettings();

    this.registerView(VIEW_TYPE_TERMINAL, (leaf: WorkspaceLeaf) => new HermesChatView(leaf, this));

    this.ribbonEl = this.addRibbonIcon(this.settings.ribbonIcon, "Open Hermes Console", () => {
      void this.activateView();
    });

    this.addCommand({
      id: "open-terminal",
      name: "Open Hermes Console",
      callback: () => void this.activateView(),
    });
    this.addCommand({
      id: "close-terminal",
      name: "Close Hermes Console",
      callback: () => this.closeView(),
    });
    this.addCommand({
      id: "toggle-terminal",
      name: "Toggle Hermes Console",
      callback: () => void this.toggleView(),
    });
    this.addCommand({
      id: "open-terminal-split",
      name: "Open Hermes Console in new pane",
      callback: () => void this.openInNewPane(),
    });

    this.addSettingTab(new HermesSettingTab(this.app, this));
  }

  onunload(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL);
    if (existing.length > 0) {
      void this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.getLeafForLocation(this.settings.defaultLocation);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_TERMINAL, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  closeView(): void {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE_TERMINAL);
  }

  async toggleView(): Promise<void> {
    if (this.app.workspace.getLeavesOfType(VIEW_TYPE_TERMINAL).length > 0) {
      this.closeView();
    } else {
      await this.activateView();
    }
  }

  async openInNewPane(): Promise<void> {
    const leaf = this.app.workspace.getLeaf("split", "horizontal");
    await leaf.setViewState({ type: VIEW_TYPE_TERMINAL, active: true });
    void this.app.workspace.revealLeaf(leaf);
  }

  private getLeafForLocation(location: ConsoleLocation): WorkspaceLeaf | null {
    switch (location) {
      case "right":
        return this.app.workspace.getRightLeaf(false);
      case "tab":
        return this.app.workspace.getLeaf("tab");
      case "split-right":
        return this.app.workspace.getLeaf("split", "vertical");
      default:
        return this.app.workspace.getLeaf("split", "horizontal");
    }
  }

  updateIcon(name: string): void {
    const safeName = name || HERMES_ICON_ID;
    if (this.ribbonEl) setIcon(this.ribbonEl, safeName);
  }

  async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}
