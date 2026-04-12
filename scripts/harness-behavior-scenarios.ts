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
    ],
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
    ],
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
    ],
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
    ],
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

export const HARNESS_BEHAVIOR_SCENARIOS: HarnessBehaviorScenario[] = [
  SAMPLE_RUNTIME_SMOKE_SCENARIO,
  ATHENA_ADMIN_SHELL_BOOT_SCENARIO,
  ATHENA_CONVEX_COMPOSITION_SCENARIO,
  ATHENA_CONVEX_FAILURE_VISIBILITY_SCENARIO,
];
