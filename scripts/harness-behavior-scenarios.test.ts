import { describe, expect, it } from "vitest";

import { HARNESS_BEHAVIOR_SCENARIOS } from "./harness-behavior-scenarios";

describe("HARNESS_BEHAVIOR_SCENARIOS", () => {
  it("registers storefront checkout bootstrap, blocker, and recovery scenarios", () => {
    const names = HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => scenario.name);

    expect(names).toContain("storefront-checkout-bootstrap");
    expect(names).toContain("storefront-checkout-validation-blocker");
    expect(names).toContain("storefront-checkout-verification-recovery");
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

    expect(bootstrapScenario?.runtimeSignals?.map((signal) => signal.name)).toContain(
      "storefront-checkout-bootstrap-loaded"
    );
    expect(validationScenario?.runtimeSignals?.map((signal) => signal.name)).toContain(
      "storefront-checkout-session-missing"
    );
    expect(recoveryScenario?.runtimeSignals?.map((signal) => signal.name)).toContain(
      "storefront-payment-verification-requested"
    );
  });
});
