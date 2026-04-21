import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runHarnessSelfReview } from "./harness-self-review";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-self-review-"));
  tempRoots.push(rootDir);

  await write(
    "packages/athena-webapp/package.json",
    JSON.stringify(
      {
        name: "@athena/webapp",
        scripts: {
          test: "echo test",
          "storybook:build": "echo storybook",
          "lint:architecture": "echo lint",
        },
      },
      null,
      2
    ),
    rootDir
  );

  await write(
    "packages/storefront-webapp/package.json",
    JSON.stringify(
      {
        name: "@athena/storefront-webapp",
        scripts: {
          test: "echo test",
        },
      },
      null,
      2
    ),
    rootDir
  );

  await write(
    "packages/valkey-proxy-server/package.json",
    JSON.stringify(
      {
        name: "valkey-proxy-server",
        scripts: {
          test: "node --test app.test.js",
        },
      },
      null,
      2
    ),
    rootDir
  );

  await write(
    "packages/athena-webapp/docs/agent/testing.md",
    [
      "# Athena Webapp Testing",
      "",
      "Run `bun run harness:review` from the repo root for touched-file validation coverage.",
      "Machine-readable review coverage lives in [validation-map.json](./validation-map.json).",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/storefront-webapp/docs/agent/testing.md",
    [
      "# Storefront Webapp Testing",
      "",
      "Run `bun run harness:review` from the repo root for touched-file validation coverage.",
      "Machine-readable review coverage lives in [validation-map.json](./validation-map.json).",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/valkey-proxy-server/docs/agent/testing.md",
    [
      "# Valkey Proxy Server Testing",
      "",
      "Run `bun run harness:review` from the repo root for touched-file validation coverage.",
      "Machine-readable review coverage lives in [validation-map.json](./validation-map.json).",
      "Use `bun run harness:behavior --list` to inspect available runtime scenarios.",
      "Current shared scenarios include:",
      "- `sample-runtime-smoke`",
      "- `athena-admin-shell-boot`",
      "- `athena-convex-storefront-composition`",
      "- `athena-convex-storefront-failure-visibility`",
      "- `valkey-proxy-local-request-response`",
      "- `storefront-checkout-bootstrap`",
      "- `storefront-checkout-validation-blocker`",
      "- `storefront-checkout-verification-recovery`",
      "",
      "Use `bun run harness:behavior --scenario valkey-proxy-local-request-response` for the local request/response smoke check.",
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
            commands: [
              { kind: "script", script: "test" },
              { kind: "script", script: "lint:architecture" },
            ],
          },
          {
            name: "shared-lib-or-utility-edits",
            pathPrefixes: ["packages/athena-webapp/src/lib"],
            commands: [
              { kind: "script", script: "test" },
              {
                kind: "raw",
                command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
              },
            ],
          },
          {
            name: "harness-docs",
            pathPrefixes: ["packages/athena-webapp/docs/agent"],
            commands: [],
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
          },
          {
            name: "harness-docs",
            pathPrefixes: ["packages/storefront-webapp/docs/agent"],
            commands: [],
          },
        ],
      },
      null,
      2
    ),
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
            name: "service-logic-docs-or-entrypoint-edits",
            pathPrefixes: [
              "packages/valkey-proxy-server/package.json",
              "packages/valkey-proxy-server/README.md",
              "packages/valkey-proxy-server/app.js",
              "packages/valkey-proxy-server/app.test.js",
              "packages/valkey-proxy-server/index.js",
            ],
            commands: [
              { kind: "script", script: "test" },
              {
                kind: "raw",
                command: "node --check packages/valkey-proxy-server/app.js",
              },
              {
                kind: "raw",
                command: "node --check packages/valkey-proxy-server/index.js",
              },
            ],
            behaviorScenarios: ["valkey-proxy-local-request-response"],
          },
          {
            name: "live-connection-probe-edits",
            pathPrefixes: ["packages/valkey-proxy-server/test-connection.js"],
            commands: [
              { kind: "script", script: "test" },
              {
                kind: "raw",
                command: "node --check packages/valkey-proxy-server/test-connection.js",
              },
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
    "packages/athena-webapp/docs/agent/validation-guide.md",
    [
      "# Athena Webapp Validation Guide",
      "",
      "## Route or UI-only edits",
      "",
      "Run:",
      "",
      "- `bun run --filter '@athena/webapp' test`",
      "",
      "## Shared-lib or utility edits",
      "",
      "Run:",
      "",
      "- `bun run --filter '@athena/webapp' test`",
      "- `bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json`",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/storefront-webapp/docs/agent/validation-guide.md",
    [
      "# Storefront Webapp Validation Guide",
      "",
      "## Full browser journeys and payment redirects",
      "",
      "Run:",
      "",
      "- `bun run --filter '@athena/storefront-webapp' test`",
    ].join("\n"),
    rootDir
  );

  await write(
    "packages/valkey-proxy-server/docs/agent/validation-guide.md",
    [
      "# Valkey Proxy Server Validation Guide",
      "",
      "## Service logic, docs, or entrypoint edits",
      "",
      "Run:",
      "",
      "- `bun run --filter 'valkey-proxy-server' test`",
      "- `node --check packages/valkey-proxy-server/app.js`",
      "- `node --check packages/valkey-proxy-server/index.js`",
      "",
      "Behavior scenarios:",
      "",
      "- `valkey-proxy-local-request-response`",
    ].join("\n"),
    rootDir
  );

  await write("packages/athena-webapp/src/routes/index.tsx", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/lib/session.ts", "export {};\n", rootDir);
  await write("packages/athena-webapp/src/unmapped.ts", "export {};\n", rootDir);
  await write("packages/storefront-webapp/src/routes/index.tsx", "export {};\n", rootDir);
  await write("packages/valkey-proxy-server/README.md", "# Valkey\n", rootDir);
  await write("packages/valkey-proxy-server/app.js", "module.exports = {};\n", rootDir);
  await write("packages/valkey-proxy-server/app.test.js", "module.exports = {};\n", rootDir);
  await write("packages/valkey-proxy-server/index.js", "module.exports = {};\n", rootDir);
  await write("packages/valkey-proxy-server/test-connection.js", "module.exports = {};\n", rootDir);

  await write("graphify-out/GRAPH_REPORT.md", "# Graph\n", rootDir);
  await write("graphify-out/graph.json", "{}\n", rootDir);

  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("runHarnessSelfReview", () => {
  it("produces deterministic markdown with mapped surfaces and selected validations", async () => {
    const rootDir = await createFixtureRepo();

    const changedFiles = {
      baseFiles: [
        "graphify-out/graph.json",
        "packages/athena-webapp/src/lib/session.ts",
        "graphify-out/GRAPH_REPORT.md",
      ],
      trackedFiles: [],
      untrackedFiles: [],
    };

    const first = await runHarnessSelfReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async () => changedFiles,
      runHarnessCheck: async () => {},
    });
    const second = await runHarnessSelfReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async () => changedFiles,
      runHarnessCheck: async () => {},
    });

    expect(first.blockers).toEqual([]);
    expect(first.markdown).toBe(second.markdown);
    expect(first.markdown).toContain("# Harness Self Review");
    expect(first.markdown).toContain("## Changed surfaces");
    expect(first.markdown).toContain("shared-lib-or-utility-edits");
    expect(first.markdown).toContain("## Selected validations");
    expect(first.markdown).toContain("bun run --filter '@athena/webapp' test");
    expect(first.markdown).toContain("bun run harness:check");
    expect(first.markdown).toContain("## Graphify freshness");
    expect(first.markdown).toContain("status: fresh");
    expect(first.markdown).toContain("## Runtime behavior scenarios");
    expect(first.markdown).toContain("Route or UI-only edits");
    expect(first.markdown).toContain("## Verdict");
    expect(first.markdown).toContain("READY");
  });

  it("fails with a hard blocker when changed files are not covered by validation surfaces", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessSelfReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async () => ({
        baseFiles: ["packages/athena-webapp/src/unmapped.ts"],
        trackedFiles: [],
        untrackedFiles: [],
      }),
      runHarnessCheck: async () => {},
    });

    expect(result.blockers).toContain(
      "Harness review coverage gap: packages/athena-webapp/src/unmapped.ts is not covered by any validation mapping."
    );
    expect(result.markdown).toContain("## Harness coverage");
    expect(result.markdown).toContain("### Blockers");
    expect(result.markdown).toContain("BLOCKED");
  });

  it("allows deleted unmapped files when the same package still has direct validation coverage", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessSelfReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async () => ({
        baseFiles: [
          "packages/storefront-webapp/src/routes/index.tsx",
          "packages/storefront-webapp/src/client.tsx",
        ],
        trackedFiles: [],
        untrackedFiles: [],
      }),
      runHarnessCheck: async () => {},
    });

    expect(result.blockers).toEqual([]);
    expect(result.markdown).not.toContain(
      "Harness review coverage gap: packages/storefront-webapp/src/client.tsx"
    );
    expect(result.markdown).toContain("READY");
  });

  it("lists available runtime behavior scenarios for touched packages", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessSelfReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async () => ({
        baseFiles: ["packages/storefront-webapp/src/routes/index.tsx"],
        trackedFiles: [],
        untrackedFiles: [],
      }),
      runHarnessCheck: async () => {},
    });

    expect(result.blockers).toEqual([]);
    expect(result.markdown).toContain("Storefront Webapp");
    expect(result.markdown).toContain("Full browser journeys and payment redirects");
  });

  it("selects deterministic service-package validations for valkey changes", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessSelfReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async () => ({
        baseFiles: ["packages/valkey-proxy-server/package.json"],
        trackedFiles: [],
        untrackedFiles: [],
      }),
      runHarnessCheck: async () => {},
    });

    expect(result.blockers).toEqual([]);
    expect(result.markdown).toContain("Valkey Proxy Server");
    expect(result.markdown).toContain("service-logic-docs-or-entrypoint-edits");
    expect(result.markdown).toContain("bun run --filter 'valkey-proxy-server' test");
    expect(result.markdown).toContain(
      "node --check packages/valkey-proxy-server/app.js"
    );
    expect(result.markdown).toContain(
      "node --check packages/valkey-proxy-server/index.js"
    );
    expect(result.markdown).toContain("## Runtime behavior scenarios");
  });

  it.each([
    [".worktrees/codex-v26-208/.git", ".worktrees"],
    ["worktrees/codex-v26-208/.git", "worktrees"],
    ["artifacts/harness-behavior/video.webm", "artifacts"],
  ])(
    "ignores %s changes when evaluating graphify freshness",
    async (changedPath) => {
      const rootDir = await createFixtureRepo();

      const result = await runHarnessSelfReview(rootDir, {
        baseRef: "origin/main",
        getChangedFiles: async () => ({
          baseFiles: [changedPath],
          trackedFiles: [],
          untrackedFiles: [],
        }),
        runHarnessCheck: async () => {},
      });

      expect(result.warnings).toEqual([]);
      expect(result.markdown).toContain("status: n/a");
      expect(result.markdown).toContain(
        "No source/config changes detected outside Graphify artifacts and local generated paths."
      );
    }
  );

  it("keeps stale graphify warnings for real code/config changes", async () => {
    const rootDir = await createFixtureRepo();

    const result = await runHarnessSelfReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async () => ({
        baseFiles: ["packages/athena-webapp/src/lib/session.ts"],
        trackedFiles: [],
        untrackedFiles: [],
      }),
      runHarnessCheck: async () => {},
    });

    expect(result.warnings).toContain(
      "Graphify appears stale relative to current changed files. Run `bun run graphify:rebuild` before handoff."
    );
    expect(result.markdown).toContain("status: stale");
  });
});
