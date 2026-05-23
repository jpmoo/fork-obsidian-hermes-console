import { getContextHeaderDestinationLabel } from "./context-header-label";

export interface ContextHeaderToggleState {
  ariaPressed: "true" | "false";
  className: "terminal-context-toggle--on" | "";
  label: string;
  tooltip: string;
}

export function getContextHeaderToggleState(
  terminalName: string | null | undefined,
  enabled: boolean,
): ContextHeaderToggleState {
  const destinationLabel = getContextHeaderDestinationLabel(terminalName);
  return {
    ariaPressed: enabled ? "true" : "false",
    className: enabled ? "terminal-context-toggle--on" : "",
    label: `Send context to ${destinationLabel}`,
    tooltip: enabled
      ? `Selected note/cursor context will be sent with the next message in ${destinationLabel}. Click to turn it off.`
      : `Selected note/cursor context is not sent to ${destinationLabel}. Click to include it with the next message.`,
  };
}
