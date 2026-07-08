import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 4178);
const runLocalCandidateBuild = process.env.ATHENA_POS_E2E_RUN_LOCAL_BUILD === "1";
const baseURL =
  process.env.ATHENA_POS_E2E_BASE_URL ||
  (runLocalCandidateBuild
    ? `http://127.0.0.1:${port}`
    : process.env.ATHENA_PROD_URL || "https://athena.wigclub.store");
const convexUrl =
  process.env.ATHENA_PROD_CONVEX_URL ||
  process.env.VITE_CONVEX_URL ||
  "https://colorless-cardinal-870.convex.cloud";
const apiGatewayUrl =
  process.env.ATHENA_PROD_CONVEX_SITE_URL ||
  process.env.VITE_API_GATEWAY_URL ||
  "https://colorless-cardinal-870.convex.site";
const webServerTimeout = Number(
  process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS ||
    (process.env.CI ? 300_000 : 120_000),
);

export default defineConfig({
  testDir: "./src/tests/prod",
  testMatch: "**/*.prod.spec.ts",
  timeout: 75_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ||
    "/tmp/athena-webapp-prod-playwright-results",
  reporter: process.env.CI ? [["github"], ["html"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: runLocalCandidateBuild
    ? {
        command: `bun run build && bun run serve --host 127.0.0.1 --port ${port}`,
        env: {
          VITE_CONVEX_URL: convexUrl,
          VITE_API_GATEWAY_URL: apiGatewayUrl,
        },
        url: baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: webServerTimeout,
        stdout: "pipe",
        stderr: "pipe",
      }
    : undefined,
});
