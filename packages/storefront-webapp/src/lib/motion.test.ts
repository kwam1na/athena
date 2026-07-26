import { describe, expect, it } from "vitest";

import { getRevealMotion } from "./motion";

describe("getRevealMotion", () => {
  it("returns a restrained reveal using the semantic motion defaults", () => {
    expect(getRevealMotion(false)).toEqual({
      initial: { opacity: 0, y: 8 },
      animate: { opacity: 1, y: 0 },
      transition: {
        delay: 0,
        duration: 0.24,
        ease: [0.22, 1, 0.36, 1],
      },
    });
  });

  it("makes content immediate and non-translating when motion is reduced", () => {
    expect(
      getRevealMotion(true, { delay: 1.2, distance: 40, duration: 2 }),
    ).toEqual({
      initial: { opacity: 1, y: 0 },
      animate: { opacity: 1, y: 0 },
      transition: {
        delay: 0,
        duration: 0,
      },
    });
  });
});
