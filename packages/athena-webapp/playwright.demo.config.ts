import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.ATHENA_DEMO_URL;
if (!baseURL) throw new Error("Set ATHENA_DEMO_URL to the candidate or QA app to validate.");

export default defineConfig({
  testDir: "./src/tests/demo",
  testMatch: "**/*.live.ts",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  workers: 1,
  retries: 0,
  reporter: [["list"], ["html", { outputFolder: "/tmp/athena-demo-navigation-report", open: "never" }]],
  outputDir: "/tmp/athena-demo-navigation-results",
  use: { baseURL, trace: "retain-on-failure", screenshot: "only-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
