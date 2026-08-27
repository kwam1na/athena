import { describe, expect, it } from "vitest";

import { characterCount, revealDuration, revealedPrefix, revealedProse } from "./streamReveal";

describe("stream reveal", () => {
  it("keeps draft catch-up brief while scaling a live final answer into view", () => {
    expect(revealDuration(0, "streaming")).toBe(0);
    expect(revealDuration(1, "streaming")).toBe(70);
    expect(revealDuration(12, "streaming")).toBe(120);
    expect(revealDuration(100, "streaming")).toBe(180);
    expect(revealDuration(100, "settling")).toBe(120);
    expect(revealDuration(1, "answer")).toBe(3);
    expect(revealDuration(100, "answer")).toBe(300);
    expect(revealDuration(300, "answer")).toBe(900);
    expect(revealDuration(1_000, "answer")).toBe(3_000);
    expect(revealDuration(5_000, "answer")).toBe(15_000);
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
