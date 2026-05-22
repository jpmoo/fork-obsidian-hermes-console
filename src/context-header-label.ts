export function getContextHeaderDestinationLabel(sessionName: string | null | undefined): string {
  const trimmedName = sessionName?.trim();
  return trimmedName ? trimmedName : "active terminal";
}
