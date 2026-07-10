import { spawnSync } from "node:child_process";
import { mkdtempSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const createdDirs: string[] = [];

function createCommandShimBin() {
  const binDir = mkdtempSync(join(tmpdir(), "convex-audit-bin-"));
  createdDirs.push(binDir);

  ["dirname", "grep", "python3", "sed", "tr", "wc"].forEach((command) => {
    symlinkSync(`/usr/bin/${command}`, join(binDir, command));
  });

  return binDir;
}

function resolveBunExecutable() {
  const configured = process.env.BUN_EXECUTABLE;
  if (configured) return configured;

  const bunInstall = process.env.BUN_INSTALL;
  if (bunInstall) {
    return join(bunInstall, "bin", "bun");
  }

  const pathResult = spawnSync("/bin/sh", ["-c", "command -v bun"], {
    encoding: "utf8",
  });
  const bunPath = pathResult.stdout.trim();
  if (pathResult.status === 0 && bunPath) return bunPath;

  throw new Error("BUN_INSTALL, BUN_EXECUTABLE, or bun on PATH is required.");
}

afterEach(() => {
  createdDirs.splice(0).forEach((dir) => {
    try {
      spawnSync("rm", ["-rf", dir]);
    } catch {
      // Temp cleanup should never fail the test suite.
    }
  });
});

describe("convex audit script", () => {
  it("falls back to grep when ripgrep is unavailable", () => {
    const shimBin = createCommandShimBin();
    const scriptDir = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "../scripts",
    );
    const result = spawnSync("/bin/bash", ["./convex-audit.sh"], {
      cwd: scriptDir,
      env: {
        ...process.env,
        BUN_EXECUTABLE: resolveBunExecutable(),
        PATH: shimBin,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain(
      "ripgrep (rg) is required for audit:convex",
    );
    expect(result.stdout).toContain("Convex audit report");
    expect(result.stdout).toContain(
      "Register-session authority writers are centralized.",
    );
  }, 15_000);
});
