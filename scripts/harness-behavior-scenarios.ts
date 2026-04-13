import {
  type HarnessBehaviorProcessDefinition,
  type HarnessBehaviorScenario,
} from "./harness-behavior";

const SAMPLE_RUNTIME_PORT = Number.parseInt(
  process.env.HARNESS_BEHAVIOR_SAMPLE_PORT ?? "4311",
  10
);
const ATHENA_RUNTIME_PORT = Number.parseInt(
  process.env.HARNESS_BEHAVIOR_ATHENA_PORT ?? "4312",
  10
);
const ATHENA_BOOTSTRAP_USER_ID = "athena-harness-user";
const ATHENA_EXPECTED_STORE_NAME = "athena-harness-store";
const ATHENA_EXPECTED_INVENTORY_SKU_COUNT = "7";
const STOREFRONT_RUNTIME_API_PORT = Number.parseInt(
  process.env.HARNESS_BEHAVIOR_STOREFRONT_API_PORT ?? "4313",
  10
);
const STOREFRONT_RUNTIME_APP_PORT = Number.parseInt(
  process.env.HARNESS_BEHAVIOR_STOREFRONT_APP_PORT ?? "4314",
  10
);
const VALKEY_RUNTIME_PORT = Number.parseInt(
  process.env.HARNESS_BEHAVIOR_VALKEY_PORT ?? "4315",
  10
);

const STOREFRONT_CHECKOUT_BOOTSTRAP_PATH = "/shop/checkout";
const STOREFRONT_CHECKOUT_VALIDATION_BLOCKER_PATH =
  "/shop/checkout/not-a-real-session";
const STOREFRONT_CHECKOUT_RECOVERY_PATH = "/shop/checkout?origin=paystack";

const SAMPLE_RUNTIME_LATENCY_THRESHOLDS = {
  latency: {
    maxTotalDurationMs: 30_000,
    maxPhaseDurationMs: {
      boot: 20_000,
      readiness: 20_000,
      browser: 10_000,
      runtime: 5_000,
      assertion: 5_000,
      cleanup: 10_000,
    },
  },
} satisfies HarnessBehaviorScenario["thresholds"];

const ATHENA_RUNTIME_LATENCY_THRESHOLDS = {
  latency: {
    maxTotalDurationMs: 90_000,
    maxPhaseDurationMs: {
      boot: 25_000,
      readiness: 25_000,
      browser: 30_000,
      runtime: 5_000,
      assertion: 5_000,
      cleanup: 10_000,
    },
  },
} satisfies HarnessBehaviorScenario["thresholds"];

const STOREFRONT_RUNTIME_LATENCY_THRESHOLDS = {
  latency: {
    maxTotalDurationMs: 220_000,
    maxPhaseDurationMs: {
      boot: 140_000,
      readiness: 140_000,
      browser: 45_000,
      runtime: 5_000,
      assertion: 5_000,
      cleanup: 15_000,
    },
  },
} satisfies HarnessBehaviorScenario["thresholds"];

type StorefrontBehaviorMode =
  | "checkout-bootstrap"
  | "validation-blocker"
  | "verification-recovery";

type SampleScenarioBrowserResult = {
  signalStatus: string;
  consoleMessages: string[];
};
type AthenaAdminShellBrowserResult = {
  authState: string;
  authUserId: string;
  consoleMessages: string[];
};
type AthenaConvexCompositionBrowserResult = {
  authState: string;
  storefrontState: string;
  storefrontStoreName: string;
  storefrontInventorySkuCount: string;
  consoleMessages: string[];
};
type AthenaConvexFailureBrowserResult = {
  authState: string;
  storefrontState: string;
  storefrontStatusLine: string;
  consoleMessages: string[];
};
type StorefrontScenarioBrowserResult = {
  observedText: string;
  consoleMessages: string[];
};
type ValkeyScenarioBrowserResult = {
  rootText: string;
  healthStatus: string;
  setStatus: number;
  getStatus: number;
  roundTripValue: string;
  consoleMessages: string[];
};

function createAthenaRuntimeProcess(): HarnessBehaviorProcessDefinition {
  return {
    id: "athena-runtime-app",
    command: "bun scripts/harness-behavior-fixtures/athena-runtime-app.ts",
    env: {
      HARNESS_BEHAVIOR_PORT: String(ATHENA_RUNTIME_PORT),
    },
    readyPattern: `SERVER_READY:${ATHENA_RUNTIME_PORT}`,
    readyTimeoutMs: 20_000,
  };
}

function buildAthenaRuntimeUrl(pathname: string) {
  return `http://127.0.0.1:${ATHENA_RUNTIME_PORT}${pathname}`;
}

function createValkeyRuntimeProcess(): HarnessBehaviorProcessDefinition {
  return {
    id: "valkey-runtime-app",
    command: "bun scripts/harness-behavior-fixtures/valkey-runtime-app.ts",
    env: {
      HARNESS_BEHAVIOR_PORT: String(VALKEY_RUNTIME_PORT),
    },
    readyPattern: `SERVER_READY:${VALKEY_RUNTIME_PORT}`,
    readyTimeoutMs: 20_000,
  };
}

function buildValkeyRuntimeUrl(pathname: string) {
  return `http://127.0.0.1:${VALKEY_RUNTIME_PORT}${pathname}`;
}

function createStorefrontRuntimeProcesses(mode: StorefrontBehaviorMode) {
  return [
    {
      id: "storefront-api",
      command: "bun scripts/harness-behavior-fixtures/storefront-runtime-api.ts",
      env: {
        HARNESS_STOREFRONT_API_PORT: String(STOREFRONT_RUNTIME_API_PORT),
        HARNESS_STOREFRONT_BEHAVIOR_MODE: mode,
      },
      readyPattern: `STOREFRONT_RUNTIME_API_READY:${STOREFRONT_RUNTIME_API_PORT}`,
      readyTimeoutMs: 20_000,
    },
    {
      id: "storefront-webapp",
      command: `bun run --filter '@athena/storefront-webapp' dev --host 127.0.0.1 --port ${STOREFRONT_RUNTIME_APP_PORT}`,
      env: {
        VITE_API_URL: `http://127.0.0.1:${STOREFRONT_RUNTIME_API_PORT}`,
      },
    },
  ] satisfies HarnessBehaviorScenario["processes"];
}

const STOREFRONT_RUNTIME_READINESS_CHECKS: HarnessBehaviorScenario["readiness"] = [
  {
    kind: "http",
    name: "storefront-runtime-api-health",
    url: `http://127.0.0.1:${STOREFRONT_RUNTIME_API_PORT}/health`,
    expectedStatus: 200,
    timeoutMs: 20_000,
    intervalMs: 250,
  },
  {
    kind: "http",
    name: "storefront-runtime-app-shell",
    url: `http://127.0.0.1:${STOREFRONT_RUNTIME_APP_PORT}/`,
    expectedStatus: 200,
    timeoutMs: 120_000,
    intervalMs: 500,
  },
];

export const SAMPLE_RUNTIME_SMOKE_SCENARIO: HarnessBehaviorScenario<SampleScenarioBrowserResult> =
  {
    name: "sample-runtime-smoke",
    description:
      "Boots a minimal local app, drives a browser click, captures runtime logs, asserts signal propagation, and tears down automatically.",
    processes: [
      {
        id: "sample-app",
        command: "bun scripts/harness-behavior-fixtures/sample-app.ts",
        env: {
          HARNESS_BEHAVIOR_PORT: String(SAMPLE_RUNTIME_PORT),
        },
        readyPattern: `SERVER_READY:${SAMPLE_RUNTIME_PORT}`,
        readyTimeoutMs: 20_000,
      },
    ],
    readiness: [
      {
        kind: "http",
        name: "sample-app-health",
        url: `http://127.0.0.1:${SAMPLE_RUNTIME_PORT}/health`,
        expectedStatus: 200,
        timeoutMs: 20_000,
        intervalMs: 250,
      },
    ],
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: `http://127.0.0.1:${SAMPLE_RUNTIME_PORT}/`,
        steps: async ({ page }) => {
          await page.getByRole("button", {
            name: "Trigger runtime signal",
          }).click({
            timeout: 5_000,
          });
          await page.waitForSelector("[data-signal='done']", {
            timeout: 5_000,
          });
          const signalStatus =
            (await page.textContent("[data-signal='done']"))?.trim() ?? "";
          return {
            signalStatus,
          };
        },
      });

      return {
        signalStatus: flowResult.stepResult.signalStatus,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "browser-clicked-signal",
        processId: "sample-app",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:browser-clicked",
        minMatches: 1,
      },
      {
        name: "sample-app-runtime-errors",
        processId: "sample-app",
        source: "combined",
        pattern: "signal request failed",
        minMatches: 0,
        maxMatches: 0,
      },
    ],
    thresholds: SAMPLE_RUNTIME_LATENCY_THRESHOLDS,
    assert: async ({ browserResult, runtimeSignals }) => {
      if (browserResult.signalStatus !== "signal-recorded") {
        throw new Error(
          `Expected sample signal status "signal-recorded", received "${browserResult.signalStatus}".`
        );
      }

      const signalResult = runtimeSignals["browser-clicked-signal"];
      if (!signalResult || signalResult.matchCount < 1) {
        throw new Error(
          "Expected browser-clicked runtime signal to appear in sample app logs."
        );
      }
    },
  };

export const ATHENA_ADMIN_SHELL_BOOT_SCENARIO: HarnessBehaviorScenario<AthenaAdminShellBrowserResult> =
  {
    name: "athena-admin-shell-boot",
    description:
      "Boots an Athena admin-shell fixture with deterministic auth bootstrap and asserts shell + runtime boot health.",
    processes: [createAthenaRuntimeProcess()],
    readiness: [
      {
        kind: "http",
        name: "athena-runtime-health",
        url: buildAthenaRuntimeUrl("/health"),
        expectedStatus: 200,
        timeoutMs: 20_000,
        intervalMs: 250,
      },
    ],
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: buildAthenaRuntimeUrl(
          `/?bootstrapUserId=${encodeURIComponent(ATHENA_BOOTSTRAP_USER_ID)}`
        ),
        steps: async ({ page }) => {
          await page.waitForSelector("[data-auth-state='authed']", {
            timeout: 5_000,
          });
          const authState =
            (await page.textContent("[data-auth-state]"))?.trim() ?? "";
          const authUserId =
            (await page.textContent("[data-auth-user-id]"))?.trim() ?? "";
          return {
            authState,
            authUserId,
          };
        },
      });

      return {
        authState: flowResult.stepResult.authState,
        authUserId: flowResult.stepResult.authUserId,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "athena-admin-shell-boot",
        processId: "athena-runtime-app",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:athena-admin-shell-boot",
        minMatches: 1,
      },
      {
        name: "athena-runtime-errors",
        processId: "athena-runtime-app",
        source: "combined",
        pattern: /(admin shell runtime signal failed|storefront request failed)/,
        minMatches: 0,
        maxMatches: 0,
      },
    ],
    thresholds: ATHENA_RUNTIME_LATENCY_THRESHOLDS,
    assert: async ({ browserResult, runtimeSignals }) => {
      if (browserResult.authState !== "authed") {
        throw new Error(
          `Expected auth shell state "authed", received "${browserResult.authState}".`
        );
      }

      if (browserResult.authUserId !== ATHENA_BOOTSTRAP_USER_ID) {
        throw new Error(
          `Expected authenticated user id "${ATHENA_BOOTSTRAP_USER_ID}", received "${browserResult.authUserId}".`
        );
      }

      const shellSignalResult = runtimeSignals["athena-admin-shell-boot"];
      if (!shellSignalResult || shellSignalResult.matchCount < 1) {
        throw new Error(
          "Expected athena admin-shell boot runtime signal in fixture logs."
        );
      }
    },
  };

export const ATHENA_CONVEX_COMPOSITION_SCENARIO: HarnessBehaviorScenario<AthenaConvexCompositionBrowserResult> =
  {
    name: "athena-convex-storefront-composition",
    description:
      "Runs an authenticated Athena shell fixture and validates a Convex-backed storefront route composition interaction end to end.",
    processes: [createAthenaRuntimeProcess()],
    readiness: [
      {
        kind: "http",
        name: "athena-runtime-health",
        url: buildAthenaRuntimeUrl("/health"),
        expectedStatus: 200,
        timeoutMs: 20_000,
        intervalMs: 250,
      },
    ],
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: buildAthenaRuntimeUrl(
          `/?bootstrapUserId=${encodeURIComponent(ATHENA_BOOTSTRAP_USER_ID)}`
        ),
        steps: async ({ page }) => {
          await page.waitForSelector("[data-auth-state='authed']", {
            timeout: 5_000,
          });

          await page.getByRole("button", {
            name: "Load storefront inventory",
          }).click({
            timeout: 5_000,
          });

          await page.waitForSelector("[data-storefront-state='inventory-ready']", {
            timeout: 5_000,
          });

          const authState =
            (await page.textContent("[data-auth-state]"))?.trim() ?? "";
          const storefrontStatusLine =
            (await page.textContent("[data-storefront-state]"))?.trim() ?? "";
          const [, storefrontStoreName = "", storefrontInventorySkuCount = ""] =
            storefrontStatusLine.split(":");

          return {
            authState,
            storefrontState: storefrontStatusLine.split(":")[0] ?? "",
            storefrontStoreName,
            storefrontInventorySkuCount,
          };
        },
      });

      return {
        authState: flowResult.stepResult.authState,
        storefrontState: flowResult.stepResult.storefrontState,
        storefrontStoreName: flowResult.stepResult.storefrontStoreName,
        storefrontInventorySkuCount:
          flowResult.stepResult.storefrontInventorySkuCount,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "athena-admin-shell-boot",
        processId: "athena-runtime-app",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:athena-admin-shell-boot",
        minMatches: 1,
      },
      {
        name: "convex-route-hit",
        processId: "athena-runtime-app",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:convex-storefront-route-hit",
        minMatches: 1,
      },
      {
        name: "convex-store-query",
        processId: "athena-runtime-app",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:convex-storefront-query",
        minMatches: 1,
      },
      {
        name: "athena-runtime-errors",
        processId: "athena-runtime-app",
        source: "combined",
        pattern: /(admin shell runtime signal failed|storefront request failed)/,
        minMatches: 0,
        maxMatches: 0,
      },
    ],
    thresholds: ATHENA_RUNTIME_LATENCY_THRESHOLDS,
    assert: async ({ browserResult, runtimeSignals }) => {
      if (browserResult.authState !== "authed") {
        throw new Error(
          `Expected auth shell state "authed", received "${browserResult.authState}".`
        );
      }

      if (browserResult.storefrontState !== "inventory-ready") {
        throw new Error(
          `Expected storefront state "inventory-ready", received "${browserResult.storefrontState}".`
        );
      }

      if (browserResult.storefrontStoreName !== ATHENA_EXPECTED_STORE_NAME) {
        throw new Error(
          `Expected storefront store name "${ATHENA_EXPECTED_STORE_NAME}", received "${browserResult.storefrontStoreName}".`
        );
      }

      if (
        browserResult.storefrontInventorySkuCount !==
        ATHENA_EXPECTED_INVENTORY_SKU_COUNT
      ) {
        throw new Error(
          `Expected storefront inventory sku count "${ATHENA_EXPECTED_INVENTORY_SKU_COUNT}", received "${browserResult.storefrontInventorySkuCount}".`
        );
      }

      const routeSignalResult = runtimeSignals["convex-route-hit"];
      if (!routeSignalResult || routeSignalResult.matchCount < 1) {
        throw new Error(
          "Expected Convex storefront route-hit runtime signal in fixture logs."
        );
      }

      const querySignalResult = runtimeSignals["convex-store-query"];
      if (!querySignalResult || querySignalResult.matchCount < 1) {
        throw new Error(
          "Expected Convex storefront query runtime signal in fixture logs."
        );
      }
    },
  };

export const ATHENA_CONVEX_FAILURE_VISIBILITY_SCENARIO: HarnessBehaviorScenario<AthenaConvexFailureBrowserResult> =
  {
    name: "athena-convex-storefront-failure-visibility",
    description:
      "Validates that Convex route composition failures surface clearly in browser state while retaining runtime signal visibility.",
    processes: [createAthenaRuntimeProcess()],
    readiness: [
      {
        kind: "http",
        name: "athena-runtime-health",
        url: buildAthenaRuntimeUrl("/health"),
        expectedStatus: 200,
        timeoutMs: 20_000,
        intervalMs: 250,
      },
    ],
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: buildAthenaRuntimeUrl(
          `/?bootstrapUserId=${encodeURIComponent(ATHENA_BOOTSTRAP_USER_ID)}`
        ),
        steps: async ({ page }) => {
          await page.waitForSelector("[data-auth-state='authed']", {
            timeout: 5_000,
          });

          await page.getByRole("button", {
            name: "Load storefront without store name",
          }).click({
            timeout: 5_000,
          });

          await page.waitForSelector("[data-storefront-state='error']", {
            timeout: 5_000,
          });

          const authState =
            (await page.textContent("[data-auth-state]"))?.trim() ?? "";
          const storefrontStatusLine =
            (await page.textContent("[data-storefront-state]"))?.trim() ?? "";

          return {
            authState,
            storefrontState: storefrontStatusLine.split(":")[0] ?? "",
            storefrontStatusLine,
          };
        },
      });

      return {
        authState: flowResult.stepResult.authState,
        storefrontState: flowResult.stepResult.storefrontState,
        storefrontStatusLine: flowResult.stepResult.storefrontStatusLine,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "convex-route-hit",
        processId: "athena-runtime-app",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:convex-storefront-route-hit",
        minMatches: 1,
      },
      {
        name: "athena-runtime-errors",
        processId: "athena-runtime-app",
        source: "combined",
        pattern: /(admin shell runtime signal failed|storefront request failed)/,
        minMatches: 0,
        maxMatches: 0,
      },
    ],
    thresholds: ATHENA_RUNTIME_LATENCY_THRESHOLDS,
    assert: async ({ browserResult, runtimeSignals }) => {
      if (browserResult.authState !== "authed") {
        throw new Error(
          `Expected auth shell state "authed", received "${browserResult.authState}".`
        );
      }

      if (browserResult.storefrontState !== "error") {
        throw new Error(
          `Expected storefront state "error", received "${browserResult.storefrontState}".`
        );
      }

      if (!browserResult.storefrontStatusLine.includes("Store name missing")) {
        throw new Error(
          `Expected storefront failure output to include "Store name missing", received "${browserResult.storefrontStatusLine}".`
        );
      }

      const routeSignalResult = runtimeSignals["convex-route-hit"];
      if (!routeSignalResult || routeSignalResult.matchCount < 1) {
        throw new Error(
          "Expected Convex storefront route-hit runtime signal in fixture logs."
        );
      }
    },
  };

export const STOREFRONT_CHECKOUT_BOOTSTRAP_SCENARIO: HarnessBehaviorScenario<StorefrontScenarioBrowserResult> =
  {
    name: "storefront-checkout-bootstrap",
    description:
      "Boots the storefront app and mock runtime API, verifies checkout bootstrap UI renders, and asserts checkout bootstrap runtime signals.",
    processes: createStorefrontRuntimeProcesses("checkout-bootstrap"),
    readiness: STOREFRONT_RUNTIME_READINESS_CHECKS,
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: `http://127.0.0.1:${STOREFRONT_RUNTIME_APP_PORT}${STOREFRONT_CHECKOUT_BOOTSTRAP_PATH}`,
        steps: async ({ page }) => {
          await page.waitForSelector("text=Checkout", {
            timeout: 30_000,
          });

          const observedText =
            (await page.textContent("text=Checkout"))?.trim() ?? "";
          return { observedText };
        },
      });

      return {
        observedText: flowResult.stepResult.observedText,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "storefront-checkout-bootstrap-loaded",
        processId: "storefront-api",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:storefront-checkout-bootstrap-loaded",
        minMatches: 1,
      },
      {
        name: "storefront-runtime-api-errors",
        processId: "storefront-api",
        source: "combined",
        pattern: "Unhandled fixture route",
        minMatches: 0,
        maxMatches: 0,
      },
    ],
    thresholds: STOREFRONT_RUNTIME_LATENCY_THRESHOLDS,
    assert: async ({ browserResult, runtimeSignals }) => {
      if (browserResult.observedText !== "Checkout") {
        throw new Error(
          `Expected storefront checkout heading "Checkout", received "${browserResult.observedText}".`
        );
      }

      const bootstrapSignal = runtimeSignals["storefront-checkout-bootstrap-loaded"];
      if (!bootstrapSignal || bootstrapSignal.matchCount < 1) {
        throw new Error(
          "Expected storefront bootstrap runtime signal to appear in fixture API logs."
        );
      }
    },
  };

export const STOREFRONT_CHECKOUT_VALIDATION_BLOCKER_SCENARIO: HarnessBehaviorScenario<StorefrontScenarioBrowserResult> =
  {
    name: "storefront-checkout-validation-blocker",
    description:
      "Boots storefront runtime and asserts invalid checkout-session routing surfaces the validation blocker UI and runtime signal.",
    processes: createStorefrontRuntimeProcesses("validation-blocker"),
    readiness: STOREFRONT_RUNTIME_READINESS_CHECKS,
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: `http://127.0.0.1:${STOREFRONT_RUNTIME_APP_PORT}${STOREFRONT_CHECKOUT_VALIDATION_BLOCKER_PATH}`,
        steps: async ({ page }) => {
          await page.waitForSelector("text=This checkout session does not exist", {
            timeout: 30_000,
          });

          const observedText =
            (await page.textContent("text=This checkout session does not exist"))?.trim() ??
            "";
          return { observedText };
        },
      });

      return {
        observedText: flowResult.stepResult.observedText,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "storefront-checkout-session-missing",
        processId: "storefront-api",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:storefront-checkout-session-missing",
        minMatches: 1,
      },
      {
        name: "storefront-runtime-api-errors",
        processId: "storefront-api",
        source: "combined",
        pattern: "Unhandled fixture route",
        minMatches: 0,
        maxMatches: 0,
      },
    ],
    thresholds: STOREFRONT_RUNTIME_LATENCY_THRESHOLDS,
    assert: async ({ browserResult, runtimeSignals }) => {
      if (
        !browserResult.observedText.includes("This checkout session does not exist")
      ) {
        throw new Error(
          `Expected validation blocker copy for invalid checkout session, received "${browserResult.observedText}".`
        );
      }

      const blockerSignal = runtimeSignals["storefront-checkout-session-missing"];
      if (!blockerSignal || blockerSignal.matchCount < 1) {
        throw new Error(
          "Expected storefront checkout-session-missing signal in fixture API logs."
        );
      }
    },
  };

export const STOREFRONT_CHECKOUT_VERIFICATION_RECOVERY_SCENARIO: HarnessBehaviorScenario<StorefrontScenarioBrowserResult> =
  {
    name: "storefront-checkout-verification-recovery",
    description:
      "Exercises storefront paystack-origin redirect and verification recovery to the checkout complete view with runtime signal assertions.",
    processes: createStorefrontRuntimeProcesses("verification-recovery"),
    readiness: STOREFRONT_RUNTIME_READINESS_CHECKS,
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: `http://127.0.0.1:${STOREFRONT_RUNTIME_APP_PORT}${STOREFRONT_CHECKOUT_RECOVERY_PATH}`,
        steps: async ({ page }) => {
          await page.waitForSelector("text=Get excited, Ada!", {
            timeout: 40_000,
          });
          await page.waitForSelector("text=View order", {
            timeout: 10_000,
          });

          const observedText =
            (await page.textContent("text=Get excited, Ada!"))?.trim() ?? "";
          return { observedText };
        },
      });

      return {
        observedText: flowResult.stepResult.observedText,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "storefront-payment-verification-requested",
        processId: "storefront-api",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:storefront-payment-verification-requested",
        minMatches: 1,
      },
      {
        name: "storefront-runtime-api-errors",
        processId: "storefront-api",
        source: "combined",
        pattern: "Unhandled fixture route",
        minMatches: 0,
        maxMatches: 0,
      },
    ],
    thresholds: STOREFRONT_RUNTIME_LATENCY_THRESHOLDS,
    assert: async ({ browserResult, runtimeSignals }) => {
      if (!browserResult.observedText.includes("Get excited, Ada!")) {
        throw new Error(
          `Expected storefront verification recovery to reach checkout complete UI, received "${browserResult.observedText}".`
        );
      }

      const verificationSignal =
        runtimeSignals["storefront-payment-verification-requested"];
      if (!verificationSignal || verificationSignal.matchCount < 1) {
        throw new Error(
          "Expected storefront payment verification runtime signal in fixture API logs."
        );
      }
    },
  };

export const VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO: HarnessBehaviorScenario<ValkeyScenarioBrowserResult> =
  {
    name: "valkey-proxy-local-request-response",
    description:
      "Boots a local Valkey proxy fixture with an in-memory client and verifies a request/response round trip without live credentials.",
    processes: [createValkeyRuntimeProcess()],
    readiness: [
      {
        kind: "http",
        name: "valkey-runtime-health",
        url: buildValkeyRuntimeUrl("/health"),
        expectedStatus: 200,
        timeoutMs: 20_000,
        intervalMs: 250,
      },
    ],
    browser: async ({ runPlaywrightFlow }) => {
      const flowResult = await runPlaywrightFlow({
        url: buildValkeyRuntimeUrl("/"),
        steps: async ({ page }) => {
          const rootText = (await page.textContent("body"))?.trim() ?? "";

          const healthResponse = await page.evaluate(async () => {
            const response = await fetch("/health");
            return {
              status: response.status,
              body: await response.json(),
            };
          });

          const roundTripResponse = await page.evaluate(async () => {
            const payload = {
              key: "fixture:round-trip",
              value: {
                state: "ready",
                attempts: 2,
              },
            };

            const setResponse = await fetch("/set", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify(payload),
            });

            const getResponse = await fetch("/get", {
              method: "POST",
              headers: {
                "content-type": "application/json",
              },
              body: JSON.stringify({
                key: payload.key,
              }),
            });

            return {
              setStatus: setResponse.status,
              getStatus: getResponse.status,
              roundTripValue: (await getResponse.json()).value ?? "",
            };
          });

          return {
            rootText,
            healthStatus: healthResponse.body.status,
            setStatus: roundTripResponse.setStatus,
            getStatus: roundTripResponse.getStatus,
            roundTripValue: roundTripResponse.roundTripValue,
          };
        },
      });

      return {
        rootText: flowResult.stepResult.rootText,
        healthStatus: flowResult.stepResult.healthStatus,
        setStatus: flowResult.stepResult.setStatus,
        getStatus: flowResult.stepResult.getStatus,
        roundTripValue: flowResult.stepResult.roundTripValue,
        consoleMessages: flowResult.consoleMessages,
      };
    },
    runtimeSignals: [
      {
        name: "valkey-proxy-round-trip",
        processId: "valkey-runtime-app",
        source: "stdout",
        pattern: "RUNTIME_SIGNAL:valkey-proxy-round-trip",
        minMatches: 0,
        maxMatches: 1,
      },
    ],
    thresholds: {
      latency: {
        maxTotalDurationMs: 20_000,
        maxPhaseDurationMs: {
          boot: 10_000,
          readiness: 10_000,
          browser: 5_000,
          runtime: 5_000,
          assertion: 5_000,
          cleanup: 5_000,
        },
      },
    },
    assert: async ({ browserResult, runtimeSignals }) => {
      if (browserResult.rootText !== "Valkey proxy running") {
        throw new Error(
          `Expected Valkey root text "Valkey proxy running", received "${browserResult.rootText}".`
        );
      }

      if (browserResult.healthStatus !== "healthy") {
        throw new Error(
          `Expected Valkey health status "healthy", received "${browserResult.healthStatus}".`
        );
      }

      if (browserResult.setStatus !== 200) {
        throw new Error(
          `Expected Valkey set status 200, received "${browserResult.setStatus}".`
        );
      }

      if (browserResult.getStatus !== 200) {
        throw new Error(
          `Expected Valkey get status 200, received "${browserResult.getStatus}".`
        );
      }

      if (
        browserResult.roundTripValue !==
        JSON.stringify({
          state: "ready",
          attempts: 2,
        })
      ) {
        throw new Error(
          `Expected Valkey round-trip payload to be preserved, received "${browserResult.roundTripValue}".`
        );
      }
    },
  };

export const HARNESS_BEHAVIOR_SCENARIOS: HarnessBehaviorScenario[] = [
  SAMPLE_RUNTIME_SMOKE_SCENARIO,
  ATHENA_ADMIN_SHELL_BOOT_SCENARIO,
  ATHENA_CONVEX_COMPOSITION_SCENARIO,
  ATHENA_CONVEX_FAILURE_VISIBILITY_SCENARIO,
  VALKEY_PROXY_LOCAL_REQUEST_RESPONSE_SCENARIO,
  STOREFRONT_CHECKOUT_BOOTSTRAP_SCENARIO,
  STOREFRONT_CHECKOUT_VALIDATION_BLOCKER_SCENARIO,
  STOREFRONT_CHECKOUT_VERIFICATION_RECOVERY_SCENARIO,
];
