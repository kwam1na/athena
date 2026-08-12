import { describe, expect, it, vi } from "vitest";

import {
  MECHANICAL_PACKAGE_SCRIPTS,
  runHarnessMechanicalCheck,
  selectMechanicalCommands,
} from "./harness-mechanical-check";

const CONVEX_FILE =
  "packages/athena-webapp/convex/inventory/stockTransfers.ts";
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
  return {
    getChangedFiles: async () => [CONVEX_FILE],
    readPackageManifest: async (packageDir: string) =>
      packageScripts()[packageDir as keyof ReturnType<typeof packageScripts>] ??
      null,
    runPackageScript,
    logger: { log: vi.fn(), error: vi.fn() },
    ...overrides,
    _spies: { runPackageScript },
  };
}

describe("mechanical command selection", () => {
  it("selects only deterministic package scripts for changed files", () => {
    const selected = selectMechanicalCommands([CONVEX_FILE]);

    expect(selected.length).toBeGreaterThan(0);
    expect(selected.map((command) => command.script)).toContain(
      "lint:convex:changed",
    );
    for (const command of selected) {
      expect(MECHANICAL_PACKAGE_SCRIPTS).toContain(command.script);
      expect(command.packageDir).toBe("packages/athena-webapp");
    }
  });

  it("never selects a command more than once", () => {
    const selected = selectMechanicalCommands([
      CONVEX_FILE,
      "packages/athena-webapp/convex/inventory/stockLedger.ts",
    ]);
    const keys = selected.map(
      (command) => `${command.packageDir}:${command.script}`,
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  it("selects nothing for review-neutral delivery narration", () => {
    expect(selectMechanicalCommands([REPORT_FILE])).toEqual([]);
  });
});

describe("harness mechanical check", () => {
  it("passes and reports the commands it ran", async () => {
    const setup = options();
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result.status).toBe("pass");
    expect(result.ranCommands).toContain("@athena/webapp:lint:convex:changed");
    expect(setup._spies.runPackageScript).toHaveBeenCalled();
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
    const setup = options({ runPackageScript });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);
    const selected = selectMechanicalCommands([CONVEX_FILE]);

    expect(result.failures).toHaveLength(selected.length);
    expect(runPackageScript).toHaveBeenCalledTimes(selected.length);
  });

  it("skips a selected script the package does not define", async () => {
    const setup = options({
      readPackageManifest: async () => ({
        name: "@athena/webapp",
        scripts: { "lint:convex:changed": "echo ok" },
      }),
    });
    const result = await runHarnessMechanicalCheck("/repo", setup as never);

    expect(result.status).toBe("pass");
    expect(result.ranCommands).toEqual(["@athena/webapp:lint:convex:changed"]);
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
