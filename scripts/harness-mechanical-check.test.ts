import { describe, expect, it, vi } from "vitest";

// CLI boundary coverage is centralized in harness-blocker-inventory.test.ts.
import {
  MECHANICAL_PACKAGE_SCRIPTS,
  isMechanicalRawCommand,
  runHarnessMechanicalCheck,
  selectMechanicalCommands,
} from "./harness-mechanical-check";

const CONVEX_FILE =
  "packages/athena-webapp/convex/inventory/stockTransfers.ts";
const ROUTE_FILE = "packages/athena-webapp/src/routes/demo.tsx";
const REPORT_FILE = "docs/reports/2026/athena-weekly-close.html";

function packageScripts() {
  return {
    "packages/athena-webapp": {
      name: "@athena/webapp",
      scripts: Object.fromEntries(
        MECHANICAL_PACKAGE_SCRIPTS.map((script) => [script, "echo ok"]),
      ),
    },
  };
}

function options(overrides: Record<string, unknown> = {}) {
  const runPackageScript = vi.fn(async () => 0);
  const runRawCommand = vi.fn(async () => 0);
  return {
    getChangedFiles: async () => [CONVEX_FILE],
    runRawCommand,
    readPackageManifest: async (packageDir: string) =>
      packageScripts()[packageDir as keyof ReturnType<typeof packageScripts>] ??
      null,
    runPackageScript,
    logger: { log: vi.fn(), error: vi.fn() },
    ...overrides,
    _spies: { runPackageScript, runRawCommand },
  };
}

describe("mechanical raw command policy", () => {
  it.each([
    "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
    "bunx tsc --noEmit -p packages/storefront-webapp/tsconfig.json",
  ])("treats project typecheck %s as mechanical", (command) => {
    expect(isMechanicalRawCommand(command)).toBe(true);
  });

  it.each([
    "bun run --filter '@athena/webapp' test -- convex/reports",
    "bun run --filter '@athena/webapp' build",
    "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json && rm -rf /",
    "bunx tsc -p packages/athena-webapp/tsconfig.json",
  ])("does not treat %s as mechanical", (command) => {
    expect(isMechanicalRawCommand(command)).toBe(false);
  });
});

describe("mechanical command selection", () => {
  it("selects deterministic package scripts and project typecheck for changed files", () => {
    const selected = selectMechanicalCommands([ROUTE_FILE]);

    expect(selected.length).toBeGreaterThan(0);
    const scripts = selected.flatMap((command) =>
      command.kind === "script" ? [command.script] : [],
    );
    const raws = selected.flatMap((command) =>
      command.kind === "raw" ? [command.command] : [],
    );

    expect(scripts).toContain("lint:convex:changed");
    // The ticket names typecheck alongside lint and format as the deterministic
    // class that must be discoverable before review evidence is recorded.
    expect(raws).toContain(
      "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
    );
    for (const command of selected) {
      if (command.kind === "script") {
        expect(MECHANICAL_PACKAGE_SCRIPTS).toContain(command.script);
        expect(command.packageDir).toBe("packages/athena-webapp");
      } else {
        expect(isMechanicalRawCommand(command.command)).toBe(true);
      }
    }
  });

  it("selects the project typecheck for any changed file in the package", () => {
    // tsc -p is project-wide, so a file whose validation scenario does not list
    // the typecheck command can still break it.
    const scenarioWithoutTypecheck = selectMechanicalCommands([CONVEX_FILE]);
    const fileWhoseScenariosOmitTypecheck = selectMechanicalCommands([
      "packages/athena-webapp/src/routes/v261209ScenarioWithoutTypecheck.tsx",
    ]);

    for (const selected of [
      scenarioWithoutTypecheck,
      fileWhoseScenariosOmitTypecheck,
    ]) {
      expect(
        selected.flatMap((command) =>
          command.kind === "raw" ? [command.command] : [],
        ),
      ).toContain("bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json");
    }
  });

  it("selects the typecheck for a non-source change inside the package", () => {
    // tsc -p is project-wide, so package scoping deliberately does not filter
    // by extension. Pinned so a future narrowing is a visible decision.
    const selected = selectMechanicalCommands([
      "packages/athena-webapp/docs/agent/index.md",
    ]);

    expect(
      selected.flatMap((command) =>
        command.kind === "raw" ? [command.command] : [],
      ),
    ).toContain("bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json");
  });

  it("normalizes a leading ./ so the same change selects the same commands", () => {
    expect(
      selectMechanicalCommands(["packages/athena-webapp/src/routes/demo.tsx"]),
    ).toEqual(
      selectMechanicalCommands(["./packages/athena-webapp/src/routes/demo.tsx"]),
    );
  });

  it("selects no typecheck when the package was not touched", () => {
    const selected = selectMechanicalCommands([
      "packages/storefront-webapp/src/App.tsx",
    ]);

    expect(
      selected.flatMap((command) =>
        command.kind === "raw" ? [command.command] : [],
      ),
    ).not.toContain(
      "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
    );
  });

  it("never selects a test or build command", () => {
    const selected = selectMechanicalCommands([
      CONVEX_FILE,
      "packages/storefront-webapp/src/App.tsx",
    ]);

    for (const command of selected) {
      const text =
        command.kind === "script" ? command.script : command.command;
      expect(text).not.toMatch(/(^|\s)(test|build)(\s|$)/);
    }
  });

  it("never selects a command more than once", () => {
    const selected = selectMechanicalCommands([
      CONVEX_FILE,
      "packages/athena-webapp/convex/inventory/stockLedger.ts",
    ]);
    const keys = selected.map((command) =>
      command.kind === "script"
        ? `${command.packageDir}:${command.script}`
        : `raw:${command.command}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("selects nothing for review-neutral delivery narration", () => {
    expect(selectMechanicalCommands([REPORT_FILE])).toEqual([]);
  });
});

describe("harness mechanical check", () => {
  it("passes and reports the commands it ran", async () => {
    const setup = options({ getChangedFiles: async () => [ROUTE_FILE] });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result.status).toBe("pass");
    expect(result.ranCommands).toContain("@athena/webapp:lint:frontend:changed");
    expect(result.ranCommands).toContain(
      "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
    );
    expect(setup._spies.runPackageScript).toHaveBeenCalled();
    expect(setup._spies.runRawCommand).toHaveBeenCalled();
  });

  it("fails with the exact failing command when typecheck breaks", async () => {
    const runRawCommand = vi.fn(async () => 2);
    const setup = options({
      getChangedFiles: async () => [ROUTE_FILE],
      runRawCommand,
    });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result.status).toBe("fail");
    expect(result.failures).toContainEqual(
      expect.objectContaining({
        command: "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
        exitCode: 2,
      }),
    );
  });

  it("fails with the exact failing command when a mechanical rule is violated", async () => {
    const setup = options({
      runPackageScript: vi.fn(async (_root, _workspace, script) =>
        script === "lint:convex:changed" ? 1 : 0,
      ),
    });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result.status).toBe("fail");
    expect(result.failures).toEqual([
      expect.objectContaining({
        command: "@athena/webapp:lint:convex:changed",
        exitCode: 1,
      }),
    ]);
  });

  it("runs every selected command so one run reports every mechanical failure", async () => {
    const runPackageScript = vi.fn(async () => 1);
    const runRawCommand = vi.fn(async () => 1);
    const setup = options({ runPackageScript, runRawCommand });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);
    const selected = selectMechanicalCommands([CONVEX_FILE]);
    const scriptCount = selected.filter(
      (command) => command.kind === "script",
    ).length;
    const rawCount = selected.length - scriptCount;

    expect(result.failures).toHaveLength(selected.length);
    expect(runPackageScript).toHaveBeenCalledTimes(scriptCount);
    expect(runRawCommand).toHaveBeenCalledTimes(rawCount);
  });

  it("skips a selected script the package does not define", async () => {
    // ROUTE_FILE selects three scripts; the manifest defines one, so the other
    // two must be reported as skipped rather than run or failed.
    const runPackageScript = vi.fn(async () => 0);
    const setup = options({
      getChangedFiles: async () => [ROUTE_FILE],
      runPackageScript,
      readPackageManifest: async () => ({
        name: "@athena/webapp",
        scripts: { "lint:frontend:changed": "echo ok" },
      }),
    });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result.status).toBe("pass");
    expect(result.ranCommands).toContain("@athena/webapp:lint:frontend:changed");
    expect(result.skippedCommands).toEqual(
      expect.arrayContaining([
        "@athena/webapp:lint:architecture",
        "@athena/webapp:lint:convex:changed",
      ]),
    );
    expect(runPackageScript).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a selected package manifest cannot be read", async () => {
    const setup = options({ readPackageManifest: async () => null });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result.status).toBe("fail");
    expect(result.failures[0].command).toContain("packages/athena-webapp");
  });

  it("passes without running anything when no mechanical surface changed", async () => {
    const setup = options({ getChangedFiles: async () => [REPORT_FILE] });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result).toMatchObject({ status: "pass", ranCommands: [] });
    expect(setup._spies.runPackageScript).not.toHaveBeenCalled();
  });
});
