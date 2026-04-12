import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { HARNESS_BEHAVIOR_SCENARIOS } from "./harness-behavior-scenarios";
import { collectHarnessScorecard } from "./harness-scorecard";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo(includeArtifacts: boolean) {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-scorecard-"));
  tempRoots.push(rootDir);

  const scenarioList = HARNESS_BEHAVIOR_SCENARIOS.map(
    (scenario) => `- \`${scenario.name}\``
  ).join("\n");

  await write(
    "packages/athena-webapp/docs/agent/testing.md",
    [
      "# Athena Webapp Testing",
      "",
      "- `bun run harness:check`",
      "- `bun run harness:review`",
      "- `bun run harness:audit`",
      "- [validation-map.json](./validation-map.json)",
      "",
      "Current shared scenarios include:",
      "",
      scenarioList,
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/storefront-webapp/docs/agent/testing.md",
    [
      "# Storefront Webapp Testing",
      "",
      "- `bun run harness:check`",
      "- `bun run harness:review`",
      "- `bun run harness:audit`",
      "- [validation-map.json](./validation-map.json)",
      "",
      "Bundled scenarios include:",
      "",
      scenarioList,
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/athena-webapp/docs/agent/validation-map.json",
    JSON.stringify(
      {
        workspace: "@athena/webapp",
        packageDir: "packages/athena-webapp",
        surfaces: [
          {
            name: "route-or-ui-only-edits",
            pathPrefixes: ["packages/athena-webapp/src/routes"],
            commands: [{ kind: "script", script: "test" }],
            behaviorScenarios: [
              "sample-runtime-smoke",
              "athena-admin-shell-boot",
            ],
          },
        ],
      },
      null,
      2
    ),
    rootDir
  );

  await write(
    "packages/storefront-webapp/docs/agent/validation-map.json",
    JSON.stringify(
      {
        workspace: "@athena/storefront-webapp",
        packageDir: "packages/storefront-webapp",
        surfaces: [
          {
            name: "route-or-ui-only-edits",
            pathPrefixes: ["packages/storefront-webapp/src/routes"],
            commands: [{ kind: "script", script: "test" }],
            behaviorScenarios: [
              "storefront-checkout-bootstrap",
              "storefront-checkout-validation-blocker",
            ],
          },
        ],
      },
      null,
      2
    ),
    rootDir
  );

  await write(
    "packages/valkey-proxy-server/docs/agent/testing.md",
    [
      "# Valkey Proxy Server Testing",
      "",
      "- `bun run harness:check`",
      "- `bun run harness:review`",
      "- `bun run harness:audit`",
      "- [validation-map.json](./validation-map.json)",
      "",
      "Default local checks start with `bun run --filter 'valkey-proxy-server' test`.",
      "Live connectivity checks use `bun run --filter 'valkey-proxy-server' test:connection`.",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/valkey-proxy-server/docs/agent/validation-map.json",
    JSON.stringify(
      {
        workspace: "valkey-proxy-server",
        packageDir: "packages/valkey-proxy-server",
        surfaces: [
          {
            name: "service-entry-and-support-surfaces",
            pathPrefixes: [
              "packages/valkey-proxy-server/package.json",
              "packages/valkey-proxy-server/README.md",
              "packages/valkey-proxy-server/app.js",
              "packages/valkey-proxy-server/app.test.js",
              "packages/valkey-proxy-server/index.js",
            ],
            commands: [{ kind: "script", script: "test" }],
            behaviorScenarios: [],
          },
          {
            name: "live-connection-probe-edits",
            pathPrefixes: ["packages/valkey-proxy-server/test-connection.js"],
            commands: [{ kind: "script", script: "test" }],
            behaviorScenarios: [],
          },
        ],
      },
      null,
      2
    ),
    rootDir
  );

  if (includeArtifacts) {
    await write(
      "artifacts/harness-inferential-review/latest.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-12T04:55:00.000Z",
          reviewMode: "semantic-shadow",
          baseRef: "origin/main",
          status: "skipped",
          summary: "No harness-critical files are in scope. Inferential review skipped.",
          providerName: "deterministic-policy-v1",
          changedFiles: ["README.md"],
          targetFiles: [],
          findings: [],
          errors: [],
          shadow: {
            generatedAt: "2026-04-12T04:55:00.000Z",
            status: "skipped",
            summary:
              "Shadow semantic review skipped because ANTHROPIC_API_KEY is not configured.",
            providerName: "semantic-shadow-stub",
            findings: [],
            errors: [],
          },
        },
        null,
        2
      ),
      rootDir
    );
    await write(
      "artifacts/harness-inferential-review/history/2026-04-11T05-00-00-000Z.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-11T05:00:00.000Z",
          reviewMode: "semantic-shadow",
          baseRef: "origin/main",
          status: "pass",
          summary: "Inferential review completed with no actionable findings.",
          providerName: "deterministic-policy-v1",
          changedFiles: ["scripts/harness-scorecard.ts"],
          targetFiles: ["scripts/harness-scorecard.ts"],
          findings: [],
          errors: [],
          shadow: {
            generatedAt: "2026-04-11T05:00:00.000Z",
            status: "pass",
            summary: "Shadow semantic review found no semantic issues.",
            providerName: "semantic-shadow-stub",
            findings: [],
            errors: [],
          },
        },
        null,
        2
      ),
      rootDir
    );
    await write(
      "artifacts/harness-inferential-review/history/2026-04-12T04-55-00-000Z.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-12T04:55:00.000Z",
          reviewMode: "semantic-shadow",
          baseRef: "origin/main",
          status: "skipped",
          summary: "No harness-critical files are in scope. Inferential review skipped.",
          providerName: "deterministic-policy-v1",
          changedFiles: ["README.md"],
          targetFiles: [],
          findings: [],
          errors: [],
          shadow: {
            generatedAt: "2026-04-12T04:55:00.000Z",
            status: "skipped",
            summary:
              "Shadow semantic review skipped because ANTHROPIC_API_KEY is not configured.",
            providerName: "semantic-shadow-stub",
            findings: [],
            errors: [],
          },
        },
        null,
        2
      ),
      rootDir
    );

    await write(
      "artifacts/harness-behavior/trends/latest.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-12T04:58:00.000Z",
          parseErrors: [],
          scenarios: [
            {
              scenarioName: "sample-runtime-smoke",
              reportCount: 1,
              passCount: 1,
              failCount: 0,
              passRate: 1,
              totalDurationMs: {
                count: 1,
                minMs: 1000,
                maxMs: 1000,
                averageMs: 1000,
                p50Ms: 1000,
                p90Ms: 1000,
              },
              phaseDurations: [],
              runtimeSignals: {
                totalCount: 0,
                belowMinCount: 0,
                aboveMaxCount: 0,
                withinBoundsCount: 0,
              },
              failurePhases: [],
              diagnostics: [],
            },
          ],
          summary: {
            reportCount: 1,
            scenarioCount: 1,
            passCount: 1,
            failCount: 0,
            parseErrorCount: 0,
            status: "healthy",
            note: "1 parsed reports across 1 scenarios. 0 parse errors. 0 regression warnings.",
            regressions: [],
          },
        },
        null,
        2
      ),
      rootDir
    );
    await write(
      "artifacts/harness-behavior/trends/history/2026-04-12T04-58-00-000Z.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-12T04:58:00.000Z",
          parseErrors: [],
          scenarios: [],
          summary: {
            reportCount: 1,
            scenarioCount: 1,
            passCount: 1,
            failCount: 0,
            parseErrorCount: 0,
            status: "healthy",
            note: "history sample",
            regressions: [],
          },
        },
        null,
        2
      ),
      rootDir
    );

    await write("graphify-out/GRAPH_REPORT.md", "# Graph report\n", rootDir);
    await write("graphify-out/graph.json", "{\"fresh\":true}\n", rootDir);
  }

  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("collectHarnessScorecard", () => {
  it("produces deterministic metrics from the registry, docs, inferential artifact, and graphify artifacts", async () => {
    const rootDir = await createFixtureRepo(true);

    const first = await collectHarnessScorecard(rootDir, {
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });
    const second = await collectHarnessScorecard(rootDir, {
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: "1.0",
      generatedAt: "2026-04-12T05:00:00.000Z",
      summary: {
        status: "healthy",
      },
    });
    expect(Object.keys(first.metrics)).toEqual([
      "registry",
      "documentation",
      "inferential",
      "runtimeTrends",
      "graphify",
    ]);
    expect(first.metrics.registry.definition).toContain("onboarding states");
    expect(first.metrics.registry.appCount).toBe(3);
    expect(first.metrics.registry.activeAppCount).toBe(3);
    expect(first.metrics.registry.plannedAppCount).toBe(0);
    expect(first.metrics.registry.scenarioCount).toBe(
      HARNESS_BEHAVIOR_SCENARIOS.length
    );
    expect(first.metrics.registry.apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appName: "valkey-proxy-server",
          onboardingStatus: "active",
          validationSurfaceCount: 2,
          scenarioCount: 0,
        }),
      ])
    );
    expect(first.metrics.documentation.appCount).toBe(3);
    expect(first.metrics.documentation.healthyAppCount).toBe(3);
    expect(first.metrics.documentation.degradedAppCount).toBe(0);
    expect(first.metrics.inferential.status).toBe("skipped");
    expect(first.metrics.inferential.reviewMode).toBe("semantic-shadow");
    expect(first.metrics.inferential.shadow).toMatchObject({
      status: "skipped",
      providerName: "semantic-shadow-stub",
    });
    expect(first.metrics.inferential.findingCount).toBe(0);
    expect(first.metrics.inferential.history).toMatchObject({
      present: true,
      sampleCount: 2,
      parseErrorCount: 0,
    });
    expect(first.metrics.runtimeTrends).toMatchObject({
      present: true,
      status: "healthy",
      reportCount: 1,
      scenarioCount: 1,
    });
    expect(first.metrics.runtimeTrends.history).toMatchObject({
      present: true,
      sampleCount: 1,
      parseErrorCount: 0,
    });
    expect(first.metrics.graphify.status).toBe("paired");
    expect(first.metrics.graphify.reportPresent).toBe(true);
    expect(first.metrics.graphify.graphPresent).toBe(true);
  });

  it("marks missing inferential and graphify artifacts explicitly", async () => {
    const rootDir = await createFixtureRepo(false);

    const result = await collectHarnessScorecard(rootDir, {
      nowIso: () => "2026-04-12T05:00:00.000Z",
    });

    expect(result.metrics.inferential.status).toBe("missing");
    expect(result.metrics.runtimeTrends.status).toBe("missing");
    expect(result.metrics.graphify.status).toBe("missing");
    expect(result.summary.status).toBe("degraded");
    expect(result.summary.missingSignals).toBeGreaterThan(0);
  });

  it("surfaces malformed history and repeated shadow provider errors without crashing", async () => {
    const rootDir = await createFixtureRepo(true);

    await write(
      "artifacts/harness-inferential-review/history/2026-04-12T05-10-00-000Z.json",
      "not-json\n",
      rootDir
    );
    await write(
      "artifacts/harness-inferential-review/history/2026-04-12T05-15-00-000Z.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-12T05:15:00.000Z",
          reviewMode: "semantic-shadow",
          baseRef: "origin/main",
          status: "pass",
          summary: "Inferential review completed with no actionable findings.",
          providerName: "deterministic-policy-v1",
          changedFiles: ["scripts/harness-scorecard.ts"],
          targetFiles: ["scripts/harness-scorecard.ts"],
          findings: [],
          errors: [],
          shadow: {
            generatedAt: "2026-04-12T05:15:00.000Z",
            status: "error",
            summary:
              "Shadow semantic review failed, but deterministic inferential review remains authoritative.",
            providerName: "semantic-shadow-stub",
            findings: [],
            errors: [
              {
                code: "INFERENTIAL_RUNTIME_FAILURE",
                message: "provider timeout",
                remediation: "retry",
              },
            ],
          },
        },
        null,
        2
      ),
      rootDir
    );
    await write(
      "artifacts/harness-inferential-review/history/2026-04-12T05-20-00-000Z.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-12T05:20:00.000Z",
          reviewMode: "semantic-shadow",
          baseRef: "origin/main",
          status: "pass",
          summary: "Inferential review completed with no actionable findings.",
          providerName: "deterministic-policy-v1",
          changedFiles: ["scripts/harness-scorecard.ts"],
          targetFiles: ["scripts/harness-scorecard.ts"],
          findings: [],
          errors: [],
          shadow: {
            generatedAt: "2026-04-12T05:20:00.000Z",
            status: "error",
            summary:
              "Shadow semantic review failed, but deterministic inferential review remains authoritative.",
            providerName: "semantic-shadow-stub",
            findings: [],
            errors: [
              {
                code: "INFERENTIAL_RUNTIME_FAILURE",
                message: "provider timeout",
                remediation: "retry",
              },
            ],
          },
        },
        null,
        2
      ),
      rootDir
    );

    const result = await collectHarnessScorecard(rootDir, {
      nowIso: () => "2026-04-12T05:30:00.000Z",
    });

    expect(result.metrics.inferential.history.parseErrorCount).toBe(1);
    expect(result.metrics.inferential.history.shadowErrorCount).toBeGreaterThanOrEqual(2);
    expect(result.summary.status).toBe("mixed");
  });
});
