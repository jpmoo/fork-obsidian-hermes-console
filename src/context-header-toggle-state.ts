import { getContextHeaderDestinationLabel } from "./context-header-label";

export interface ContextHeaderToggleState {
  ariaPressed: "true" | "false";
  className: "terminal-context-toggle--on" | "";
  label: string;
}

export function getContextHeaderToggleState(
  terminalName: string | null | undefined,
  enabled: boolean,
): ContextHeaderToggleState {
  return {
    ariaPressed: enabled ? "true" : "false",
    className: enabled ? "terminal-context-toggle--on" : "",
    label: `Send context to ${getContextHeaderDestinationLabel(terminalName)}`,
  };
}
