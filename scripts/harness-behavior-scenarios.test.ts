import { describe, expect, it } from "vitest";

import { HARNESS_BEHAVIOR_SCENARIOS } from "./harness-behavior-scenarios";

describe("HARNESS_BEHAVIOR_SCENARIOS", () => {
  it("registers storefront checkout bootstrap, blocker, recovery, and valkey scenarios", () => {
    const names = HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => scenario.name);

    expect(names).toContain("storefront-checkout-bootstrap");
    expect(names).toContain("storefront-checkout-validation-blocker");
    expect(names).toContain("storefront-checkout-verification-recovery");
    expect(names).toContain("valkey-proxy-local-request-response");
  });

  it("captures runtime signals for each storefront scenario", () => {
    const scenarioByName = new Map(
      HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => [scenario.name, scenario])
    );

    const bootstrapScenario = scenarioByName.get("storefront-checkout-bootstrap");
    const validationScenario = scenarioByName.get(
      "storefront-checkout-validation-blocker"
    );
    const recoveryScenario = scenarioByName.get(
      "storefront-checkout-verification-recovery"
    );
    const valkeyScenario = scenarioByName.get("valkey-proxy-local-request-response");

    expect(bootstrapScenario?.runtimeSignals?.map((signal) => signal.name)).toContain(
      "storefront-checkout-bootstrap-loaded"
    );
    expect(validationScenario?.runtimeSignals?.map((signal) => signal.name)).toContain(
      "storefront-checkout-session-missing"
    );
    expect(recoveryScenario?.runtimeSignals?.map((signal) => signal.name)).toContain(
      "storefront-payment-verification-requested"
    );
    expect(
      bootstrapScenario?.runtimeSignals?.find(
        (signal) => signal.name === "storefront-runtime-api-errors"
      )
    ).toMatchObject({
      minMatches: 0,
      maxMatches: 0,
    });
    expect(valkeyScenario?.processes).toMatchObject([
      {
        id: "valkey-runtime-app",
        command: "bun scripts/harness-behavior-fixtures/valkey-runtime-app.ts",
      },
    ]);
    expect(valkeyScenario?.readiness).toMatchObject([
      {
        kind: "http",
        name: "valkey-runtime-health",
      },
    ]);
  });

  it("applies latency thresholds to every registered scenario", () => {
    for (const scenario of HARNESS_BEHAVIOR_SCENARIOS) {
      expect(scenario.thresholds?.latency?.maxTotalDurationMs).toBeDefined();
      expect(scenario.thresholds?.latency?.maxPhaseDurationMs).toBeDefined();
    }
  });
});
