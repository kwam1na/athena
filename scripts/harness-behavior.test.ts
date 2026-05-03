import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HarnessBehaviorPhaseError,
  parseHarnessBehaviorArgs,
  resolveHarnessBehaviorShell,
  runHarnessBehaviorScenario,
  runPlaywrightFlow,
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

const missingChromiumError = [
  "browserType.launch: Executable doesn't exist at /Users/example/Library/Caches/ms-playwright/chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell",
  "Looks like Playwright was just installed or updated.",
  "Please run the following command to download new browsers:",
  "",
  "    npx playwright install",
].join("\n");

function createPlaywrightModule(launch: () => Promise<unknown>) {
  return {
    chromium: {
      launch,
    },
  };
}

function createBrowser(overrides: Record<string, unknown> = {}) {
  const page = {
    goto: async () => {},
    on: () => {},
    getByRole: () => ({
      click: async () => {},
    }),
    waitForSelector: async () => {},
    textContent: async () => null,
    waitForResponse: async () => {},
    video: () => null,
    ...overrides,
  };

  return {
    newContext: async () => ({
      close: async () => {},
      newPage: async () => page,
    }),
    close: async () => {},
  };
}

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

    const report = await runHarnessBehaviorScenario(
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
          {
            name: "heartbeat-ready-check",
            kind: "log",
            processId: "runtime-app",
            source: "stdout",
            pattern: "RUNTIME_SIGNAL:heartbeat",
            timeoutMs: 2_000,
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
            pattern: "RUNTIME_SIGNAL:heartbeat",
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
    expect(logs.some((line) => line.includes("[harness:behavior:report]"))).toBe(
      true
    );
    expect(report.status).toBe("passed");
    expect(report.diagnostics).toEqual([]);
    expect(report.runtimeSignals).toEqual([
      expect.objectContaining({
        name: "heartbeat-signal",
        minMatches: 1,
        maxMatches: null,
      }),
    ]);
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

  it("fails deterministically when runtime signal max threshold is breached", async () => {
    const rootDir = await createFixtureRoot("athena-harness-runtime-threshold-");
    const stopFile = path.join(rootDir, "stop.log");
    const appScriptPath = path.join(rootDir, "fixtures", "runtime-app.ts");

    await write(
      "fixtures/runtime-app.ts",
      [
        'console.log("APP_READY");',
        'console.error("RUNTIME_ERROR:boom");',
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

    let thrown: HarnessBehaviorPhaseError | null = null;

    await expect(
      runHarnessBehaviorScenario(rootDir, {
        name: "unit-runtime-threshold-failure",
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
            name: "runtime-error-observed",
            kind: "log",
            processId: "runtime-app",
            source: "combined",
            pattern: "RUNTIME_ERROR:",
            timeoutMs: 2_000,
          },
        ],
        browser: async () => ({ ok: true }),
        runtimeSignals: [
          {
            name: "runtime-error-signal",
            processId: "runtime-app",
            source: "combined",
            pattern: "RUNTIME_ERROR:",
            minMatches: 0,
            maxMatches: 0,
          },
        ],
        assert: async () => {},
      }).catch((error: unknown) => {
        thrown = error as HarnessBehaviorPhaseError;
        throw error;
      })
    ).rejects.toMatchObject({
      phase: "assertion",
    } satisfies Partial<HarnessBehaviorPhaseError>);

    expect(thrown?.report?.status).toBe("failed");
    expect(thrown?.report?.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "runtime-signal-above-maximum",
          signalName: "runtime-error-signal",
        }),
      ])
    );
    expect(await readFile(stopFile, "utf8")).toBe("stopped");
  });

  it("fails deterministically when latency thresholds are exceeded", async () => {
    await expect(
      runHarnessBehaviorScenario("/tmp", {
        name: "unit-latency-threshold-failure",
        processes: [],
        readiness: [],
        browser: async () => {
          await new Promise<void>((resolve) => {
            setTimeout(resolve, 25);
          });
          return { ok: true };
        },
        runtimeSignals: [],
        thresholds: {
          latency: {
            maxTotalDurationMs: 10,
            maxPhaseDurationMs: {
              browser: 10,
            },
          },
        },
        assert: async () => {},
      })
    ).rejects.toMatchObject({
      phase: "assertion",
      report: {
        status: "failed",
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            type: "latency-total-threshold-breached",
          }),
          expect.objectContaining({
            type: "latency-phase-threshold-breached",
            phase: "browser",
          }),
        ]),
      },
    });
  });
});

describe("runPlaywrightFlow", () => {
  it("installs Chromium once and retries when local Playwright browser binaries are missing", async () => {
    let launchCount = 0;
    let installCount = 0;
    const browser = createBrowser();

    const result = await runPlaywrightFlow({
      url: "http://127.0.0.1:4173",
      playwrightModule: createPlaywrightModule(async () => {
        launchCount += 1;
        if (launchCount === 1) {
          throw new Error(missingChromiumError);
        }
        return browser;
      }),
      env: {},
      installChromium: async () => {
        installCount += 1;
      },
      steps: async () => ({ loaded: true }),
    });

    expect(result.stepResult).toEqual({ loaded: true });
    expect(launchCount).toBe(2);
    expect(installCount).toBe(1);
  });

  it("runs page setup before navigation so scenarios can capture first-load network requests", async () => {
    const events: string[] = [];
    const browser = createBrowser({
      on: (event: string) => {
        events.push(`on:${event}`);
      },
      goto: async () => {
        events.push("goto");
      },
    });

    await runPlaywrightFlow({
      url: "http://127.0.0.1:4173",
      playwrightModule: createPlaywrightModule(async () => browser),
      setupPage: async ({ page }) => {
        page.on("request", () => {});
        page.on("pageerror", () => {});
        events.push("setup");
      },
      steps: async () => {
        events.push("steps");
        return { loaded: true };
      },
    });

    expect(events).toEqual([
      "on:console",
      "on:request",
      "on:pageerror",
      "setup",
      "goto",
      "steps",
    ]);
  });

  it("does not auto-install missing Chromium in CI", async () => {
    let installCount = 0;

    await expect(
      runPlaywrightFlow({
        url: "http://127.0.0.1:4173",
        playwrightModule: createPlaywrightModule(async () => {
          throw new Error(missingChromiumError);
        }),
        env: { CI: "true" },
        installChromium: async () => {
          installCount += 1;
        },
        steps: async () => ({}),
      })
    ).rejects.toThrow("Run `bunx playwright install chromium` and rerun the blocked validation.");

    expect(installCount).toBe(0);
  });

  it("still fails genuine browser launch failures after Chromium install", async () => {
    let launchCount = 0;
    const launchFailure = new Error("browser process crashed after launch");

    await expect(
      runPlaywrightFlow({
        url: "http://127.0.0.1:4173",
        playwrightModule: createPlaywrightModule(async () => {
          launchCount += 1;
          if (launchCount === 1) {
            throw new Error(missingChromiumError);
          }
          throw launchFailure;
        }),
        env: {},
        installChromium: async () => {},
        steps: async () => ({}),
      })
    ).rejects.toThrow("browser process crashed after launch");

    expect(launchCount).toBe(2);
  });
});

describe("parseHarnessBehaviorArgs", () => {
  it("parses --scenario <name>", () => {
    expect(parseHarnessBehaviorArgs(["--scenario", "sample-runtime-smoke"])).toEqual({
      help: false,
      list: false,
      recordVideo: false,
      scenarioName: "sample-runtime-smoke",
    });
  });

  it("parses --list", () => {
    expect(parseHarnessBehaviorArgs(["--list"])).toEqual({
      help: false,
      list: true,
      recordVideo: false,
      scenarioName: null,
    });
  });

  it("parses --record-video with --scenario", () => {
    expect(
      parseHarnessBehaviorArgs([
        "--scenario",
        "athena-admin-shell-boot",
        "--record-video",
      ])
    ).toEqual({
      help: false,
      list: false,
      recordVideo: true,
      scenarioName: "athena-admin-shell-boot",
    });
  });

  it("parses --record-video=false", () => {
    expect(
      parseHarnessBehaviorArgs([
        "--scenario",
        "athena-admin-shell-boot",
        "--record-video=false",
      ])
    ).toEqual({
      help: false,
      list: false,
      recordVideo: false,
      scenarioName: "athena-admin-shell-boot",
    });
  });

  it("throws when --scenario is provided without a value", () => {
    expect(() => parseHarnessBehaviorArgs(["--scenario"])).toThrow(
      "Missing scenario name after --scenario."
    );
  });

  it("throws when --record-video has an invalid value", () => {
    expect(() =>
      parseHarnessBehaviorArgs([
        "--scenario",
        "athena-admin-shell-boot",
        "--record-video=maybe",
      ])
    ).toThrow("Invalid value for --record-video");
  });
});

describe("resolveHarnessBehaviorShell", () => {
  it("prefers HARNESS_BEHAVIOR_SHELL when available", () => {
    const shellPath = resolveHarnessBehaviorShell({
      env: {
        HARNESS_BEHAVIOR_SHELL: "/custom/shell",
        SHELL: "/env/shell",
      },
      fileExists: (filePath) => filePath === "/custom/shell",
    });

    expect(shellPath).toBe("/custom/shell");
  });

  it("falls back to a known shell path when preferred shells are missing", () => {
    const shellPath = resolveHarnessBehaviorShell({
      env: {
        HARNESS_BEHAVIOR_SHELL: "/missing/custom",
        SHELL: "/missing/env",
      },
      fileExists: (filePath) => filePath === "/bin/bash",
    });

    expect(shellPath).toBe("/bin/bash");
  });
});
