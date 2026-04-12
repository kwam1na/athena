import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runHarnessReview } from "./harness-review";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRepo() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-harness-review-"));
  tempRoots.push(rootDir);

  await write(
    "packages/athena-webapp/package.json",
    JSON.stringify(
      {
        name: "@athena/webapp",
        scripts: {
          "audit:convex": "echo audit",
          "lint:convex:changed": "echo lint",
          test: "echo test",
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
    "packages/athena-webapp/docs/agent/validation-map.json",
    JSON.stringify(
      {
        workspace: "@athena/webapp",
        packageDir: "packages/athena-webapp",
        surfaces: [
          {
            name: "athena-package",
            pathPrefixes: ["packages/athena-webapp"],
            commands: [
              { kind: "script", script: "audit:convex" },
              { kind: "script", script: "lint:convex:changed" },
              { kind: "script", script: "test" },
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
            name: "storefront-package",
            pathPrefixes: ["packages/storefront-webapp"],
            commands: [{ kind: "script", script: "test" }],
          },
        ],
      },
      null,
      2
    ),
    rootDir
  );

  await write("packages/athena-webapp/src/app.ts", "export const app = true;\n", rootDir);
  await write(
    "packages/athena-webapp/convex/placeholder.ts",
    "export const placeholder = true;\n",
    rootDir
  );
  await write(
    "packages/storefront-webapp/src/app.ts",
    "export const storefront = true;\n",
    rootDir
  );

  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("runHarnessReview", () => {
  it("runs harness check first and only athena-webapp validations for athena-only changes", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["packages/athena-webapp/src/app.ts"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "@athena/webapp:audit:convex",
      "@athena/webapp:lint:convex:changed",
      "@athena/webapp:test",
    ]);
  });

  it("runs only storefront validations for storefront-only changes", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["packages/storefront-webapp/src/app.ts"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "@athena/storefront-webapp:test",
    ]);
  });

  it("runs both app validation sets when both apps are touched", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => [
        "packages/athena-webapp/src/app.ts",
        "packages/storefront-webapp/src/app.ts",
      ],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "@athena/webapp:audit:convex",
      "@athena/webapp:lint:convex:changed",
      "@athena/webapp:test",
      "@athena/storefront-webapp:test",
    ]);
  });

  it("fails with a stale-harness error when a mapped package script is missing", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/webapp",
          packageDir: "packages/athena-webapp",
          surfaces: [
            {
              name: "athena-package",
              pathPrefixes: ["packages/athena-webapp"],
              commands: [{ kind: "script", script: "missing-script" }],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await expect(
      runHarnessReview(rootDir, {
        getChangedFiles: async () => ["packages/athena-webapp/src/app.ts"],
        runHarnessCheck: async () => {},
        runPackageScript: async () => {},
        logger: {
          log() {},
          error() {},
        },
      })
    ).rejects.toThrow(
      'Stale harness review config: packages/athena-webapp/docs/agent/validation-map.json references missing script "@athena/webapp:missing-script".'
    );
  });

  it("fails with a coverage-gap error when a touched file is not mapped", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/webapp",
          packageDir: "packages/athena-webapp",
          surfaces: [
            {
              name: "convex-only",
              pathPrefixes: ["packages/athena-webapp/convex"],
              commands: [
                { kind: "script", script: "audit:convex" },
                { kind: "script", script: "lint:convex:changed" },
                { kind: "script", script: "test" },
              ],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await expect(
      runHarnessReview(rootDir, {
        getChangedFiles: async () => ["packages/athena-webapp/src/app.ts"],
        runHarnessCheck: async () => {},
        runPackageScript: async () => {},
        logger: {
          log() {},
          error() {},
        },
      })
    ).rejects.toThrow(
      "Harness review coverage gap: packages/athena-webapp/src/app.ts is not covered by any validation mapping."
    );
  });

  it("exits cleanly when no target-app files are touched", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];
    const logs: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["README.md"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      logger: {
        log(message) {
          logs.push(String(message));
        },
        error() {},
      },
    });

    expect(steps).toEqual(["harness:check"]);
    expect(logs).toContain(
      "No target-app validations selected; no touched files under packages/athena-webapp or packages/storefront-webapp."
    );
  });

  it("runs command-based validation surfaces including raw repo-root commands", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await write(
      "packages/athena-webapp/package.json",
      JSON.stringify(
        {
          name: "@athena/webapp",
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
      "packages/athena-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/webapp",
          packageDir: "packages/athena-webapp",
          surfaces: [
            {
              name: "shared-lib-or-utility-edits",
              pathPrefixes: ["packages/athena-webapp/src/lib"],
              commands: [
                { kind: "script", script: "test" },
                {
                  kind: "raw",
                  command:
                    "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
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
      "packages/athena-webapp/src/lib/session.ts",
      "export const session = true;\n",
      rootDir
    );

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["packages/athena-webapp/src/lib/session.ts"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      runRawCommand: async (command) => {
        steps.push(`raw:${command}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "@athena/webapp:test",
      "raw:bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
    ]);
  });
});
