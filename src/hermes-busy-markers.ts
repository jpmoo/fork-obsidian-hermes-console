export interface HermesBusyMarkerState {
  buffer: string;
}

export interface HermesBusyMarkerResult {
  cleanData: string;
  busy: boolean | null;
}

const MARKER_PATTERN = /(?:\x1b\]777;|\??\]?777;)(hermes:busy=([01]))(?:\x07|\x1b\\|\?\\|\\|\?(?![\]7]))?/g;
const MARKER_PREFIXES = [
  "\x1b]777;hermes:busy=0",
  "\x1b]777;hermes:busy=1",
  "?]777;hermes:busy=0",
  "?]777;hermes:busy=1",
  "]777;hermes:busy=0",
  "]777;hermes:busy=1",
  "?777;hermes:busy=0",
  "?777;hermes:busy=1",
];

export function consumeHermesBusyMarkers(
  state: HermesBusyMarkerState,
  data: string,
  onBusy?: (busy: boolean) => void,
): HermesBusyMarkerResult {
  const combined = state.buffer + data;
  state.buffer = "";
  let cleanData = "";
  let lastIndex = 0;
  let busy: boolean | null = null;
  let match: RegExpExecArray | null;

  while ((match = MARKER_PATTERN.exec(combined)) !== null) {
    cleanData += combined.slice(lastIndex, match.index);
    busy = match[2] === "1";
    onBusy?.(busy);
    lastIndex = MARKER_PATTERN.lastIndex;
  }
  cleanData += combined.slice(lastIndex);

  for (let start = Math.max(0, cleanData.length - 24); start < cleanData.length; start++) {
    const suffix = cleanData.slice(start);
    if (suffix && MARKER_PREFIXES.some((prefix) => prefix.startsWith(suffix))) {
      state.buffer = suffix;
      cleanData = cleanData.slice(0, start);
      break;
    }
  }

  return { cleanData, busy };
}
