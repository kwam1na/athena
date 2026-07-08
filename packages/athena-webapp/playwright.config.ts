import { defineConfig, devices } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT || 4174);
const baseURL = process.env.PLAYWRIGHT_APP_URL || `http://127.0.0.1:${port}`;
const convexUrl =
  process.env.VITE_CONVEX_URL || "https://playwright-athena.convex.cloud";
const apiGatewayUrl =
  process.env.VITE_API_GATEWAY_URL || "https://playwright-athena.convex.site";
const webServerTimeout = Number(
  process.env.PLAYWRIGHT_WEB_SERVER_TIMEOUT_MS ||
    (process.env.CI ? 300_000 : 120_000),
);

export default defineConfig({
  testDir: "./src/tests",
  testMatch: "**/*.spec.ts",
  timeout: 60_000,
  expect: {
    timeout: 10_000,
  },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  outputDir:
    process.env.PLAYWRIGHT_OUTPUT_DIR ||
    "/tmp/athena-webapp-playwright-results",
  reporter: process.env.CI ? [["github"], ["html"]] : [["list"]],
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: {
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
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
