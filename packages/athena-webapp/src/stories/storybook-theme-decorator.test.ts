import { describe, expect, it } from "vitest";

import { getAthenaDesignTokenStyle } from "./storybook-theme-decorator";

describe("Storybook design token globals", () => {
  it("maps radius toolbar selections to the root radius token", () => {
    expect(getAthenaDesignTokenStyle({ radius: "none" })).toMatchObject({
      "--radius": "0rem",
    });
    expect(getAthenaDesignTokenStyle({ radius: "comfortable" })).toMatchObject({
      "--radius": "0.5rem",
    });
    expect(getAthenaDesignTokenStyle({ radius: "round" })).toMatchObject({
      "--radius": "1rem",
    });
  });

  it("keeps the app default radius when the global is unset or unknown", () => {
    expect(getAthenaDesignTokenStyle({})).toMatchObject({
      "--radius": "0.75rem",
    });
    expect(getAthenaDesignTokenStyle({ radius: "pillowy" })).toMatchObject({
      "--radius": "0.75rem",
    });
  });
});
