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
        PATH: shimBin,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain(
      "ripgrep (rg) is required for audit:convex",
    );
    expect(result.stdout).toContain("Convex audit report");
  });
});
