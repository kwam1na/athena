import { describe, expect, it } from "vitest";

import {
  diagnoseStorefrontBackendRequests,
  HARNESS_BEHAVIOR_SCENARIOS,
} from "./harness-behavior-scenarios";

describe("HARNESS_BEHAVIOR_SCENARIOS", () => {
  it("registers storefront backend, checkout bootstrap, blocker, recovery, and valkey scenarios", () => {
    const names = HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => scenario.name);

    expect(names).toContain("storefront-backend-first-load");
    expect(names).toContain("storefront-checkout-bootstrap");
    expect(names).toContain("storefront-checkout-validation-blocker");
    expect(names).toContain("storefront-checkout-verification-recovery");
    expect(names).toContain("valkey-proxy-local-request-response");
  });

  it("captures runtime signals for each storefront scenario", () => {
    const scenarioByName = new Map(
      HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => [scenario.name, scenario])
    );

    const firstLoadScenario = scenarioByName.get("storefront-backend-first-load");
    const bootstrapScenario = scenarioByName.get("storefront-checkout-bootstrap");
    const validationScenario = scenarioByName.get(
      "storefront-checkout-validation-blocker"
    );
    const recoveryScenario = scenarioByName.get(
      "storefront-checkout-verification-recovery"
    );
    const valkeyScenario = scenarioByName.get("valkey-proxy-local-request-response");

    expect(firstLoadScenario?.runtimeSignals?.map((signal) => signal.name)).toContain(
      "storefront-backend-first-load"
    );
    expect(
      firstLoadScenario?.runtimeSignals?.find(
        (signal) => signal.name === "storefront-runtime-api-errors"
      )
    ).toMatchObject({
      minMatches: 0,
      maxMatches: 0,
    });
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

  it("classifies storefront backend first-load request failures with actionable diagnostics", () => {
    expect(
      diagnoseStorefrontBackendRequests([
        {
          url: "https://jovial-wildebeest-179.convex.site/storefront",
          method: "GET",
          resourceType: "fetch",
          status: 200,
        },
        {
          url: "https://qa.wigclub.store/api/storefront",
          method: "OPTIONS",
          resourceType: "fetch",
          status: 403,
          failureReason: "CORS preflight failed",
        },
        {
          url: "https://qa.wigclub.store/api/bestSellers",
          method: "GET",
          resourceType: "fetch",
          status: 404,
        },
      ])
    ).toEqual([
      expect.objectContaining({
        kind: "direct-convex-target",
        url: "https://jovial-wildebeest-179.convex.site/storefront",
        status: 200,
      }),
      expect.objectContaining({
        kind: "cors-preflight",
        url: "https://qa.wigclub.store/api/storefront",
        status: 403,
        failureReason: "CORS preflight failed",
      }),
      expect.objectContaining({
        kind: "non-2xx-api-response",
        url: "https://qa.wigclub.store/api/bestSellers",
        status: 404,
      }),
    ]);
  });

  it("uses browser console evidence to classify failed preflight requests as CORS diagnostics", () => {
    expect(
      diagnoseStorefrontBackendRequests(
        [
          {
            url: "https://qa.wigclub.store/api/storefront",
            method: "OPTIONS",
            resourceType: "fetch",
            failureReason: "net::ERR_FAILED",
          },
        ],
        [
          "Access to fetch at 'https://qa.wigclub.store/api/storefront' from origin 'https://qa.wigclub.store' has been blocked by CORS policy: Response to preflight request doesn't pass access control check.",
        ]
      )
    ).toEqual([
      expect.objectContaining({
        kind: "cors-preflight",
        url: "https://qa.wigclub.store/api/storefront",
        failureReason: "net::ERR_FAILED",
      }),
    ]);
  });
});
