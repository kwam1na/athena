import { describe, expect, it } from "vitest";

import { sharedDemoRestoreEnabled } from "./scheduledRestore";

describe("shared demo scheduled restore environment gate", () => {
  it("requires both the flag and exact deployment allowlist membership", () => {
    expect(sharedDemoRestoreEnabled({
      ATHENA_DEPLOYMENT_ID: "qa-1",
      ATHENA_DEPLOYMENT_ENVIRONMENT: "qa",
      ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST: "qa-1,dev-1",
      ATHENA_SHARED_DEMO_ENABLED: "true",
    })).toBe(true);
    expect(sharedDemoRestoreEnabled({
      ATHENA_DEPLOYMENT_ID: "prod-1",
      ATHENA_DEPLOYMENT_ENVIRONMENT: "qa",
      ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST: "qa-1",
      ATHENA_SHARED_DEMO_ENABLED: "true",
    })).toBe(false);
    expect(sharedDemoRestoreEnabled({
      ATHENA_DEPLOYMENT_ID: "qa-1",
      ATHENA_DEPLOYMENT_ENVIRONMENT: "qa",
      ATHENA_SHARED_DEMO_DEPLOYMENT_ALLOWLIST: "qa-1",
    })).toBe(false);
  });
});
