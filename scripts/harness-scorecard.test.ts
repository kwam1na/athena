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

  if (includeArtifacts) {
    await write(
      "artifacts/harness-inferential-review/latest.json",
      JSON.stringify(
        {
          version: "1.0",
          generatedAt: "2026-04-12T04:55:00.000Z",
          baseRef: "origin/main",
          status: "skipped",
          summary: "No harness-critical files are in scope. Inferential review skipped.",
          providerName: "deterministic-policy-v1",
          changedFiles: ["README.md"],
          targetFiles: [],
          findings: [],
          errors: [],
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
      "graphify",
    ]);
    expect(first.metrics.registry.definition).toContain("onboarding states");
    expect(first.metrics.registry.appCount).toBe(3);
    expect(first.metrics.registry.activeAppCount).toBe(2);
    expect(first.metrics.registry.plannedAppCount).toBe(1);
    expect(first.metrics.registry.scenarioCount).toBe(
      HARNESS_BEHAVIOR_SCENARIOS.length
    );
    expect(first.metrics.registry.apps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appName: "valkey-proxy-server",
          onboardingStatus: "planned",
          validationSurfaceCount: 1,
          scenarioCount: 0,
        }),
      ])
    );
    expect(first.metrics.documentation.appCount).toBe(2);
    expect(first.metrics.documentation.healthyAppCount).toBe(2);
    expect(first.metrics.documentation.degradedAppCount).toBe(0);
    expect(first.metrics.inferential.status).toBe("skipped");
    expect(first.metrics.inferential.findingCount).toBe(0);
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
    expect(result.metrics.graphify.status).toBe("missing");
    expect(result.summary.status).toBe("degraded");
    expect(result.summary.missingSignals).toBeGreaterThan(0);
  });
});
