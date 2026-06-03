import { describe, expect, it } from "vitest";
import { isTaskLine, toggleTaskAtLine } from "./tasklist";

const DOC = [
  "# Plan", // line 1
  "", // line 2
  "- [ ] first", // line 3
  "- [x] second", // line 4
  "  * [ ] nested", // line 5
  "1. [X] ordered", // line 6
  "plain text", // line 7
].join("\n");

describe("toggleTaskAtLine", () => {
  it("checks an unchecked item", () => {
    const out = toggleTaskAtLine(DOC, 3).split("\n");
    expect(out[2]).toBe("- [x] first");
  });

  it("unchecks a checked item", () => {
    const out = toggleTaskAtLine(DOC, 4).split("\n");
    expect(out[3]).toBe("- [ ] second");
  });

  it("handles nested and ordered list markers", () => {
    expect(toggleTaskAtLine(DOC, 5).split("\n")[4]).toBe("  * [x] nested");
    expect(toggleTaskAtLine(DOC, 6).split("\n")[5]).toBe("1. [ ] ordered");
  });

  it("only changes the targeted line", () => {
    const out = toggleTaskAtLine(DOC, 3).split("\n");
    expect(out[0]).toBe("# Plan");
    expect(out[3]).toBe("- [x] second");
    expect(out[6]).toBe("plain text");
  });

  it("is a safe no-op on non-task lines and out-of-range", () => {
    expect(toggleTaskAtLine(DOC, 7)).toBe(DOC);
    expect(toggleTaskAtLine(DOC, 1)).toBe(DOC);
    expect(toggleTaskAtLine(DOC, 999)).toBe(DOC);
    expect(toggleTaskAtLine(DOC, 0)).toBe(DOC);
  });

  it("preserves trailing text after the checkbox", () => {
    const out = toggleTaskAtLine("- [ ] do the thing", 1);
    expect(out).toBe("- [x] do the thing");
  });
});

describe("isTaskLine", () => {
  it("identifies task lines and rejects others", () => {
    expect(isTaskLine(DOC, 3)).toBe(true);
    expect(isTaskLine(DOC, 4)).toBe(true);
    expect(isTaskLine(DOC, 1)).toBe(false);
    expect(isTaskLine(DOC, 7)).toBe(false);
  });
});
