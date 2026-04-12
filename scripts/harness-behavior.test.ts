import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HarnessBehaviorPhaseError,
  parseHarnessBehaviorArgs,
  runHarnessBehaviorScenario,
} from "./harness-behavior";

const tempRoots: string[] = [];

async function write(relativePath: string, contents: string, rootDir: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot(prefix: string) {
  const rootDir = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(rootDir);
  return rootDir;
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("runHarnessBehaviorScenario", () => {
  it("runs boot/readiness/browser/runtime/assertion/cleanup and captures runtime signals", async () => {
    const rootDir = await createFixtureRoot("athena-harness-behavior-ok-");
    const stopFile = path.join(rootDir, "stop.log");
    const appScriptPath = path.join(rootDir, "fixtures", "runtime-app.ts");

    await write(
      "fixtures/runtime-app.ts",
      [
        'console.log("APP_READY");',
        'console.log("RUNTIME_SIGNAL:booted");',
        "const stopFile = process.env.STOP_FILE;",
        "setInterval(() => {",
        '  console.log("RUNTIME_SIGNAL:heartbeat");',
        "}, 20);",
        "process.on(\"SIGTERM\", async () => {",
        "  if (stopFile) {",
        '    await Bun.write(stopFile, "stopped");',
        "  }",
        "  process.exit(0);",
        "});",
      ].join("\n"),
      rootDir
    );

    const executionOrder: string[] = [];
    const logs: string[] = [];

    await runHarnessBehaviorScenario(
      rootDir,
      {
        name: "unit-happy-path",
        processes: [
          {
            id: "runtime-app",
            command: `bun ${appScriptPath}`,
            env: {
              STOP_FILE: stopFile,
            },
            readyPattern: "APP_READY",
            readyTimeoutMs: 2_000,
          },
        ],
        readiness: [
          {
            name: "custom-ready-check",
            kind: "custom",
            check: async () => {
              executionOrder.push("readiness");
            },
          },
        ],
        browser: async () => {
          executionOrder.push("browser");
          return {
            clicked: true,
          };
        },
        runtimeSignals: [
          {
            name: "heartbeat-signal",
            processId: "runtime-app",
            source: "stdout",
            pattern: "RUNTIME_SIGNAL:booted",
            minMatches: 1,
          },
        ],
        assert: async ({ browserResult, runtimeSignals }) => {
          executionOrder.push("assertion");
          expect(browserResult).toEqual({ clicked: true });
          expect(runtimeSignals["heartbeat-signal"]?.matchCount ?? 0).toBeGreaterThan(0);
        },
        cleanup: async () => {
          executionOrder.push("cleanup");
        },
      },
      {
        logger: {
          log(message) {
            logs.push(String(message));
          },
          error(message) {
            logs.push(String(message));
          },
        },
      }
    );

    expect(executionOrder).toEqual([
      "readiness",
      "browser",
      "assertion",
      "cleanup",
    ]);
    expect(logs.some((line) => line.includes("[boot]"))).toBe(true);
    expect(logs.some((line) => line.includes("[readiness]"))).toBe(true);
    expect(logs.some((line) => line.includes("[browser]"))).toBe(true);
    expect(logs.some((line) => line.includes("[runtime]"))).toBe(true);
    expect(logs.some((line) => line.includes("[assertion]"))).toBe(true);
    expect(await readFile(stopFile, "utf8")).toBe("stopped");
  });

  it("fails in readiness phase and still performs cleanup", async () => {
    const rootDir = await createFixtureRoot("athena-harness-behavior-ready-fail-");
    const stopFile = path.join(rootDir, "stop.log");
    const appScriptPath = path.join(rootDir, "fixtures", "runtime-app.ts");

    await write(
      "fixtures/runtime-app.ts",
      [
        'console.log("APP_READY");',
        "const stopFile = process.env.STOP_FILE;",
        "setInterval(() => {}, 50);",
        "process.on(\"SIGTERM\", async () => {",
        "  if (stopFile) {",
        '    await Bun.write(stopFile, "stopped");',
        "  }",
        "  process.exit(0);",
        "});",
      ].join("\n"),
      rootDir
    );

    let cleanupCalled = false;

    await expect(
      runHarnessBehaviorScenario(rootDir, {
        name: "unit-readiness-failure",
        processes: [
          {
            id: "runtime-app",
            command: `bun ${appScriptPath}`,
            env: {
              STOP_FILE: stopFile,
            },
            readyPattern: "APP_READY",
            readyTimeoutMs: 2_000,
          },
        ],
        readiness: [
          {
            name: "failing-ready-check",
            kind: "custom",
            check: async () => {
              throw new Error("readiness exploded");
            },
          },
        ],
        browser: async () => ({}),
        assert: async () => {},
        cleanup: async () => {
          cleanupCalled = true;
        },
      })
    ).rejects.toMatchObject({
      phase: "readiness",
    } satisfies Partial<HarnessBehaviorPhaseError>);

    expect(cleanupCalled).toBe(true);
    expect(await readFile(stopFile, "utf8")).toBe("stopped");
  });

  it("fails in assertion phase and still terminates spawned processes", async () => {
    const rootDir = await createFixtureRoot("athena-harness-behavior-assert-fail-");
    const stopFile = path.join(rootDir, "stop.log");
    const appScriptPath = path.join(rootDir, "fixtures", "runtime-app.ts");

    await write(
      "fixtures/runtime-app.ts",
      [
        'console.log("APP_READY");',
        "const stopFile = process.env.STOP_FILE;",
        "setInterval(() => {}, 50);",
        "process.on(\"SIGTERM\", async () => {",
        "  if (stopFile) {",
        '    await Bun.write(stopFile, "stopped");',
        "  }",
        "  process.exit(0);",
        "});",
      ].join("\n"),
      rootDir
    );

    await expect(
      runHarnessBehaviorScenario(rootDir, {
        name: "unit-assertion-failure",
        processes: [
          {
            id: "runtime-app",
            command: `bun ${appScriptPath}`,
            env: {
              STOP_FILE: stopFile,
            },
            readyPattern: "APP_READY",
            readyTimeoutMs: 2_000,
          },
        ],
        readiness: [
          {
            name: "pass-ready",
            kind: "custom",
            check: async () => {},
          },
        ],
        browser: async () => ({ ok: false }),
        assert: async () => {
          throw new Error("assertion failed");
        },
      })
    ).rejects.toMatchObject({
      phase: "assertion",
    } satisfies Partial<HarnessBehaviorPhaseError>);

    expect(await readFile(stopFile, "utf8")).toBe("stopped");
  });
});

describe("parseHarnessBehaviorArgs", () => {
  it("parses --scenario <name>", () => {
    expect(parseHarnessBehaviorArgs(["--scenario", "sample-runtime-smoke"])).toEqual({
      help: false,
      list: false,
      scenarioName: "sample-runtime-smoke",
    });
  });

  it("parses --list", () => {
    expect(parseHarnessBehaviorArgs(["--list"])).toEqual({
      help: false,
      list: true,
      scenarioName: null,
    });
  });

  it("throws when --scenario is provided without a value", () => {
    expect(() => parseHarnessBehaviorArgs(["--scenario"])).toThrow(
      "Missing scenario name after --scenario."
    );
  });
});
