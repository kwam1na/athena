import { describe, expect, it } from "vitest";

import {
  isSharedDemoUiEnabled,
  sharedDemoQueryArgs,
} from "./useSharedDemoContext";

describe("shared demo frontend availability", () => {
  it("keeps demo backend subscriptions available in every build", () => {
    expect(isSharedDemoUiEnabled).toBe(true);
    expect(sharedDemoQueryArgs(isSharedDemoUiEnabled)).toEqual({});
  });
});
