import { describe, expect, it } from "vitest";
import { joinFrontmatter, splitFrontmatter } from "./frontmatter";

describe("frontmatter", () => {
  it("splits a frontmatter block from the body", () => {
    const raw = "---\ntitle: X\nauthor: Y\n---\n# Body\n\ntext";
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toBe("---\ntitle: X\nauthor: Y\n---\n");
    expect(body).toBe("# Body\n\ntext");
  });

  it("returns empty frontmatter when there is none", () => {
    const { frontmatter, body } = splitFrontmatter("# Just a heading");
    expect(frontmatter).toBe("");
    expect(body).toBe("# Just a heading");
  });

  it("does not treat a mid-document --- as frontmatter", () => {
    const raw = "# Heading\n\n---\n\nmore";
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(frontmatter).toBe("");
    expect(body).toBe(raw);
  });

  it("round-trips split then join losslessly", () => {
    const raw = "---\na: 1\n---\nhello world";
    const { frontmatter, body } = splitFrontmatter(raw);
    expect(joinFrontmatter(frontmatter, body)).toBe(raw);
  });

  it("join with empty frontmatter returns the body unchanged", () => {
    expect(joinFrontmatter("", "x")).toBe("x");
  });
});
