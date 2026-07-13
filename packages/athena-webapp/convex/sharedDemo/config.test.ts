import { describe, expect, it } from "vitest";

import {
  isSharedDemoEnabled,
  readSharedDemoConfig,
  SHARED_DEMO_ADMISSION_DURATION_MS,
  SHARED_DEMO_TICKET_DURATION_MS,
} from "./config";

describe("shared demo configuration", () => {
  it.each(["development", "qa"])("allows the explicit %s deployment", (deployment) => {
    expect(
      isSharedDemoEnabled({
        ATHENA_DEPLOYMENT_ID: "demo-1",
        ATHENA_DEPLOYMENT_ENVIRONMENT: deployment,
        ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST: "demo-1",
        ATHENA_SHARED_DEMO_ENABLED: "true",
      }),
    ).toBe(true);
  });

  it.each(["production", "preview", "", undefined])(
    "fails closed for deployment %s",
    (deployment) => {
      expect(
        isSharedDemoEnabled({
          ATHENA_DEPLOYMENT_ID: "demo-1",
          ATHENA_DEPLOYMENT_ENVIRONMENT: deployment,
          ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST: "demo-1",
          ATHENA_SHARED_DEMO_ENABLED: "true",
        }),
      ).toBe(false);
    },
  );

  it("requires every server-owned demo identity", () => {
    expect(() =>
      readSharedDemoConfig({
        ATHENA_DEPLOYMENT_ID: "demo-1",
        ATHENA_DEPLOYMENT_ENVIRONMENT: "qa",
        ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST: "demo-1",
        ATHENA_SHARED_DEMO_ENABLED: "true",
      }),
    ).toThrow("Shared demo configuration is incomplete");
  });

  it("fails closed when the deployment ID is not explicitly allowlisted", () => {
    expect(isSharedDemoEnabled({
      ATHENA_DEPLOYMENT_ID: "prod-1",
      ATHENA_DEPLOYMENT_ENVIRONMENT: "qa",
      ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST: "qa-1",
      ATHENA_SHARED_DEMO_ENABLED: "true",
    })).toBe(false);
  });

  it("uses a one-minute ticket and one-hour admission window", () => {
    expect(SHARED_DEMO_TICKET_DURATION_MS).toBe(60_000);
    expect(SHARED_DEMO_ADMISSION_DURATION_MS).toBe(3_600_000);
  });
});
