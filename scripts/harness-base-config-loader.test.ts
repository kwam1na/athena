import { expect, test } from "bun:test";
import {
  mkdtemp,
  mkdir,
  writeFile,
  rm,
  symlink,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import base from "./harness-base-config";
import { loadHarnessBaseConfig } from "./harness-base-config-loader";

test("base loader never executes controller or candidate default config and refuses missing, invalid or scoped base", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "base-loader-")));
  try {
    for (const name of [
      "controller",
      "candidate",
      "invalid",
      "scoped",
      "linked",
    ]) {
      await mkdir(join(root, name, "scripts"), { recursive: true });
      await writeFile(
        join(root, name, "harness.config.ts"),
        'throw Error("DEFAULT_CONFIG_EXECUTED");',
      );
    }
    const file = join(root, "controller/scripts/harness-base-config.ts");
    await writeFile(file, `export default ${JSON.stringify(base)};`);
    expect(await loadHarnessBaseConfig(join(root, "controller"))).toEqual(base);
    await expect(
      loadHarnessBaseConfig(join(root, "candidate")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(
      join(root, "invalid/scripts/harness-base-config.ts"),
      "export default {};",
    );
    await expect(loadHarnessBaseConfig(join(root, "invalid"))).rejects.toThrow(
      "Invalid declared base policy",
    );
    // Use the current actual scoped declaration so validation cannot fail for an
    // unrelated malformed fixture before testing the explicit base-only guard.
    const { projectValidationPolicy } =
      await import("./harness-validation-policy");
    const { buildValidationPlan } = await import("./harness-validation-plan");
    const plan = buildValidationPlan(
      {
        schemaVersion: "athena-validation-registry/1",
        alwaysRequired: ["check"],
        surfaces: [],
        checks: [
          {
            id: "check",
            profile: "unit",
            cwd: ".",
            argv: ["bun", "test"],
            membership: [],
            inputs: ["x"],
            absentInputs: [],
            prerequisites: [],
            supersedes: [],
          },
        ],
      },
      [],
      "full-health",
    );
    const scoped = projectValidationPolicy(base, plan, {
      profiles: [
        {
          id: "fixture",
          gitContext: "none",
          dependencyInputs: [],
          mutableOutputs: [],
          credentialIdentities: {},
        },
      ],
      profileByCheck: { check: "fixture" },
      mechanicalChecks: [],
    }).config;
    await writeFile(
      join(root, "scoped/scripts/harness-base-config.ts"),
      `export default ${JSON.stringify(scoped)};`,
    );
    await expect(loadHarnessBaseConfig(join(root, "scoped"))).rejects.toThrow(
      "legacy policy explicitly",
    );
    await symlink(file, join(root, "linked/scripts/harness-base-config.ts"));
    await expect(loadHarnessBaseConfig(join(root, "linked"))).rejects.toThrow(
      "regular file",
    );
    await expect(loadHarnessBaseConfig(".")).rejects.toThrow("absolute root");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hosted adapter loads the physical controller base without evaluating its active entrypoint", async () => {
  const { execFileSync } = await import("node:child_process");
  const { wireRepo } =
    await import("../.agent-skills/current/runtime/cli-api.mjs");
  const { createValidationCiRuntime } =
    await import("./harness-validation-ci-adapter");
  const { buildValidationPlan } = await import("./harness-validation-plan");
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "base-controller-")),
  );
  try {
    await mkdir(join(root, "scripts"));
    await writeFile(
      join(root, "harness.config.ts"),
      'throw Error("ACTIVE_CONTROLLER_EXECUTED");',
    );
    await writeFile(
      join(root, "scripts/harness-base-config.ts"),
      `export default ${JSON.stringify(base)};`,
    );
    const git = (...args: string[]) =>
      execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.invalid");
    git("add", ".");
    git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture");
    const sha = git("rev-parse", "HEAD");
    const cap = await (
      await wireRepo(root, { ...base, baseRef: sha })
    ).captureCandidate();
    if (!cap.ok) throw Error(JSON.stringify(cap.blockers));
    const binding = {
      repository: "owner/repo",
      runId: 20,
      runAttempt: 1,
      headSha: sha,
      baseSha: sha,
      defaultMainSha: sha,
      defaultBranch: "main",
      workflowId: 42,
    };
    const runtime = await createValidationCiRuntime(root, {
      controllerRoot: root,
      env: {},
      authenticate: async () => binding,
      captureSelection: async (_root, config, mode) => {
        expect(_root).toBe(root);
        expect(config.scopedExecution).toBeUndefined();
        return {
          schemaVersion: "athena-native-selection/1",
          candidate: cap.candidate,
          plan: buildValidationPlan(
            {
              schemaVersion: "athena-validation-registry/1",
              alwaysRequired: ["check"],
              surfaces: [],
              checks: [
                {
                  id: "check",
                  profile: "unit",
                  cwd: ".",
                  argv: ["bun", "test"],
                  membership: [],
                  inputs: ["harness.config.ts"],
                  absentInputs: [],
                  prerequisites: [],
                  supersedes: [],
                },
              ],
            },
            [],
            mode,
          ),
          inventory: ["harness.config.ts"],
          packageScripts: {},
          timing: {
            initialCaptureMs: 0,
            baseSnapshotMs: 0,
            candidateSnapshotMs: 0,
            planningMs: 0,
            finalCaptureMs: 0,
            totalMs: 0,
          },
        };
      },
      executeNative: async () => {
        throw Error("NATIVE_EXECUTION_FORBIDDEN");
      },
    });
    expect((await runtime.healthInventory(sha)).mode).toBe("full-health");
    expect((await runtime.recomputePlan(binding, "full-health")).mode).toBe(
      "full-health",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
