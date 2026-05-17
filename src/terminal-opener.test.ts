import { describe, expect, it } from "vitest";
import { getLeafForTerminalLocation } from "./terminal-opener";
import type { TerminalPluginSettings } from "./settings";

type Call = ["right", false] | ["leaf", "tab"] | ["leaf", "split", "vertical" | "horizontal"];

function makeWorkspace() {
  const calls: Call[] = [];
  const workspace = {
    getRightLeaf(create: false) {
      calls.push(["right", create]);
      return { id: "right" };
    },
    getLeaf(type: "tab" | "split", direction?: "vertical" | "horizontal") {
      if (type === "tab") {
        calls.push(["leaf", "tab"]);
        return { id: "tab" };
      }
      calls.push(["leaf", "split", direction ?? "horizontal"]);
      return { id: `${type}-${direction}` };
    },
  };
  return { calls, workspace };
}

describe("getLeafForTerminalLocation", () => {
  it.each([
    ["right", [["right", false]]],
    ["tab", [["leaf", "tab"]]],
    ["split-right", [["leaf", "split", "vertical"]]],
    ["bottom", [["leaf", "split", "horizontal"]]],
  ] as const)("opens %s using the configured workspace target", (location, expectedCalls) => {
    const { calls, workspace } = makeWorkspace();

    getLeafForTerminalLocation(
      workspace as unknown as Parameters<typeof getLeafForTerminalLocation>[0],
      location as TerminalPluginSettings["defaultLocation"],
    );

    expect(calls).toEqual(expectedCalls);
  });
});
