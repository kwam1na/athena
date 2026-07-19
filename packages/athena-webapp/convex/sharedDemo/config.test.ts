import { describe, expect, it } from "vitest";

import {
  isSharedDemoEnabled,
  readSharedDemoConfig,
  SHARED_DEMO_ADMISSION_DURATION_MS,
  SHARED_DEMO_TIME_ZONE,
  SHARED_DEMO_TICKET_DURATION_MS,
} from "./config";

describe("shared demo configuration", () => {
  it.each(["dev", "qa", "prod"])("allows the explicit %s stage", (stage) => {
    expect(
      isSharedDemoEnabled({
        ATHENA_SHARED_DEMO_ENABLED: "true",
        STAGE: stage,
      }),
    ).toBe(true);
  });

  it.each(["preview", "", undefined])(
    "fails closed for stage %s",
    (stage) => {
      expect(
        isSharedDemoEnabled({
          ATHENA_SHARED_DEMO_ENABLED: "true",
          STAGE: stage,
        }),
      ).toBe(false);
    },
  );

  it("requires every server-owned demo identity", () => {
    expect(() =>
      readSharedDemoConfig({
        ATHENA_SHARED_DEMO_ENABLED: "true",
        STAGE: "qa",
      }),
    ).toThrow("Demo configuration is incomplete");
  });

  it("does not require a deployment identifier or allowlist", () => {
    expect(
      isSharedDemoEnabled({
        ATHENA_SHARED_DEMO_ENABLED: "true",
        STAGE: "prod",
      }),
    ).toBe(true);
  });

  it("uses a one-minute ticket and three-hour admission window", () => {
    expect(SHARED_DEMO_TICKET_DURATION_MS).toBe(60_000);
    expect(SHARED_DEMO_ADMISSION_DURATION_MS).toBe(10_800_000);
  });

  it("uses one canonical New York operating timezone", () => {
    expect(SHARED_DEMO_TIME_ZONE).toBe("America/New_York");
  });
});
