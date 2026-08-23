import { describe, expect, it } from "vitest";

import { characterCount, revealDuration, revealedPrefix, revealedProse } from "./streamReveal";

describe("stream reveal", () => {
  it("keeps streaming catch-up brief and settles completed text faster", () => {
    expect(revealDuration(0, true)).toBe(0);
    expect(revealDuration(1, true)).toBe(70);
    expect(revealDuration(12, true)).toBe(120);
    expect(revealDuration(100, true)).toBe(180);
    expect(revealDuration(100, false)).toBe(120);
  });

  it("reveals whole Unicode code points and clamps the character boundary", () => {
    expect(characterCount("A\u{1F600}B")).toBe(3);
    expect(revealedPrefix("A\u{1F600}B", 2)).toBe("A\u{1F600}");
    expect(revealedPrefix("A\u{1F600}B", -1)).toBe("");
    expect(revealedPrefix("A\u{1F600}B", 20)).toBe("A\u{1F600}B");
  });

  it("never paints half a citation key", () => {
    const text = "Open lanes: two [citation:v1.1.1.abc] and one more.";
    expect(revealedProse(text, 20)).toBe("Open lanes: two ");
    expect(revealedProse(text, 37)).toBe("Open lanes: two [citation:v1.1.1.abc]");
    expect(revealedProse(text, 999)).toBe(text);
  });
});
