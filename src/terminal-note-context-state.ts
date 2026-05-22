export class TerminalNoteContextState {
  private readonly enabledBySessionId = new Map<string, boolean>();

  isEnabled(sessionId: string | null | undefined): boolean {
    if (!sessionId) return false;
    return this.enabledBySessionId.get(sessionId) === true;
  }

  setEnabled(sessionId: string, enabled: boolean): void {
    if (enabled) {
      this.enabledBySessionId.set(sessionId, true);
    } else {
      this.enabledBySessionId.delete(sessionId);
    }
  }

  toggle(sessionId: string): boolean {
    const enabled = !this.isEnabled(sessionId);
    this.setEnabled(sessionId, enabled);
    return enabled;
  }

  remove(sessionId: string): void {
    this.enabledBySessionId.delete(sessionId);
  }

  clear(): void {
    this.enabledBySessionId.clear();
  }
}
