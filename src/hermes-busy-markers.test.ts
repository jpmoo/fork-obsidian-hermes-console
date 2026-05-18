import { describe, expect, it } from "vitest";
import { consumeHermesBusyMarkers } from "./hermes-busy-markers";

function clean(chunks: string[]): { output: string; states: boolean[] } {
  const state = { buffer: "" };
  const states: boolean[] = [];
  const output = chunks
    .map((chunk) => consumeHermesBusyMarkers(state, chunk, (busy) => states.push(busy)).cleanData)
    .join("");
  return { output, states };
}

describe("consumeHermesBusyMarkers", () => {
  it("strips BEL-terminated OSC markers", () => {
    expect(clean(["a\x1b]777;hermes:busy=1\x07b"])).toEqual({ output: "ab", states: [true] });
  });

  it("strips visible mangled markers with ? backslash terminator", () => {
    expect(clean(["?]777;hermes:busy=0?\\ ⚕"])).toEqual({ output: " ⚕", states: [false] });
  });

  it("strips visible mangled markers with lonely question terminator", () => {
    expect(clean(["?]777;hermes:busy=0?\r\n⚕"])).toEqual({ output: "\r\n⚕", states: [false] });
  });

  it("strips markers when ESC/control prefix is swallowed", () => {
    expect(clean(["]777;hermes:busy=0?\\ ⚕"])).toEqual({ output: " ⚕", states: [false] });
  });

  it("buffers markers split across chunks", () => {
    expect(clean(["hello ?]777;hermes", ":busy=1?\\ world"])).toEqual({
      output: "hello  world",
      states: [true],
    });
  });
});
