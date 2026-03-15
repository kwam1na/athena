// @vitest-environment node

import { describe, expect, it } from "vitest";

import { customerModulePlaceholder } from "./customer";

describe("storeFront customer", () => {
  it("exports a placeholder module flag", () => {
    expect(customerModulePlaceholder).toBe(true);
  });
});
