import { describe, expect, it } from "vitest";
import { TerminalNoteContextState } from "./terminal-note-context-state";

describe("TerminalNoteContextState", () => {
  it("fails closed for missing and unknown live terminal sessions", () => {
    const state = new TerminalNoteContextState();

    expect(state.isEnabled(null)).toBe(false);
    expect(state.isEnabled(undefined)).toBe(false);
    expect(state.isEnabled("terminal-1")).toBe(false);
  });

  it("stores independent transient state keyed by terminal session id", () => {
    const state = new TerminalNoteContextState();

    expect(state.toggle("terminal-1")).toBe(true);

    expect(state.isEnabled("terminal-1")).toBe(true);
    expect(state.isEnabled("terminal-2")).toBe(false);

    state.setEnabled("terminal-2", true);
    state.setEnabled("terminal-1", false);

    expect(state.isEnabled("terminal-1")).toBe(false);
    expect(state.isEnabled("terminal-2")).toBe(true);
  });

  it("cleans up state when a terminal session is removed", () => {
    const state = new TerminalNoteContextState();

    state.setEnabled("terminal-1", true);
    state.remove("terminal-1");

    expect(state.isEnabled("terminal-1")).toBe(false);
  });

  it("can clear all live session state on plugin/view teardown", () => {
    const state = new TerminalNoteContextState();

    state.setEnabled("terminal-1", true);
    state.setEnabled("terminal-2", true);
    state.clear();

    expect(state.isEnabled("terminal-1")).toBe(false);
    expect(state.isEnabled("terminal-2")).toBe(false);
  });
});
