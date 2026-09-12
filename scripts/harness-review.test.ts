import { spawnSync } from "node:child_process";
import { chmod, lstat, mkdtemp, mkdir, readFile, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
// CLI boundary coverage is centralized in harness-blocker-inventory.test.ts.

import {
  ATHENA_ALWAYS_VALIDATION_COMMANDS,
  ATHENA_FINAL_VALIDATION_COMMANDS,
  buildGitProcessEnv,
  getChangedFilesForHarnessReview,
  parseHarnessReviewArgs,
  resolveHarnessReviewShell,
  runRawCommand,
  runHarnessReview as runCompleteHarnessReview,
} from "./harness-review";
import { harnessReviewBlockedBlocker } from "./harness-review";
import { HarnessUsageError } from "./harness-blockers";

// These retained rows characterize map selection. Required sensors are asserted separately.
const alwaysRaw = new Set<string>([...ATHENA_ALWAYS_VALIDATION_COMMANDS, ...ATHENA_FINAL_VALIDATION_COMMANDS].filter(c => c.kind === "raw").map(c => c.command));
const alwaysScripts = new Set<string>([...ATHENA_ALWAYS_VALIDATION_COMMANDS, ...ATHENA_FINAL_VALIDATION_COMMANDS].filter(c => c.kind === "script").map(c => `${c.workspace}:${c.script}`));
const runHarnessReview: typeof runCompleteHarnessReview = (rootDir, options = {}) => runCompleteHarnessReview(rootDir, {
  ...options,
  runRawCommand: async command => {
    if (!alwaysRaw.has(command)) await options.runRawCommand?.(command);
  },
  runPackageScript: async (workspace, script) => {
    if (!alwaysScripts.has(`${workspace}:${script}`)) await options.runPackageScript?.(workspace, script);
  },
});

const tempRoots: string[] = [];

describe("validation output transport", () => {
  it("preserves repeated mixed launches and literal arguments in one process", async () => {
    const rootDir = await createFixtureRepo();
    await write("probe.ts", 'process.stdout.write(JSON.stringify(Bun.argv.slice(2))); process.stderr.write("stderr-marker");', rootDir);
    const argument = 'spaces ; $(touch SHOULD_NOT_EXIST) "quoted"';
    const runner = path.resolve(import.meta.dir, "harness-review.ts");
    const fixture = `import { spawnLoggedValidation } from ${JSON.stringify(runner)};
      const argv = ["bun", ${JSON.stringify(path.join(rootDir, "probe.ts"))}, ${JSON.stringify(argument)}];
      for (let index = 0; index < 40; index++) {
        const command = index % 2 ? argv : ["/bin/sh", "-c", 'exec "$@"', "fixture", ...argv];
        if (await spawnLoggedValidation(command, {cwd:${JSON.stringify(rootDir)}}).exited !== 0) process.exit(1);
      }`;
    const result = spawnSync("bun", ["-e", fixture], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 15_000 });
    const logs = [...result.stdout.matchAll(/Validation log: (.+)/g)].map(match => match[1]);
    tempRoots.push(...logs.map(logPath => path.dirname(logPath)));
    expect(result.status).toBe(0);
    expect(logs).toHaveLength(40);
    for (const logPath of logs) {
      expect(await readFile(logPath, "utf8")).toBe(JSON.stringify([argument]) + "stderr-marker");
    }
    await expect(readFile(path.join(rootDir, "SHOULD_NOT_EXIST"))).rejects.toMatchObject({ code: "ENOENT" });
  }, 20_000);

  for (const launcher of ["raw", "package", "behavior"] as const) {
    for (const exitCode of [0, 7]) {
      it(`retains verbose ${launcher} output and propagates exit ${exitCode}`, async () => {
        const rootDir = await createFixtureRepo();
        await write("probe.ts", `await Bun.write(Bun.stdout, "x".repeat(1200000)); await Bun.write(Bun.stderr, "stderr-marker"); process.exit(${exitCode});`, rootDir);
        await write("package.json", JSON.stringify({ private: true, workspaces: ["packages/*"], scripts: { "harness:behavior": "bun probe.ts" } }), rootDir);
        const packagePath = path.join(rootDir, "packages/athena-webapp/package.json");
        const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
        packageJson.scripts.test = "bun ../../probe.ts";
        await writeFile(packagePath, JSON.stringify(packageJson));
        const runner = path.resolve(import.meta.dir, "harness-review.ts");
        const invocation = launcher === "raw"
          ? `await runRawCommand(${JSON.stringify(rootDir)}, "bun probe.ts");`
          : `await runHarnessReview(${JSON.stringify(rootDir)}, {
              getChangedFiles: async () => [${JSON.stringify(launcher === "package" ? "packages/athena-webapp/src/app.ts" : "packages/valkey-proxy-server/app.js")}],
              runHarnessCheck: async () => {},
              runRawCommand: async () => {},
              ${launcher === "behavior" ? "runPackageScript: async () => {}," : ""}
            });`;
        const fixture = `import { runRawCommand, runHarnessReview } from ${JSON.stringify(runner)}; ${invocation}`;
        const result = spawnSync("bun", ["-e", fixture], { encoding: "utf8", maxBuffer: 1024 * 1024, timeout: 15_000 });
        expect(result.status).toBe(exitCode === 0 ? 0 : 1);
        expect(result.stdout.length + result.stderr.length).toBeLessThan(16384);
        if (exitCode !== 0) expect(result.stderr).toContain("Command failed (7)");
        const logs = [...result.stdout.matchAll(/Validation log: (.+)/g)].map(match => match[1]);
        expect(logs.length).toBeGreaterThan(0);
        tempRoots.push(...logs.map(logPath => path.dirname(logPath)));
        const outputs = await Promise.all(logs.map(logPath => readFile(logPath, "utf8")));
        const probeOutput = outputs.find(output => output.includes("stderr-marker"));
        expect(probeOutput?.length).toBeGreaterThanOrEqual(1200000);
        expect(probeOutput?.includes("x".repeat(1200000))).toBe(true);
        expect(probeOutput).toContain("stderr-marker");
      }, 20_000);
    }
  }
});

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
          "lint:frontend:changed": "echo lint frontend",
          "storybook:build": "echo storybook",
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
    "packages/valkey-proxy-server/package.json",
    JSON.stringify(
      {
        name: "valkey-proxy-server",
        scripts: {
          start: "node index.js",
          test: "node --test app.test.js",
          "test:connection": "node test-connection.js",
          dev: "nodemon index.js",
        },
      },
      null,
      2
    ),
    rootDir
  );
  await write(
    "packages/valkey-proxy-server/README.md",
    "# Valkey Proxy Server\n",
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
      "The main validation surfaces are `package.json`, `README.md`, `app.js`, `app.test.js`, `index.js`, and `test-connection.js`.",
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
  await write("packages/valkey-proxy-server/app.js", "export const app = true;\n", rootDir);
  await write(
    "packages/valkey-proxy-server/app.test.js",
    "export const appTest = true;\n",
    rootDir
  );
  await write("packages/valkey-proxy-server/index.js", "export const proxy = true;\n", rootDir);
  await write(
    "packages/valkey-proxy-server/test-connection.js",
    "export const probe = true;\n",
    rootDir
  );
  await write(
    "packages/storefront-webapp/src/routes/shop/checkout/index.tsx",
    "export const checkoutRoute = true;\n",
    rootDir
  );
  await write(
    "packages/storefront-webapp/src/components/checkout/CheckoutProvider.tsx",
    "export const checkoutProvider = true;\n",
    rootDir
  );
  await write(
    "packages/storefront-webapp/src/routes/auth.verify.tsx",
    "export const authVerifyRoute = true;\n",
    rootDir
  );

  return rootDir;
}

function runGit(rootDir: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    env: buildGitProcessEnv(),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

function initializeGitHistory(rootDir: string) {
  runGit(rootDir, ["init"]);
  runGit(rootDir, ["config", "user.name", "Athena Harness Tests"]);
  runGit(rootDir, ["config", "user.email", "athena-harness-tests@example.com"]);
  runGit(rootDir, ["add", "."]);
  runGit(rootDir, ["commit", "-m", "Initial fixture"]);
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

  it("runs service-package validations for valkey proxy changes", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["packages/valkey-proxy-server/index.js"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      runRawCommand: async (command) => {
        steps.push(command);
      },
      runHarnessBehaviorScenario: async (scenario) => {
        steps.push(`behavior:${scenario}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "valkey-proxy-server:test",
      "node --check packages/valkey-proxy-server/app.js",
      "node --check packages/valkey-proxy-server/index.js",
      "behavior:valkey-proxy-local-request-response",
    ]);
  });

  it("runs service-package validations for valkey package metadata changes", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["packages/valkey-proxy-server/package.json"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      runRawCommand: async (command) => {
        steps.push(command);
      },
      runHarnessBehaviorScenario: async (scenario) => {
        steps.push(`behavior:${scenario}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "valkey-proxy-server:test",
      "node --check packages/valkey-proxy-server/app.js",
      "node --check packages/valkey-proxy-server/index.js",
      "behavior:valkey-proxy-local-request-response",
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
      "@athena/webapp:test",
      "@athena/storefront-webapp:test",
    ]);
  });

  it("runs repo-level harness validations for harness-owned script changes", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["scripts/harness-review.ts"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runRawCommand: async (command) => {
        steps.push(command);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "bun run harness:test",
      "bun run delivery:documentation-check",
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

  it("points stale generated validation-map paths back to the registry source", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/athena-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/webapp",
          packageDir: "packages/athena-webapp",
          surfaces: [
            {
              name: "removed-route",
              pathPrefixes: [
                "packages/athena-webapp/src/routes/removed-closeout.tsx",
              ],
              commands: [{ kind: "script", script: "test" }],
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
      "Stale harness review config: packages/athena-webapp/docs/agent/validation-map.json references missing path prefix \"packages/athena-webapp/src/routes/removed-closeout.tsx\". This path is generated from scripts/harness-app-registry.ts; update the registry validation scenario, then rerun `bun run harness:generate`."
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

  it("allows deleted unmapped files when the same package still has direct validation coverage", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];
    await write(
      "packages/storefront-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/storefront-webapp",
          packageDir: "packages/storefront-webapp",
          surfaces: [
            {
              name: "runtime-entry",
              pathPrefixes: ["packages/storefront-webapp/src/app.ts"],
              commands: [{ kind: "script", script: "test" }],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => [
        "packages/storefront-webapp/src/app.ts",
        "packages/storefront-webapp/src/client.tsx",
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

    expect(steps).toEqual(["harness:check", "@athena/storefront-webapp:test"]);
  });

  it("still fails when a deleted unmapped file is the only touched surface in a package", async () => {
    const rootDir = await createFixtureRepo();
    await write(
      "packages/storefront-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/storefront-webapp",
          packageDir: "packages/storefront-webapp",
          surfaces: [
            {
              name: "runtime-entry",
              pathPrefixes: ["packages/storefront-webapp/src/app.ts"],
              commands: [{ kind: "script", script: "test" }],
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
        getChangedFiles: async () => ["packages/storefront-webapp/src/client.tsx"],
        runHarnessCheck: async () => {},
        runPackageScript: async () => {},
        logger: {
          log() {},
          error() {},
        },
      })
    ).rejects.toThrow(
      "Harness review coverage gap: packages/storefront-webapp/src/client.tsx is not covered by any validation mapping."
    );
  });

  it("runs repo-level validations when only repo-owned files are touched", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["README.md"],
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
      "raw:bun run harness:test",
      "raw:bun run delivery:documentation-check",
    ]);
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
            "storybook:build": "echo storybook",
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
    ]);
  });


  it("runs mapped storefront behavior scenarios for checkout-critical surfaces", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await write(
      "packages/storefront-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/storefront-webapp",
          packageDir: "packages/storefront-webapp",
          surfaces: [
            {
              name: "checkout-or-auth-route-boundary-edits",
              pathPrefixes: [
                "packages/storefront-webapp/src/routes/shop/checkout",
                "packages/storefront-webapp/src/components/checkout",
                "packages/storefront-webapp/src/routes/auth.verify.tsx",
              ],
              commands: [{ kind: "script", script: "test" }],
              behaviorScenarios: ["storefront-checkout-bootstrap"],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => [
        "packages/storefront-webapp/src/routes/shop/checkout/index.tsx",
      ],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      runHarnessBehaviorScenario: async (scenario) => {
        steps.push(`behavior:${scenario}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "@athena/storefront-webapp:test",
      "behavior:storefront-checkout-bootstrap",
    ]);
  });

  it("runs mapped athena behavior scenarios for convex composition surfaces", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await write(
      "packages/athena-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/webapp",
          packageDir: "packages/athena-webapp",
          surfaces: [
            {
              name: "convex-or-backend-adjacent-edits",
              pathPrefixes: ["packages/athena-webapp/convex"],
              commands: [{ kind: "script", script: "test" }],
              behaviorScenarios: [
                "athena-convex-storefront-composition",
                "athena-convex-storefront-failure-visibility",
              ],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["packages/athena-webapp/convex/placeholder.ts"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      runHarnessBehaviorScenario: async (scenario) => {
        steps.push(`behavior:${scenario}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "@athena/webapp:test",
      "behavior:athena-convex-storefront-composition",
      "behavior:athena-convex-storefront-failure-visibility",
    ]);
  });

  it("dedupes behavior scenarios selected by multiple touched files", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

    await write(
      "packages/storefront-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/storefront-webapp",
          packageDir: "packages/storefront-webapp",
          surfaces: [
            {
              name: "checkout-route-edits",
              pathPrefixes: ["packages/storefront-webapp/src/routes/shop/checkout"],
              commands: [{ kind: "script", script: "test" }],
              behaviorScenarios: ["storefront-checkout-bootstrap"],
            },
            {
              name: "checkout-component-edits",
              pathPrefixes: ["packages/storefront-webapp/src/components/checkout"],
              commands: [{ kind: "script", script: "test" }],
              behaviorScenarios: ["storefront-checkout-bootstrap"],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );
    await write(
      "packages/storefront-webapp/src/components/checkout/CheckoutProvider.tsx",
      "export const provider = true;\n",
      rootDir
    );

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => [
        "packages/storefront-webapp/src/routes/shop/checkout/index.tsx",
        "packages/storefront-webapp/src/components/checkout/CheckoutProvider.tsx",
      ],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      runHarnessBehaviorScenario: async (scenario) => {
        steps.push(`behavior:${scenario}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "@athena/storefront-webapp:test",
      "behavior:storefront-checkout-bootstrap",
    ]);
  });

  it("does not run behavior scenarios for docs-only touched files", async () => {
    const rootDir = await createFixtureRepo();
    const steps: string[] = [];

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
      "packages/storefront-webapp/docs/agent/validation-map.json",
      JSON.stringify(
        {
          workspace: "@athena/storefront-webapp",
          packageDir: "packages/storefront-webapp",
          surfaces: [
            {
              name: "harness-docs",
              pathPrefixes: ["packages/storefront-webapp/docs/agent"],
              commands: [],
              behaviorScenarios: [],
            },
          ],
        },
        null,
        2
      ),
      rootDir
    );

    await runHarnessReview(rootDir, {
      getChangedFiles: async () => ["packages/storefront-webapp/docs/agent/testing.md"],
      runHarnessCheck: async () => {
        steps.push("harness:check");
      },
      runPackageScript: async (workspace, script) => {
        steps.push(`${workspace}:${script}`);
      },
      runRawCommand: async (command) => {
        steps.push(`raw:${command}`);
      },
      runHarnessBehaviorScenario: async (scenario) => {
        steps.push(`behavior:${scenario}`);
      },
      logger: {
        log() {},
        error() {},
      },
    });

    expect(steps).toEqual([
      "harness:check",
      "raw:bun run harness:test",
      "raw:bun run delivery:documentation-check",
    ]);
  });

  it("passes the requested base ref to the changed-file selector", async () => {
    const rootDir = await createFixtureRepo();
    const observedBaseRefs: Array<string | undefined> = [];
    const steps: string[] = [];

    await runHarnessReview(rootDir, {
      baseRef: "origin/main",
      getChangedFiles: async (_nextRootDir, baseRef) => {
        observedBaseRefs.push(baseRef);
        return ["packages/athena-webapp/src/app.ts"];
      },
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

    expect(observedBaseRefs).toEqual(["origin/main"]);
    expect(steps).toEqual([
      "harness:check",
      "@athena/webapp:test",
    ]);
  });
});



describe("parseHarnessReviewArgs", () => {
  it("accepts --base <ref>", () => {
    expect(parseHarnessReviewArgs(["--base", "origin/main"])).toEqual({
      baseRef: "origin/main",
    });
  });

  it("accepts --base=<ref>", () => {
    expect(parseHarnessReviewArgs(["--base=origin/main"])).toEqual({
      baseRef: "origin/main",
    });
  });




  it("rejects missing --base values", () => {
    expect(() => parseHarnessReviewArgs(["--base"])).toThrow(
      "Missing value for --base. Usage: bun run harness:review --base origin/main"
    );
  });



  it("rejects an unknown argument as a typed usage error", () => {
    // A malformed invocation is expected, not a crash: it must not reach the
    // boundary as harness_internal_error.
    expect(() =>
      parseHarnessReviewArgs(["--dry-run"])
    ).toThrow(HarnessUsageError);
  });
});

describe("resolveHarnessReviewShell", () => {
  it("prefers SHELL when it exists", () => {
    const shellPath = resolveHarnessReviewShell({
      env: {
        SHELL: "/custom/shell",
      },
      fileExists: (filePath) => filePath === "/custom/shell",
    });

    expect(shellPath).toBe("/custom/shell");
  });

  it("falls back to a known shell path when SHELL is missing", () => {
    const shellPath = resolveHarnessReviewShell({
      env: {
        SHELL: "/missing/shell",
      },
      fileExists: (filePath) => filePath === "/bin/bash",
    });

    expect(shellPath).toBe("/bin/bash");
  });
});

describe("getChangedFilesForHarnessReview", () => {
  it("combines base diff, tracked changes, and untracked files without duplicates", async () => {
    const rootDir = await createFixtureRepo();
    initializeGitHistory(rootDir);

    await write(
      "packages/athena-webapp/src/app.ts",
      "export const app = 'committed-change';\n",
      rootDir
    );
    runGit(rootDir, ["add", "packages/athena-webapp/src/app.ts"]);
    runGit(rootDir, ["commit", "-m", "Committed athena change"]);

    await write(
      "packages/athena-webapp/src/app.ts",
      "export const app = 'working-tree-change';\n",
      rootDir
    );
    await write(
      "packages/storefront-webapp/src/app.ts",
      "export const storefront = 'working-tree-change';\n",
      rootDir
    );
    await write(
      "packages/valkey-proxy-server/new-surface.js",
      "export const newSurface = true;\n",
      rootDir
    );

    await expect(
      getChangedFilesForHarnessReview(rootDir, "HEAD~1")
    ).resolves.toEqual([
      "packages/athena-webapp/src/app.ts",
      "packages/storefront-webapp/src/app.ts",
      "packages/valkey-proxy-server/new-surface.js",
    ]);
  });

  it("strips inherited git hook variables when spawning fixture repo commands", () => {
    const env = buildGitProcessEnv({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
      GIT_DIR: "/tmp/worktree-git-dir",
      GIT_WORK_TREE: "/tmp/worktree",
      GIT_INDEX_FILE: "/tmp/index",
    });

    expect(env).toEqual({
      PATH: "/usr/bin",
      HOME: "/tmp/home",
    });
  });

  it("fails clearly when the base ref is unreachable", async () => {
    const rootDir = await createFixtureRepo();
    initializeGitHistory(rootDir);

    await expect(
      getChangedFilesForHarnessReview(rootDir, "origin/does-not-exist")
    ).rejects.toThrow(
      "Base ref check failed for origin/does-not-exist"
    );
  });
});

describe("harnessReviewBlockedBlocker", () => {
  it("carries the review finding as sanitized detail under a stable code", () => {
    const blocker = harnessReviewBlockedBlocker(
      "Documentation waiver link missing for CONVEX_DEPLOY_KEY=super-secret",
    );

    expect(blocker.code).toBe("harness_review_blocked");
    expect(blocker.source).toEqual({ kind: "command", id: "harness:review" });
    expect(blocker.details).toContain("Documentation waiver link missing");
    // Sanitization is the constructor's job, so every blocker inherits it.
    expect(blocker.details).not.toContain("super-secret");
    expect(blocker.remediations.map((item) => item.id)).toEqual([
      "repair-harness-review-finding",
      "rerun-harness-review",
    ]);
  });
});

it.each(["--repo-validation-provided-by", "--validation-provided-by", "--provider-evidence"])("rejects retired evidence shortcut %s", flag => {
  expect(() => parseHarnessReviewArgs([flag, "claimed-parent-success"])).toThrow(HarnessUsageError);
});

it("runs every required Athena sensor once even without selected package files", async () => {
  const root = await createFixtureRepo();
  const steps: string[] = [];
  await runCompleteHarnessReview(root, {
    getChangedFiles: async () => [], runHarnessCheck: async () => {},
    runRawCommand: async command => { steps.push(command); },
    runPackageScript: async (workspace, script) => { steps.push(`${workspace}:${script}`); },
    logger: { log() {}, error() {} },
  });
  expect(steps).toEqual([...ATHENA_ALWAYS_VALIDATION_COMMANDS, ...ATHENA_FINAL_VALIDATION_COMMANDS].map(command => command.kind === "raw" ? command.command : `${command.workspace}:${command.script}`));
  expect(new Set(steps).size).toBe(13);
});

it("deduplicates required sensors also selected by repository validation", async () => {
  const root = await createFixtureRepo();
  const steps: string[] = [];
  await runCompleteHarnessReview(root, {
    getChangedFiles: async () => ["scripts/harness-review.ts"], runHarnessCheck: async () => {},
    runRawCommand: async command => { steps.push(command); },
    runPackageScript: async (workspace, script) => { steps.push(`${workspace}:${script}`); },
    logger: { log() {}, error() {} },
  });
  expect(steps.filter(command => command === "bun run workflow:check")).toHaveLength(1);
  expect(steps.filter(command => command === "bun run test:coverage")).toHaveLength(1);
  expect(steps).toContain("bun run harness:test");
});

it("retains preflight, inferential, graph and scorecard checks in the complete validation chain", async () => {
  const root = await createFixtureRepo(); const steps: string[] = [];
  await runCompleteHarnessReview(root, {
    getChangedFiles: async () => ["scripts/harness-review.ts"], runHarnessCheck: async () => { steps.push("harness:check"); },
    runRawCommand: async command => { steps.push(command); }, runPackageScript: async (workspace, script) => { steps.push(`${workspace}:${script}`); },
    logger: { log() {}, error() {} },
  });
  expect(steps[1]).toBe("bun run pr:athena:preflight");
  expect(steps.filter(command => command === "bun run harness:inferential-review")).toHaveLength(1);
  expect(steps).not.toContain("bun run harness:audit"); // Preflight includes the audit.
  expect(steps.slice(-3)).toEqual(["bun run harness:inferential-review", "bun run graphify:check", "bun run pr:athena:scorecard"]);
});

it("a preflight rejection stops expensive validation and scorecard generation", async () => {
  const root = await createFixtureRepo(); const steps: string[] = [];
  await expect(runCompleteHarnessReview(root, {
    getChangedFiles: async () => [], runHarnessCheck: async () => {},
    runRawCommand: async command => { steps.push(command); if (command === "bun run pr:athena:preflight") throw new Error("preflight refused"); },
    runPackageScript: async (workspace, script) => { steps.push(`${workspace}:${script}`); }, logger: { log() {}, error() {} },
  })).rejects.toThrow("preflight refused");
  expect(steps).toEqual(["bun run pr:athena:preflight"]);
});

describe("consolidated coverage resource diagnostics", () => {
  it.each(["1", "4", undefined])("times the sole hosted coverage execution and logs worker limit %s", async (workers) => {
    const calls: string[][] = []; const logs: string[] = [];
    await runRawCommand("/consumer", "bun run test:coverage", {
      platform: "linux", env: { GITHUB_ACTIONS: "true", ATHENA_COVERAGE_MAX_WORKERS: workers },
      logger: { log: message => logs.push(message) },
      spawn: (argv, options) => {
        calls.push(argv);
        expect(options).toEqual({ cwd: "/consumer", stdout: "inherit", stderr: "inherit" });
        return { exited: Promise.resolve(0) };
      },
    });
    expect(calls).toEqual([["/usr/bin/time", "-v", "bun", "run", "test:coverage"]]);
    expect(logs).toEqual([`Coverage worker limit: ${workers ?? "2"}`]);
  });

  it("preserves a failing timed coverage exit", async () => {
    await expect(runRawCommand("/consumer", "bun run test:coverage", {
      platform: "linux", env: { GITHUB_ACTIONS: "true" }, logger: { log() {} },
      spawn: () => ({ exited: Promise.resolve(17) }),
    })).rejects.toThrow("Command failed (17): bun run test:coverage");
  });

  it.each([
    { platform: "darwin" as const, env: { GITHUB_ACTIONS: "true" }, command: "bun run test:coverage" },
    { platform: "linux" as const, env: {}, command: "bun run test:coverage" },
    { platform: "linux" as const, env: { GITHUB_ACTIONS: "true" }, command: "bun run harness:test" },
  ])("leaves other execution unchanged: $platform $command $env", async ({ platform, env, command }) => {
    const calls: string[][] = []; const logs: string[] = [];
    await runRawCommand("/consumer", command, {
      platform, env, logger: { log: message => logs.push(message) },
      spawn: argv => { calls.push(argv); return { exited: Promise.resolve(0) }; },
    });
    expect(calls).toEqual([command === "bun run test:coverage" ? ["bun", "run", "test:coverage"] : [resolveHarnessReviewShell(), "-lc", command]]);
    expect(logs).toEqual([]);
  });
});

async function createCoverageFixture() {
  const root = await createFixtureRepo();
  const actualRoot = path.resolve(import.meta.dir, "..");
  const manifest = JSON.parse(await readFile(path.join(actualRoot, "package.json"), "utf8"));
  await write("package.json", JSON.stringify({ scripts: { "test:coverage": manifest.scripts["test:coverage"] } }), root);
  const app = JSON.parse(await readFile(path.join(root, "packages/athena-webapp/package.json"), "utf8"));
  app.scripts.test = "vitest run --maxWorkers=4";
  app.scripts["test:coverage"] = "vitest run --coverage --maxWorkers=${ATHENA_COVERAGE_MAX_WORKERS:-2}";
  await write("packages/athena-webapp/package.json", JSON.stringify(app), root);
  await write("packages/athena-webapp/vitest.config.ts", await readFile(path.join(actualRoot, "packages/athena-webapp/vitest.config.ts"), "utf8"), root);
  await write(".gitignore", "node_modules/\n.env*\n", root);
  await write("node_modules/vitest/package.json", '{"version":"4.1.11"}', root);
  initializeGitHistory(root);
  return root;
}

it("reuses successful aggregate coverage for the mapped full webapp suite in the same gate", async () => {
  const root = await createCoverageFixture();
  const steps: string[] = [];
  await runCompleteHarnessReview(root, {
    baseRef: "HEAD",
    getChangedFiles: async () => ["packages/athena-webapp/src/app.ts"],
    runHarnessCheck: async () => {},
    runRawCommand: async command => { steps.push(command); },
    runPackageScript: async (workspace, script) => { steps.push(`${workspace}:${script}`); },
    logger: { log() {}, error() {} },
  });
  expect(steps.filter(command => command === "bun run test:coverage")).toHaveLength(1);
  expect(steps.filter(command => command === "@athena/webapp:test")).toHaveLength(0);
});

describe("same-gate coverage invalidation", () => {
  async function exercise(root: string, duringCoverage?: () => Promise<void>) {
    const steps: string[] = [];
    const logs: string[] = [];
    await runCompleteHarnessReview(root, {
      baseRef: "HEAD", getChangedFiles: async () => ["packages/athena-webapp/src/app.ts"],
      runHarnessCheck: async () => {},
      runRawCommand: async command => { steps.push(command); if (command === "bun run test:coverage") await duringCoverage?.(); },
      runPackageScript: async (workspace, script) => { steps.push(`${workspace}:${script}`); },
      logger: { log: message => logs.push(message), error() {} },
    });
    return { steps, logs };
  }

  it.each(["source", "restored-source", "base", "config", "lockfile", "dependency", "environment"])("executes when %s changes during coverage", async kind => {
    const root = await createCoverageFixture();
    if (kind === "restored-source") {
      const timestamp = new Date("2020-01-01T00:00:00Z");
      await utimes(path.join(root, "packages/athena-webapp/src/app.ts"), timestamp, timestamp);
    }
    const result = await exercise(root, async () => {
      if (kind === "restored-source") {
        const file = "packages/athena-webapp/src/app.ts";
        const original = await readFile(path.join(root, file), "utf8");
        await write(file, "temporary source while coverage runs", root);
        await write(file, original, root);
        const timestamp = new Date("2020-01-01T00:00:00Z");
        await utimes(path.join(root, file), timestamp, timestamp);
      } else if (kind === "base") runGit(root, ["commit", "--allow-empty", "-m", "base moved"]);
      else if (kind === "config") await write("packages/athena-webapp/vitest.config.ts", "export default {};", root);
      else if (kind === "dependency") await write("node_modules/vitest/package.json", '{"version":"changed"}', root);
      else if (kind === "environment") await write(".env.local", "SENTINEL_SECRET=never-log-this-value", root);
      else {
        await write(kind === "source" ? "packages/athena-webapp/src/app.ts" : "bun.lockb", "changed", root);
        runGit(root, ["add", "."]);
      }
    });
    expect(result.steps).toContain("@athena/webapp:test");
    expect(result.logs.some(line => line.startsWith("Webapp test execute:"))).toBe(true);
    expect(result.logs.join("\n")).not.toContain("never-log-this-value");
  });

  it("executes with incomplete or customized coverage rather than inferring a full pass", async () => {
    const root = await createCoverageFixture();
    await write("package.json", JSON.stringify({ scripts: { "test:coverage": "vitest run --coverage src/one.test.ts" } }), root);
    runGit(root, ["add", "."]);
    const result = await exercise(root);
    expect(result.steps).toContain("@athena/webapp:test");
    expect(result.logs).toContain("Webapp test execute: unqualified-coverage-profile");
  });

  it("executes with a stable alternate Vitest config staged before coverage", async () => {
    const root = await createCoverageFixture();
    await write("packages/athena-webapp/vitest.config.ts", 'export default { test: { include: ["src/only.test.ts"] } };', root);
    runGit(root, ["add", "."]);
    const result = await exercise(root);
    expect(result.steps).toContain("@athena/webapp:test");
    expect(result.logs).toContain("Webapp test execute: unqualified-coverage-profile");
  });

  it("rejects dependency links outside the captured checkout", async () => {
    const root = await createCoverageFixture();
    const external = await mkdtemp(path.join(tmpdir(), "athena-external-dependency-"));
    tempRoots.push(external);
    await writeFile(path.join(external, "package.json"), '{"version":"4.1.11"}');
    await symlink(external, path.join(root, "node_modules", "external-package"));
    const result = await exercise(root);
    expect(result.steps).toContain("@athena/webapp:test");
    expect(result.logs).toContain("Webapp test execute: coverage-inputs-unavailable");
  });

  it("accepts an unchanged dependency link contained in the checkout", async () => {
    const root = await createCoverageFixture();
    await symlink("vitest", path.join(root, "node_modules", "contained-package"));
    const result = await exercise(root);
    expect(result.steps).not.toContain("@athena/webapp:test");
    expect(result.logs.some(line => line.startsWith("Webapp test reuse:"))).toBe(true);
  });

  it("rejects dependency mutation even after bytes and mtime are restored", async () => {
    const root = await createCoverageFixture();
    const dependency = path.join(root, "node_modules/vitest/package.json");
    const original = await readFile(dependency);
    const originalTime = new Date("2020-01-01T00:00:00Z");
    await utimes(dependency, originalTime, originalTime);
    const before = await lstat(dependency, { bigint: true });
    const result = await exercise(root, async () => {
      await writeFile(dependency, "temporary dependency during coverage");
      await writeFile(dependency, original);
      await utimes(dependency, originalTime, originalTime);
    });
    const after = await lstat(dependency, { bigint: true });
    expect(await readFile(dependency)).toEqual(original);
    expect(after.mtimeNs).toBe(before.mtimeNs);
    expect(after.ctimeNs).not.toBe(before.ctimeNs);
    expect(result.steps).toContain("@athena/webapp:test");
    expect(result.logs).toContain("Webapp test execute: source-base-toolchain-or-dependencies-changed");
  });

  it("rejects ignored environment-file changes even when values and mtime are restored", async () => {
    const root = await createCoverageFixture();
    const environmentFile = path.join(root, ".env.local");
    const original = "FEATURE_FLAG=original";
    const timestamp = new Date("2020-01-01T00:00:00Z");
    await writeFile(environmentFile, original);
    await utimes(environmentFile, timestamp, timestamp);
    const result = await exercise(root, async () => {
      await writeFile(environmentFile, "FEATURE_FLAG=temporary");
      await writeFile(environmentFile, original);
      await utimes(environmentFile, timestamp, timestamp);
    });
    expect(result.steps).toContain("@athena/webapp:test");
    expect(result.logs).toContain("Webapp test execute: execution-environment-changed");
    expect(result.logs.join("\n")).not.toContain("FEATURE_FLAG");
  });

  it.each(["pretest", "posttest"])("does not skip a stable %s lifecycle obligation", async hook => {
    const root = await createCoverageFixture();
    const appPath = "packages/athena-webapp/package.json";
    const app = JSON.parse(await readFile(path.join(root, appPath), "utf8"));
    app.scripts[hook] = "echo additional ordinary-suite obligation";
    await write(appPath, JSON.stringify(app), root);
    runGit(root, ["add", "."]);
    const result = await exercise(root);
    expect(result.steps).toContain("@athena/webapp:test");
    expect(result.logs).toContain("Webapp test execute: unqualified-coverage-profile");
  });

  it("does not reuse a pass from a previous runner invocation", async () => {
    const root = await createCoverageFixture();
    const first = await exercise(root);
    const second = await exercise(root);
    expect(first.steps.filter(step => step === "bun run test:coverage")).toHaveLength(1);
    expect(second.steps.filter(step => step === "bun run test:coverage")).toHaveLength(1);
    expect(second.logs.some(line => line.startsWith("Webapp test reuse:"))).toBe(true);
  });

  it("stops on failed aggregate coverage without running or claiming the mapped suite", async () => {
    const root = await createCoverageFixture();
    await expect(exercise(root, async () => { throw new Error("coverage failed"); })).rejects.toThrow("coverage failed");
  });

  it("keeps focused and timer-stress commands separate", async () => {
    const root = await createCoverageFixture();
    const mapPath = "packages/athena-webapp/docs/agent/validation-map.json";
    const map = JSON.parse(await readFile(path.join(root, mapPath), "utf8"));
    const focused = "bun run --filter '@athena/webapp' test -- outside-coverage/example.test.ts";
    map.surfaces[0].commands.push({ kind: "raw", command: focused });
    const app = JSON.parse(await readFile(path.join(root, "packages/athena-webapp/package.json"), "utf8"));
    app.scripts["test:timing-parity"] = "vitest run --maxWorkers=2";
    map.surfaces[0].commands.push({ kind: "script", script: "test:timing-parity" });
    await write("packages/athena-webapp/package.json", JSON.stringify(app), root);
    await write(mapPath, JSON.stringify(map), root);
    runGit(root, ["add", "."]);
    const result = await exercise(root);
    expect(result.steps).not.toContain("@athena/webapp:test");
    expect(result.steps).toContain(focused);
    expect(result.steps).toContain("@athena/webapp:test:timing-parity");
  });
});

it("runs aggregate child processes once and reuses their mapped webapp class", async () => {
  const root = await createCoverageFixture();
  const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
  manifest.workspaces = ["packages/*"];
  manifest.scripts["test:coverage:scripts"] = "bun scripts/root-suite.ts";
  await write("package.json", JSON.stringify(manifest), root);
  const storefront = JSON.parse(await readFile(path.join(root, "packages/storefront-webapp/package.json"), "utf8"));
  storefront.scripts["test:coverage"] = "bun ../../scripts/storefront-suite.ts";
  await write("packages/storefront-webapp/package.json", JSON.stringify(storefront), root);
  await write("scripts/coverage-toolchain-parity.ts", 'if (!Bun.argv.includes("--repair")) throw new Error("missing repair");', root);
  for (const suite of ["root", "storefront"]) {
    await write(`scripts/${suite}-suite.ts`, `import {appendFileSync} from "node:fs"; appendFileSync(${JSON.stringify(path.join(root, "coverage-counts.log"))}, ${JSON.stringify(`${suite}\n`)});`, root);
  }
  await write("scripts/coverage-summary.ts", 'export {};', root);
  await write("node_modules/.bin/vitest", `#!/usr/bin/env bun
import {appendFileSync} from "node:fs";
appendFileSync(${JSON.stringify(path.join(root, "coverage-counts.log"))}, Bun.argv.includes("--coverage") ? "webapp\\n" : "duplicate-webapp\\n");
`, root);
  await chmod(path.join(root, "node_modules/.bin/vitest"), 0o755);
  await write(".gitignore", "node_modules/\n.env*\ncoverage-counts.log\n", root);
  runGit(root, ["add", "."]);
  const logs: string[] = [];
  await runCompleteHarnessReview(root, {
    baseRef: "HEAD", getChangedFiles: async () => ["packages/athena-webapp/src/app.ts"],
    runHarnessCheck: async () => {},
    runRawCommand: async command => { if (command === "bun run test:coverage") await runRawCommand(root, command); },
    runPackageScript: async (workspace, script) => {
      if (script !== "test") return;
      const result = spawnSync("bun", ["run", "--filter", workspace, script], { cwd: root, encoding: "utf8" });
      expect(result.status).toBe(0);
    },
    logger: { log: message => logs.push(message), error() {} },
  });
  expect((await readFile(path.join(root, "coverage-counts.log"), "utf8")).trim().split("\n").sort()).toEqual(["root", "storefront", "webapp"]);
  expect(logs.some(line => line.startsWith("Webapp test reuse:"))).toBe(true);
});

it("rechecks the binding after intervening mapped validation", async () => {
  const root = await createCoverageFixture();
  const mapPath = "packages/athena-webapp/docs/agent/validation-map.json";
  const map = JSON.parse(await readFile(path.join(root, mapPath), "utf8"));
  map.surfaces[0].commands.unshift({ kind: "raw", command: "fixture-mutate-source" });
  await write(mapPath, JSON.stringify(map), root);
  runGit(root, ["add", "."]);
  const scripts: string[] = [];
  const logs: string[] = [];
  await runCompleteHarnessReview(root, {
    baseRef: "HEAD", getChangedFiles: async () => ["packages/athena-webapp/src/app.ts"],
    runHarnessCheck: async () => {},
    runRawCommand: async command => {
      if (command === "fixture-mutate-source") {
        await write("packages/athena-webapp/src/app.ts", "changed after coverage", root);
        runGit(root, ["add", "."]);
      }
    },
    runPackageScript: async (_workspace, script) => { scripts.push(script); },
    logger: { log: message => logs.push(message), error() {} },
  });
  expect(scripts).toContain("test");
  expect(logs).toContain("Webapp test execute: source-base-toolchain-or-dependencies-changed");
});
