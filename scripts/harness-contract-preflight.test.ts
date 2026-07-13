import { spawnSync } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  runFocusedContractTests,
  runHarnessContractPreflight,
} from "./harness-contract-preflight";
import { collectHarnessSiblingTestPolicyFindings } from "./harness-inferential-review";
import { runHarnessSelfReview } from "./harness-self-review";

function runGit(rootDir: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    env: Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
    ),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
}

async function createSiblingPolicyFixture() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-harness-sibling-policy-"),
  );
  await mkdir(path.join(rootDir, "scripts"), { recursive: true });
  await writeFile(
    path.join(rootDir, "scripts/harness-app-registry.ts"),
    "export const registry = ['baseline'];\n",
  );
  await writeFile(
    path.join(rootDir, "scripts/harness-app-registry.test.ts"),
    "export const registryTest = true;\n",
  );
  runGit(rootDir, ["init"]);
  runGit(rootDir, ["config", "user.email", "codex@example.com"]);
  runGit(rootDir, ["config", "user.name", "Codex Test"]);
  runGit(rootDir, ["add", "."]);
  runGit(rootDir, ["commit", "-m", "baseline"]);
  runGit(rootDir, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await writeFile(
    path.join(rootDir, "scripts/harness-app-registry.ts"),
    "export const registry = ['baseline', 'new-surface'];\n",
  );
  return rootDir;
}

async function createRealAuditFixtureDrift() {
  const rootDir = await mkdtemp(
    path.join(tmpdir(), "athena-harness-audit-contract-"),
  );
  await cp(path.join(process.cwd(), "scripts"), path.join(rootDir, "scripts"), {
    recursive: true,
  });
  await mkdir(path.join(rootDir, "packages/athena-webapp/scripts"), {
    recursive: true,
  });
  await cp(
    path.join(
      process.cwd(),
      "packages/athena-webapp/scripts/convex-lint-changed.sh",
    ),
    path.join(
      rootDir,
      "packages/athena-webapp/scripts/convex-lint-changed.sh",
    ),
  );
  await symlink(path.join(process.cwd(), "node_modules"), path.join(rootDir, "node_modules"));

  const registryPath = path.join(rootDir, "scripts/harness-app-registry.ts");
  const baselineRegistry = await readFile(registryPath, "utf8");
  const driftedRegistry = baselineRegistry.replace(
    '          "src/assets",',
    [
      '          "src/assets",',
      '          "docs/shared-demo-backend-coverage.md",',
    ].join("\n"),
  );
  if (driftedRegistry === baselineRegistry) {
    throw new Error("Unable to seed real harness audit fixture drift.");
  }
  await writeFile(registryPath, driftedRegistry);

  return { rootDir, registryPath, baselineRegistry };
}

describe("runHarnessContractPreflight", () => {
  it("aggregates mapping, audit fixture, and sibling-test findings in one run", async () => {
    const result = await runHarnessContractPreflight("/repo", {
      runSelfReview: async () => ({
        blockers: [
          "Harness review coverage gap: packages/athena-webapp/docs/shared-demo-backend-coverage.md is not covered by any validation mapping.",
        ],
      }),
      runAudit: async () => undefined,
      runContractTests: async () => {
        throw new Error(
          'Fixture drift: add "packages/athena-webapp/docs/shared-demo-backend-coverage.md" to the harness audit fixture.',
        );
      },
      runSiblingTestPolicy: async () => [
        {
          id: "missing-harness-script-test-update-scripts-harness-app-registry-ts",
          title: "Harness script changed without test update",
          filePath: "scripts/harness-app-registry.ts",
          rationale:
            "The sibling test scripts/harness-app-registry.test.ts was not part of the same change.",
          remediation:
            "Update scripts/harness-app-registry.test.ts alongside the registry change.",
        },
      ],
      writeMachineOutput: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings.map((finding) => finding.source)).toEqual([
      "validation-map",
      "contract-fixtures",
      "sibling-test-policy",
    ]);
    expect(result.humanReport).toContain("scripts/harness-app-registry.ts");
    expect(result.humanReport).toContain("scripts/harness-app-registry.test.ts");
    expect(result.humanReport).toContain("scripts/harness-audit.test.ts");
    expect(result.humanReport).toContain("bun run harness:generate");
    expect(result.humanReport).toContain(
      "bun test scripts/harness-contract-preflight.test.ts scripts/harness-review.test.ts scripts/harness-audit.test.ts scripts/harness-app-registry.test.ts scripts/harness-inferential-review.test.ts",
    );
  });

  it("passes when every static harness contract is consistent", async () => {
    const result = await runHarnessContractPreflight("/repo", {
      runSelfReview: async () => ({ blockers: [] }),
      runAudit: async () => undefined,
      runContractTests: async () => undefined,
      runSiblingTestPolicy: async () => [],
      writeMachineOutput: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.status).toBe("pass");
    expect(result.machine.findings).toEqual([]);
  });

  it("fails closed when sibling-test policy evidence cannot be produced", async () => {
    const result = await runHarnessContractPreflight("/repo", {
      runSelfReview: async () => ({ blockers: [] }),
      runAudit: async () => undefined,
      runContractTests: async () => undefined,
      runSiblingTestPolicy: async () => {
        throw new Error(
          "Base ref evidence is unavailable. Fetch origin/main and retry.",
        );
      },
      writeMachineOutput: false,
    });

    expect(result.exitCode).toBe(1);
    expect(result.machine.findings).toEqual([
      {
        source: "sibling-test-policy",
        message:
          "Base ref evidence is unavailable. Fetch origin/main and retry.",
      },
    ]);
  });

  it("uses the real git diff to detect and clear sibling-test drift", async () => {
    const rootDir = await createSiblingPolicyFixture();

    try {
      await expect(
        collectHarnessSiblingTestPolicyFindings(rootDir),
      ).resolves.toEqual([
        expect.objectContaining({
          id: "missing-harness-script-test-update-scripts-harness-app-registry-ts",
          filePath: "scripts/harness-app-registry.ts",
        }),
      ]);

      await writeFile(
        path.join(rootDir, "scripts/harness-app-registry.test.ts"),
        "export const registryTest = 'new-surface';\n",
      );

      await expect(
        collectHarnessSiblingTestPolicyFindings(rootDir),
      ).resolves.toEqual([]);
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("passes through every default adapter on the current consistent tree", async () => {
    const result = await runHarnessContractPreflight(process.cwd(), {
      writeMachineOutput: false,
    });

    expect(result.exitCode).toBe(0);
    expect(result.machine.findings).toEqual([]);
  });

  it("surfaces and clears real harness-audit fixture drift", async () => {
    const { rootDir, registryPath, baselineRegistry } =
      await createRealAuditFixtureDrift();

    try {
      await expect(runFocusedContractTests(rootDir)).rejects.toThrow(
        /Focused harness contract tests exited with code 1/,
      );

      await writeFile(registryPath, baselineRegistry);
      await expect(runFocusedContractTests(rootDir)).resolves.toBeUndefined();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("aggregates three real contract failures, then passes after all are repaired", async () => {
    const siblingRoot = await createSiblingPolicyFixture();
    const auditFixture = await createRealAuditFixtureDrift();

    try {
      const runComposedPreflight = (mapped: boolean) =>
        runHarnessContractPreflight(process.cwd(), {
          runSelfReview: async () =>
            runHarnessSelfReview(process.cwd(), {
              baseRef: "origin/main",
              getChangedFiles: async () => ({
                baseFiles: [
                  mapped
                    ? "packages/athena-webapp/src/routes/index.tsx"
                    : "packages/athena-webapp/unmapped-contract.ts",
                ],
                trackedFiles: [],
                untrackedFiles: [],
              }),
              runHarnessCheck: async () => undefined,
            }),
          runAudit: async () => undefined,
          runContractTests: async () =>
            runFocusedContractTests(auditFixture.rootDir),
          runSiblingTestPolicy: async () =>
            collectHarnessSiblingTestPolicyFindings(siblingRoot),
          writeMachineOutput: false,
        });

      const failed = await runComposedPreflight(false);
      expect(failed.exitCode).toBe(1);
      expect(failed.machine.findings.map((finding) => finding.source)).toEqual([
        "validation-map",
        "contract-fixtures",
        "sibling-test-policy",
      ]);
      expect(failed.humanReport).toContain("unmapped-contract.ts");
      expect(failed.humanReport).toContain("Focused harness contract tests exited");
      expect(failed.humanReport).toContain("harness-app-registry.test.ts");

      await writeFile(
        auditFixture.registryPath,
        auditFixture.baselineRegistry,
      );
      await writeFile(
        path.join(siblingRoot, "scripts/harness-app-registry.test.ts"),
        "export const registryTest = 'new-surface';\n",
      );

      const repaired = await runComposedPreflight(true);
      expect(repaired.exitCode).toBe(0);
      expect(repaired.machine.findings).toEqual([]);
    } finally {
      await Promise.all([
        rm(siblingRoot, { recursive: true, force: true }),
        rm(auditFixture.rootDir, { recursive: true, force: true }),
      ]);
    }
  });
});
