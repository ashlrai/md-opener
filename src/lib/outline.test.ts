import { describe, expect, it } from "vitest";
import { parseHeadings } from "./outline";

describe("parseHeadings", () => {
  it("skips a leading YAML frontmatter block", () => {
    const doc = ["---", "title: Hello", "tags: [a, b]", "---", "# Real Heading"].join(
      "\n",
    );
    const out = parseHeadings(doc);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ depth: 1, text: "Real Heading", line: 5 });
    // No phantom heading from a `#` inside the frontmatter.
  });

  it("does not treat frontmatter values as headings", () => {
    const doc = ["---", "# not a heading", "---", "## Body"].join("\n");
    const out = parseHeadings(doc);
    expect(out.map((h) => h.text)).toEqual(["Body"]);
  });

  it("ignores `#` lines inside fenced code blocks", () => {
    const doc = [
      "# Title",
      "",
      "```bash",
      "# this is a shell comment, not a heading",
      "## also not a heading",
      "```",
      "",
      "## Real Section",
    ].join("\n");
    const out = parseHeadings(doc);
    expect(out.map((h) => h.text)).toEqual(["Title", "Real Section"]);
  });

  it("handles tilde fences and nested backtick fences", () => {
    const doc = [
      "# A",
      "~~~",
      "# inside tilde fence",
      "```",
      "# still inside (nested ``` does not close ~~~)",
      "~~~",
      "# B",
    ].join("\n");
    const out = parseHeadings(doc);
    expect(out.map((h) => h.text)).toEqual(["A", "B"]);
  });

  it("captures depth + nesting for ATX levels", () => {
    const doc = ["# One", "## Two", "### Three", "###### Six"].join("\n");
    const out = parseHeadings(doc);
    expect(out.map((h) => h.depth)).toEqual([1, 2, 3, 6]);
    // 7 hashes is not a heading.
    expect(parseHeadings("####### Seven")).toHaveLength(0);
  });

  it("dedupes duplicate slugs with -1/-2 suffixes (matches github-slugger)", () => {
    const doc = ["# Setup", "## Setup", "### Setup"].join("\n");
    const out = parseHeadings(doc);
    expect(out.map((h) => h.slug)).toEqual(["setup", "setup-1", "setup-2"]);
  });

  it("strips inline markdown before slugging so anchors match the DOM", () => {
    const doc = "## The **bold** `code` and [a link](https://x.com)";
    const out = parseHeadings(doc);
    expect(out[0].text).toBe("The bold code and a link");
    expect(out[0].slug).toBe("the-bold-code-and-a-link");
  });

  it("returns an empty array for a doc with no headings", () => {
    expect(parseHeadings("just some prose\n\nand more")).toEqual([]);
  });
});
