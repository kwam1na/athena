import { describe, expect, it } from "vitest";

import {
  resolveSharedDemoUiEnabled,
  sharedDemoQueryArgs,
} from "./useSharedDemoContext";

describe("shared demo frontend mode gate", () => {
  it("skips demo backend subscriptions in production builds", () => {
    const enabled = resolveSharedDemoUiEnabled({ DEV: false });

    expect(enabled).toBe(false);
    expect(sharedDemoQueryArgs(enabled)).toBe("skip");
  });

  it("keeps demo backend subscriptions available to Vite dev surfaces", () => {
    const enabled = resolveSharedDemoUiEnabled({ DEV: true });

    expect(enabled).toBe(true);
    expect(sharedDemoQueryArgs(enabled)).toEqual({});
  });
});
