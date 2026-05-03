import { describe, expect, it } from "vitest";

import {
  ATHENA_QA_LIVE_SMOKE_SCENARIO,
  diagnoseAthenaQaLiveSmoke,
  diagnoseStorefrontBackendRequests,
  HARNESS_BEHAVIOR_SCENARIOS,
  VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO,
} from "./harness-behavior-scenarios";

describe("HARNESS_BEHAVIOR_SCENARIOS", () => {
  it("registers storefront backend, checkout bootstrap, blocker, recovery, and valkey scenarios", () => {
    const names = HARNESS_BEHAVIOR_SCENARIOS.map((scenario) => scenario.name);

    expect(names).toContain("storefront-backend-first-load");
    expect(names).toContain("storefront-checkout-bootstrap");
    expect(names).toContain("storefront-checkout-validation-blocker");
    expect(names).toContain("storefront-checkout-verification-recovery");
    expect(names).toContain("valkey-proxy-local-request-response");
    expect(names).toContain("athena-qa-live-smoke");
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
    const athenaQaScenario = scenarioByName.get("athena-qa-live-smoke");

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
    expect(athenaQaScenario?.processes).toEqual([]);
    expect(athenaQaScenario?.readiness).toEqual([]);
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

  it("classifies blank Athena QA pages and browser failures with actionable diagnostics", () => {
    expect(
      diagnoseAthenaQaLiveSmoke({
        observedText: "",
        hasEmailField: false,
        observations: [
          {
            kind: "http-response",
            url: "https://athena-qa.wigclub.store/node_modules/.vite/deps/@react-email_components.js?v=29f791cb",
            method: "GET",
            resourceType: "script",
            status: 500,
          },
          {
            kind: "request-failure",
            url: "https://athena-qa.wigclub.store/node_modules/.vite/deps/chunk.js",
            method: "GET",
            resourceType: "script",
            failureReason: "net::ERR_ABORTED",
          },
          {
            kind: "request-failure",
            url: "not-a-valid-url?cache-bust=1",
            method: "GET",
            resourceType: "script",
            failureReason: "net::ERR_FAILED",
          },
          {
            kind: "page-error",
            url: "https://athena-qa.wigclub.store/",
            failureReason: "client boot failed",
          },
        ],
      })
    ).toEqual([
      expect.objectContaining({
        kind: "blank-page",
      }),
      expect.objectContaining({
        kind: "blank-page",
        message:
          "QA page did not render the Athena login email field. This may be a blank app shell, boot failure, or non-Athena access interstitial.",
      }),
      expect.objectContaining({
        kind: "server-response",
        message:
          "HTTP 500 https://athena-qa.wigclub.store/node_modules/.vite/deps/@react-email_components.js",
      }),
      expect.objectContaining({
        kind: "request-failure",
        failureReason: "net::ERR_ABORTED",
      }),
      expect.objectContaining({
        kind: "request-failure",
        message: "Request failed: not-a-valid-url (net::ERR_FAILED)",
      }),
      expect.objectContaining({
        kind: "page-error",
        failureReason: "client boot failed",
      }),
    ]);
  });

  it("accepts rendered Athena QA content without same-origin failures", async () => {
    const listeners = new Map<string, ((payload: any) => void)[]>();
    const page = {
      on(event: string, listener: (payload: any) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      waitForSelector: async () => {},
      textContent: async () => "Athena\nLOG IN\nContinue",
    };

    const browserResult = await ATHENA_QA_LIVE_SMOKE_SCENARIO.browser({
      runPlaywrightFlow: async ({ setupPage, steps }) => {
        await setupPage?.({ page } as any);
        for (const listener of listeners.get("response") ?? []) {
          listener({
            url: () => "https://analytics.example.test/pixel.js",
            status: () => 500,
            request: () => ({
              method: () => "GET",
              resourceType: () => "script",
            }),
          });
        }
        for (const listener of listeners.get("requestfailed") ?? []) {
          listener({
            url: () => "https://analytics.example.test/pixel.js",
            method: () => "GET",
            resourceType: () => "script",
            failure: () => ({ errorText: "net::ERR_ABORTED" }),
          });
        }

        return {
          stepResult: await steps({ page } as any),
          consoleMessages: [],
        };
      },
    } as any);

    expect(browserResult.diagnostics).toEqual([]);
    expect(browserResult.hasEmailField).toBe(true);
    expect(browserResult.observations).toEqual([]);
    await expect(
      ATHENA_QA_LIVE_SMOKE_SCENARIO.assert({
        browserResult,
        runtimeSignals: {},
      } as any)
    ).resolves.toBeUndefined();
  });

  it("rejects non-Athena interstitial pages that only expose generic continue copy", () => {
    expect(
      diagnoseAthenaQaLiveSmoke({
        observedText: "Continue",
        hasEmailField: false,
        observations: [],
      })
    ).toEqual([
      expect.objectContaining({
        kind: "blank-page",
        message: "QA page did not render Athena content. Body preview: Continue",
      }),
      expect.objectContaining({
        kind: "blank-page",
        message:
          "QA page did not render the Athena login email field. This may be a blank app shell, boot failure, or non-Athena access interstitial.",
      }),
    ]);
  });

  it("reports Athena-branded pages that never mount the login form", async () => {
    const page = {
      on: () => {},
      waitForSelector: async (selector: string) => {
        if (selector.includes("input#email")) {
          throw new Error("email input missing");
        }
      },
      textContent: async () => "athena\nContinue",
    };

    const browserResult = await ATHENA_QA_LIVE_SMOKE_SCENARIO.browser({
      runPlaywrightFlow: async ({ steps }) => ({
        stepResult: await steps({ page } as any),
        consoleMessages: [],
      }),
    } as any);

    expect(browserResult.hasEmailField).toBe(false);
    await expect(
      ATHENA_QA_LIVE_SMOKE_SCENARIO.assert({
        browserResult,
        runtimeSignals: {},
      } as any)
    ).rejects.toThrow("QA page did not render the Athena login email field");
  });

  it("asserts the Valkey proxy scenario round-trip contract", async () => {
    const validBrowserResult = {
      rootText: "Valkey proxy running",
      healthStatus: "healthy",
      setStatus: 200,
      getStatus: 200,
      roundTripValue: JSON.stringify({
        state: "ready",
        attempts: 2,
      }),
      consoleMessages: [],
    };

    await expect(
      VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO.assert({
        browserResult: validBrowserResult,
        runtimeSignals: {},
      } as any)
    ).resolves.toBeUndefined();

    await expect(
      VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO.assert({
        browserResult: {
          ...validBrowserResult,
          healthStatus: "degraded",
        },
        runtimeSignals: {},
      } as any)
    ).rejects.toThrow('Expected Valkey health status "healthy"');

    await expect(
      VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO.assert({
        browserResult: {
          ...validBrowserResult,
          rootText: "Not ready",
        },
        runtimeSignals: {},
      } as any)
    ).rejects.toThrow('Expected Valkey root text "Valkey proxy running"');

    await expect(
      VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO.assert({
        browserResult: {
          ...validBrowserResult,
          setStatus: 500,
        },
        runtimeSignals: {},
      } as any)
    ).rejects.toThrow("Expected Valkey set status 200");

    await expect(
      VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO.assert({
        browserResult: {
          ...validBrowserResult,
          getStatus: 404,
        },
        runtimeSignals: {},
      } as any)
    ).rejects.toThrow("Expected Valkey get status 200");

    await expect(
      VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO.assert({
        browserResult: {
          ...validBrowserResult,
          roundTripValue: "{}",
        },
        runtimeSignals: {},
      } as any)
    ).rejects.toThrow("Expected Valkey round-trip payload to be preserved");
  });

  it("runs the Athena QA live smoke scenario through browser observations", async () => {
    const listeners = new Map<string, ((payload: any) => void)[]>();
    const page = {
      on(event: string, listener: (payload: any) => void) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
      },
      waitForSelector: async () => {},
      textContent: async () => "Athena\nLOG IN\nContinue",
    };

    const browserResult = await ATHENA_QA_LIVE_SMOKE_SCENARIO.browser({
      runPlaywrightFlow: async ({ setupPage, steps }) => {
        await setupPage?.({ page } as any);
        for (const listener of listeners.get("response") ?? []) {
          listener({
            url: () =>
              "https://athena-qa.wigclub.store/node_modules/.vite/deps/@react-email_components.js?v=29f791cb",
            status: () => 500,
            request: () => ({
              method: () => "GET",
              resourceType: () => "script",
            }),
          });
        }
        for (const listener of listeners.get("requestfailed") ?? []) {
          listener({
            url: () => "https://athena-qa.wigclub.store/node_modules/.vite/deps/chunk.js",
            method: () => "GET",
            resourceType: () => "script",
            failure: () => ({ errorText: "net::ERR_ABORTED" }),
          });
        }
        for (const listener of listeners.get("pageerror") ?? []) {
          listener(new Error("client boot failed"));
        }

        return {
          stepResult: await steps({ page } as any),
          consoleMessages: [],
        };
      },
    } as any);

    expect(browserResult.observedText).toContain("LOG IN");
    expect(browserResult.hasEmailField).toBe(true);
    expect(browserResult.observations).toHaveLength(3);
    expect(browserResult.diagnostics).toEqual([
      expect.objectContaining({
        kind: "server-response",
      }),
      expect.objectContaining({
        kind: "request-failure",
      }),
      expect.objectContaining({
        kind: "page-error",
      }),
    ]);

    await expect(
      ATHENA_QA_LIVE_SMOKE_SCENARIO.assert({
        browserResult,
        runtimeSignals: {},
      } as any)
    ).rejects.toThrow("HTTP 500 https://athena-qa.wigclub.store/node_modules/.vite/deps/@react-email_components.js");
  });
});
