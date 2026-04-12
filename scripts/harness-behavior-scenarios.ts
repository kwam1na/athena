import type { HarnessBehaviorScenario } from "./harness-behavior";

const SAMPLE_RUNTIME_PORT = Number.parseInt(
  process.env.HARNESS_BEHAVIOR_SAMPLE_PORT ?? "4311",
  10
);

type SampleScenarioBrowserResult = {
  signalStatus: string;
  consoleMessages: string[];
};

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

export const HARNESS_BEHAVIOR_SCENARIOS: HarnessBehaviorScenario[] = [
  SAMPLE_RUNTIME_SMOKE_SCENARIO,
];
