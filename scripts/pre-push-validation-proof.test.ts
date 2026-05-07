import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
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
      2
    )
  );
  await write(rootDir, ".husky/pre-push", "bun run pre-push:review\n");
  await write(rootDir, "scripts/pre-push-review.ts", "export const prePush = true;\n");
  await write(
    rootDir,
    "scripts/pre-push-validation-proof.ts",
    "export const proof = true;\n"
  );
  await write(rootDir, "scripts/harness-review.ts", "export const review = true;\n");
  await write(rootDir, "scripts/harness-repo-validation.ts", "export const repo = true;\n");

  return rootDir;
}

function createSpawn(outputs: {
  headSha?: string;
  baseSha?: string;
  status?: string;
  bunVersion?: string;
}) {
  const next = {
    headSha: "head-a",
    baseSha: "base-a",
    status: "",
    bunVersion: "1.1.29",
    ...outputs,
  };

  return (command: string[]) => {
    let output = "";
    if (command.join(" ") === "git rev-parse --git-path codex/pre-push-pr-athena-proof.json") {
      output = "proof.json";
    } else if (command.join(" ") === "git rev-parse --verify HEAD") {
      output = next.headSha;
    } else if (command.join(" ") === "git rev-parse --verify origin/main") {
      output = next.baseSha;
    } else if (
      command.join(" ") === "git status --porcelain --untracked-files=all"
    ) {
      output = next.status;
    } else if (command.join(" ") === "bun --version") {
      output = next.bunVersion;
    } else {
      throw new Error(`unexpected command: ${command.join(" ")}`);
    }

    return {
      exited: Promise.resolve(0),
      stdout: new Response(`${output}\n`).body,
      stderr: new Response("").body,
    };
  };
}

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((rootDir) => rm(rootDir, { recursive: true })));
});

describe("pre-push validation proof", () => {
  it("records and reuses a clean same-head pr:athena proof", async () => {
    const rootDir = await createFixtureRoot();
    const spawn = createSpawn({});

    const recorded = await recordPrePushValidationProof(rootDir, {
      spawn,
      logger: { log() {}, warn() {} },
    });
    expect(recorded.recorded).toBe(true);

    await expect(
      evaluatePrePushValidationProof(rootDir, { spawn })
    ).resolves.toMatchObject({
      reusable: true,
      proof: {
        headSha: "head-a",
        baseSha: "base-a",
        cleanStatus: "",
      },
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
      })
    ).resolves.toMatchObject({
      reusable: false,
      reason: "working tree is not clean",
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
      })
    ).resolves.toMatchObject({
      reusable: false,
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
      "export const review = 'changed';\n"
    );

    await expect(
      evaluatePrePushValidationProof(rootDir, {
        spawn: createSpawn({}),
      })
    ).resolves.toMatchObject({
      reusable: false,
      reason: "validation wiring changed since proof recording",
    });
  });
});
