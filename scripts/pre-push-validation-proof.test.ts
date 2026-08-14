import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertPrAthenaProofReady,
  evaluatePrePushValidationProof,
  recordPrePushValidationProof,
} from "./pre-push-validation-proof";

const tempRoots: string[] = [];

async function write(rootDir: string, relativePath: string, contents: string) {
  const filePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function createFixtureRoot() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pre-push-proof-"));
  tempRoots.push(rootDir);

  await write(
    rootDir,
    "package.json",
    JSON.stringify(
      {
        scripts: {
          "pr:athena":
            "bun run test:coverage && bun run graphify:check && bun scripts/pre-push-validation-proof.ts record-pr-athena",
        },
      },
      null,
      2,
    ),
  );
  await write(rootDir, ".husky/pre-push", "bun run pre-push:review\n");
  await write(
    rootDir,
    "scripts/pre-push-review.ts",
    "export const prePush = true;\n",
  );
  await write(
    rootDir,
    "scripts/pre-push-validation-proof.ts",
    "export const proof = true;\n",
  );
  await write(
    rootDir,
    "scripts/harness-review.ts",
    "export const review = true;\n",
  );
  await write(
    rootDir,
    "scripts/harness-repo-validation.ts",
    "export const repo = true;\n",
  );

  return rootDir;
}

function createSpawn(outputs: {
  headSha?: string;
  headTreeSha?: string;
  indexTreeSha?: string;
  baseSha?: string;
  status?: string;
  untrackedFiles?: string;
  unstagedDiffExitCode?: number;
  unstagedFiles?: string;
  bunVersion?: string;
  changedTreeFiles?: string[];
  changedTreeEntries?: Array<{ status: string; path: string }>;
  treeContents?: Record<string, string>;
}) {
  const next = {
    headSha: "head-a",
    headTreeSha: "tree-a",
    indexTreeSha: "tree-a",
    baseSha: "base-a",
    status: "",
    untrackedFiles: "",
    unstagedDiffExitCode: 0,
    unstagedFiles: "",
    bunVersion: "1.1.29",
    changedTreeFiles: [],
    changedTreeEntries: undefined,
    treeContents: {},
    ...outputs,
  };

  return (command: string[]) => {
    let output = "";
    if (
      command.join(" ") ===
      "git rev-parse --git-path codex/pre-push-pr-athena-proof.json"
    ) {
      output = "proof.json";
    } else if (command.join(" ") === "git rev-parse --verify HEAD") {
      output = next.headSha;
    } else if (command.join(" ") === "git rev-parse --verify HEAD^{tree}") {
      output = next.headTreeSha;
    } else if (command.join(" ") === "git write-tree") {
      output = next.indexTreeSha;
    } else if (command.join(" ") === "git rev-parse --verify origin/main") {
      output = next.baseSha;
    } else if (command.join(" ") === "git merge-base origin/main HEAD") {
      output = next.baseSha;
    } else if (
      command.join(" ") === "git status --porcelain --untracked-files=all"
    ) {
      output = next.status;
    } else if (
      command.join(" ") === "git ls-files --others --exclude-standard"
    ) {
      output = next.untrackedFiles;
    } else if (command.join(" ") === "git diff --quiet") {
      return {
        exited: Promise.resolve(next.unstagedDiffExitCode),
        stdout: new Response("").body,
        stderr: new Response("").body,
      };
    } else if (command.join(" ") === "git diff --name-only") {
      output = next.unstagedFiles;
    } else if (command.join(" ") === "bun --version") {
      output = next.bunVersion;
    } else if (command[0] === "git" && command[1] === "ls-tree") {
      const treeSha = command.at(-1) ?? "";
      output =
        next.treeContents[treeSha] ?? `100644 blob blob-a\tsrc/app.ts`;
    } else if (
      command[0] === "git" &&
      command[1] === "diff" &&
      command.includes("--name-status") &&
      command.includes("-z")
    ) {
      const entries =
        next.changedTreeEntries ??
        next.changedTreeFiles.map((path) => ({ status: "A", path }));
      output = entries.map((entry) => `${entry.status}\0${entry.path}\0`).join("");
    } else {
      throw new Error(`unexpected command: ${command.join(" ")}`);
    }

    return {
      exited: Promise.resolve(0),
      stdout: new Response(
        command.includes("-z") ? output : `${output}\n`,
      ).body,
      stderr: new Response("").body,
    };
  };
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true })),
  );
});

describe("pre-push validation proof", () => {
  it("prepares a clean tree for pr:athena proof recording", async () => {
    const rootDir = await createFixtureRoot();
    const logs: string[] = [];

    await expect(
      assertPrAthenaProofReady(rootDir, {
        spawn: createSpawn({}),
        logger: {
          log(message: string) {
            logs.push(message);
          },
        },
      }),
    ).resolves.toMatchObject({
      ready: true,
      mode: "clean",
      stagedFiles: [],
    });
    expect(logs).toContain(
      "[pr:athena] Prepare complete: working tree is clean.",
    );
  });

  it("prepares a staged-only tree for pr:athena staged-index proof recording", async () => {
    const rootDir = await createFixtureRoot();

    await expect(
      assertPrAthenaProofReady(rootDir, {
        spawn: createSpawn({
          headTreeSha: "tree-before",
          indexTreeSha: "tree-after",
          status: "M  scripts/pre-push-review.ts",
        }),
        logger: { log() {} },
      }),
    ).resolves.toMatchObject({
      ready: true,
      mode: "staged-index",
      stagedFiles: ["scripts/pre-push-review.ts"],
    });
  });

  it("blocks pr:athena prepare when unstaged tracked files remain", async () => {
    const rootDir = await createFixtureRoot();

    await expect(
      assertPrAthenaProofReady(rootDir, {
        spawn: createSpawn({
          status: " M scripts/pre-push-review.ts",
          unstagedFiles: "scripts/pre-push-review.ts",
        }),
        logger: { log() {} },
      }),
    ).rejects.toThrow(
      /Unstaged tracked files:\n  - scripts\/pre-push-review.ts/,
    );
  });

  it("blocks pr:athena prepare when untracked files remain", async () => {
    const rootDir = await createFixtureRoot();

    await expect(
      assertPrAthenaProofReady(rootDir, {
        spawn: createSpawn({
          status: "M  scripts/pre-push-review.ts\n?? tmp.txt",
          untrackedFiles: "tmp.txt",
        }),
        logger: { log() {} },
      }),
    ).rejects.toThrow(
      /Untracked files:\n  - tmp.txt\nStage intended new files explicitly/,
    );
  });

  it("records and reuses a clean same-head pr:athena proof", async () => {
    const rootDir = await createFixtureRoot();
    const spawn = createSpawn({});

    const recorded = await recordPrePushValidationProof(rootDir, {
      spawn,
      logger: { log() {}, warn() {} },
    });
    expect(recorded.recorded).toBe(true);

    await expect(
      evaluatePrePushValidationProof(rootDir, { spawn }),
    ).resolves.toMatchObject({
      reusable: true,
      status: "reusable",
      proof: {
        recordedHeadSha: "head-a",
        baseSha: "base-a",
        validatedTreeSha: "tree-a",
        recordedStatusMode: "clean",
      },
    });
  });

  it("records staged-only pr:athena proof and reuses it after commit creates the same tree", async () => {
    const rootDir = await createFixtureRoot();
    const recorded = await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({
        headSha: "head-before",
        headTreeSha: "tree-before",
        indexTreeSha: "tree-after",
        status: "M  scripts/pre-push-review.ts",
      }),
      logger: { log() {}, warn() {} },
    });
    expect(recorded).toMatchObject({
      recorded: true,
      proof: {
        recordedHeadSha: "head-before",
        validatedTreeSha: "tree-after",
        recordedStatusMode: "staged-index",
      },
    });

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({
          headSha: "head-after",
          headTreeSha: "tree-after",
          indexTreeSha: "tree-after",
        }),
      }),
    ).resolves.toMatchObject({
      reusable: true,
      status: "reusable",
      proof: {
        recordedHeadSha: "head-before",
        validatedTreeSha: "tree-after",
        recordedStatusMode: "staged-index",
      },
    });
  });

  it("reuses proof after the canonical post-gate telemetry record is committed", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({
        headSha: "head-before",
        headTreeSha: "tree-before",
        indexTreeSha: "tree-validated",
        status: "A  telemetry/delivery-runs/run.json",
      }),
      logger: { log() {}, warn() {} },
    });
    let telemetryChecked = false;

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({
          headSha: "head-after",
          headTreeSha: "tree-with-telemetry",
          indexTreeSha: "tree-with-telemetry",
          changedTreeFiles: ["telemetry/delivery-runs/run.json"],
        }),
        validatePostGateNeutralChanges: async () => {
          telemetryChecked = true;
        },
      }),
    ).resolves.toMatchObject({ reusable: true, status: "reusable" });
    expect(telemetryChecked).toBe(true);
  });

  it("does not reuse proof for other review-neutral documentation changes", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({
          headTreeSha: "tree-with-report",
          indexTreeSha: "tree-with-report",
          changedTreeFiles: ["docs/reports/changed.html"],
        }),
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "stale",
      reason: "HEAD tree changed outside post-gate validation-neutral paths",
    });
  });

  it("fails closed when committed post-gate telemetry is invalid", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({
          headTreeSha: "tree-with-telemetry",
          indexTreeSha: "tree-with-telemetry",
          changedTreeFiles: ["telemetry/delivery-runs/run.json"],
        }),
        validatePostGateNeutralChanges: async () => {
          throw new Error("telemetry record is stale");
        },
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "stale",
      reason: "post-gate telemetry validation failed: telemetry record is stale",
    });
  });

  it("does not reuse proof for telemetry edits or path-prefix lookalikes", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    for (const changedTreeEntries of [
      [{ status: "M", path: "telemetry/delivery-runs/run.json" }],
      [{ status: "A", path: " telemetry/delivery-runs/run.json" }],
    ]) {
      await expect(
        evaluatePrePushValidationProof(rootDir, {
          spawn: createSpawn({
            headTreeSha: "tree-with-unsafe-delta",
            indexTreeSha: "tree-with-unsafe-delta",
            changedTreeEntries,
          }),
        }),
      ).resolves.toMatchObject({
        reusable: false,
        status: "stale",
        reason: "HEAD tree changed outside post-gate validation-neutral paths",
      });
    }
  });

  it("does not record staged proof when unstaged files are also present", async () => {
    const rootDir = await createFixtureRoot();

    await expect(
      recordPrePushValidationProof(rootDir, {
        spawn: createSpawn({
          headTreeSha: "tree-before",
          indexTreeSha: "tree-after",
          status: "MM scripts/pre-push-review.ts",
          unstagedDiffExitCode: 1,
        }),
        logger: { log() {}, warn() {} },
      }),
    ).resolves.toMatchObject({
      recorded: false,
      status: "proof_not_recorded",
      reason: "working tree has unstaged or untracked changes",
    });
  });

  it("does not record staged proof when untracked files are present", async () => {
    const rootDir = await createFixtureRoot();

    await expect(
      recordPrePushValidationProof(rootDir, {
        spawn: createSpawn({
          headTreeSha: "tree-before",
          indexTreeSha: "tree-after",
          status: "M  scripts/pre-push-review.ts\n?? tmp.txt",
          untrackedFiles: "tmp.txt",
        }),
        logger: { log() {}, warn() {} },
      }),
    ).resolves.toMatchObject({
      recorded: false,
      status: "proof_not_recorded",
      reason: "working tree has unstaged or untracked changes",
    });
  });

  it("reruns pre-push when the working tree is dirty", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({ status: " M scripts/pre-push-review.ts" }),
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "dirty",
      reason: "working tree is not clean",
    });
  });

  it("reruns pre-push when no proof has been recorded", async () => {
    const rootDir = await createFixtureRoot();

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({}),
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "missing",
      reason: "no current pr:athena proof was found",
    });
  });

  it("reruns pre-push when HEAD tree differs from the recorded staged proof", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({
        headSha: "head-before",
        headTreeSha: "tree-before",
        indexTreeSha: "tree-after",
        status: "M  scripts/pre-push-review.ts",
      }),
      logger: { log() {}, warn() {} },
    });

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({
          headSha: "head-after",
          headTreeSha: "tree-other",
          indexTreeSha: "tree-other",
          changedTreeFiles: ["src/app.ts"],
          treeContents: {
            "tree-other": "100644 blob blob-b\tsrc/app.ts",
          },
        }),
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "stale",
      reason: "HEAD tree changed outside post-gate validation-neutral paths",
    });
  });

  it("reruns pre-push when origin/main advanced", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({ baseSha: "base-b" }),
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "base_changed",
      reason: "origin/main changed since pr:athena recorded its proof",
    });
  });

  it("reruns pre-push when validation wiring changes", async () => {
    const rootDir = await createFixtureRoot();
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    await write(
      rootDir,
      "scripts/harness-review.ts",
      "export const review = 'changed';\n",
    );

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({}),
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "validation_wiring_changed",
      reason: "validation wiring changed since proof recording",
    });
  });

  it("reruns pre-push when delivery documentation wiring changes", async () => {
    const rootDir = await createFixtureRoot();
    await write(
      rootDir,
      "scripts/delivery-documentation-check.ts",
      "export {};\n",
    );
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    await write(
      rootDir,
      "scripts/delivery-documentation-check.ts",
      "export const policy = 'changed';\n",
    );

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({}),
      }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "validation_wiring_changed",
      reason: "validation wiring changed since proof recording",
    });
  });

  it("reruns pre-push when an approved review adapter changes", async () => {
    const rootDir = await createFixtureRoot();
    await write(rootDir, ".agents/skills/execute/SKILL.md", "review adapter v1\n");
    await recordPrePushValidationProof(rootDir, {
      spawn: createSpawn({}),
      logger: { log() {}, warn() {} },
    });

    await write(rootDir, ".agents/skills/execute/SKILL.md", "review adapter v2\n");

    await expect(
      evaluatePrePushValidationProof(rootDir, { spawn: createSpawn({}) }),
    ).resolves.toMatchObject({
      reusable: false,
      status: "validation_wiring_changed",
    });
  });
});
