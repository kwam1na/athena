import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { realpathSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import {
  listPreviews,
  runPreviewCli,
  startPreview,
  stopPreview,
  type PreviewOptions,
} from "./preview-worktree";

const tempRoots: string[] = [];

async function makeDir(prefix: string) {
  const dir = await mkdtemp(path.join(tmpdir(), prefix));
  tempRoots.push(dir);
  return dir;
}

function previewOptions(
  stateDir: string,
  worktreeRoot: string,
  overrides: Partial<PreviewOptions> = {}
): PreviewOptions {
  return {
    command: ["bun", path.join(import.meta.dirname, "harness-behavior-fixtures/sample-app.ts")],
    maxActive: 3,
    packageDir: ".",
    portEnd: 5710,
    portStart: 5701,
    stateDir,
    worktreeRoot,
    ...overrides,
  };
}

function real(filePath: string) {
  return realpathSync(filePath);
}

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map((rootDir) =>
      rm(rootDir, { recursive: true, force: true })
    )
  );
});

describe("preview-worktree", () => {
  it("starts and reuses a healthy preview for the same worktree", async () => {
    const stateDir = await makeDir("athena-preview-state-");
    const worktreeRoot = await makeDir("athena-preview-worktree-");

    const first = await startPreview(previewOptions(stateDir, worktreeRoot));
    const second = await startPreview(previewOptions(stateDir, worktreeRoot));

    expect(first.url).toBe("http://127.0.0.1:5701/");
    expect(second).toMatchObject({
      port: first.port,
      reused: true,
      url: first.url,
      worktreeRoot: real(worktreeRoot),
    });

    await stopPreview(previewOptions(stateDir, worktreeRoot));
  });

  it("assigns distinct ports to different worktrees", async () => {
    const stateDir = await makeDir("athena-preview-state-");
    const worktreeOne = await makeDir("athena-preview-worktree-one-");
    const worktreeTwo = await makeDir("athena-preview-worktree-two-");

    const first = await startPreview(previewOptions(stateDir, worktreeOne));
    const second = await startPreview(previewOptions(stateDir, worktreeTwo));

    expect(first.port).toBe(5701);
    expect(second.port).toBe(5702);
    expect(await listPreviews({ stateDir })).toEqual([
      expect.objectContaining({ port: 5701, worktreeRoot: real(worktreeOne) }),
      expect.objectContaining({ port: 5702, worktreeRoot: real(worktreeTwo) }),
    ]);

    await stopPreview(previewOptions(stateDir, worktreeOne));
    await stopPreview(previewOptions(stateDir, worktreeTwo));
  });

  it("repairs stale metadata for a dead preview process", async () => {
    const stateDir = await makeDir("athena-preview-state-");
    const worktreeRoot = await makeDir("athena-preview-worktree-");
    await mkdir(stateDir, { recursive: true });
    await writeFile(
      path.join(stateDir, "previews.json"),
      JSON.stringify(
        {
          previews: [
            {
              command: ["stale"],
              logPath: path.join(stateDir, "stale.log"),
              packageDir: ".",
              pid: 999999,
              port: 5704,
              startedAt: new Date().toISOString(),
              url: "http://127.0.0.1:5704/",
              worktreeRoot,
            },
          ],
        },
        null,
        2
      )
    );

    const preview = await startPreview(previewOptions(stateDir, worktreeRoot));

    expect(preview.port).toBe(5701);
    expect(preview.reused).toBe(false);

    await stopPreview(previewOptions(stateDir, worktreeRoot));
  });

  it("stops the current worktree preview and removes metadata", async () => {
    const stateDir = await makeDir("athena-preview-state-");
    const worktreeRoot = await makeDir("athena-preview-worktree-");

    await startPreview(previewOptions(stateDir, worktreeRoot));
    const stopped = await stopPreview(previewOptions(stateDir, worktreeRoot));

    expect(stopped).toBe(true);
    expect(await listPreviews({ stateDir })).toEqual([]);
  });

  it("refuses to start when the active preview cap is reached", async () => {
    const stateDir = await makeDir("athena-preview-state-");
    const worktreeOne = await makeDir("athena-preview-worktree-one-");
    const worktreeTwo = await makeDir("athena-preview-worktree-two-");

    await startPreview(previewOptions(stateDir, worktreeOne, { maxActive: 1 }));

    await expect(
      startPreview(previewOptions(stateDir, worktreeTwo, { maxActive: 1 }))
    ).rejects.toThrow("Active preview limit reached");

    await stopPreview(previewOptions(stateDir, worktreeOne));
  });

  it("keeps repo-local delivery skills from mentioning the old link handoff requirement", async () => {
    const deliverWork = await readFile(
      path.join(import.meta.dirname, "../.agents/skills/deliver-work/SKILL.md"),
      "utf8"
    );
    const execute = await readFile(
      path.join(import.meta.dirname, "../.agents/skills/execute/SKILL.md"),
      "utf8"
    );
    const kernel = await readFile(
      path.join(import.meta.dirname, "../.agents/skills/compound-delivery-kernel/SKILL.md"),
      "utf8"
    );

    const oldRequirementPhrase = ["preview", "url"].join(" ");

    for (const skill of [deliverWork, execute, kernel]) {
      expect(skill.toLowerCase()).not.toContain(oldRequirementPhrase);
    }
  });

  it("runs the start, list, and stop CLI commands from environment config", async () => {
    const stateDir = await makeDir("athena-preview-state-");
    const worktreeRoot = await makeDir("athena-preview-worktree-");
    await mkdir(path.join(worktreeRoot, "packages/athena-webapp"), { recursive: true });
    const output: string[] = [];
    const env = {
      ...process.env,
      ATHENA_PREVIEW_COMMAND_JSON: JSON.stringify([
        "bun",
        path.join(import.meta.dirname, "harness-behavior-fixtures/sample-app.ts"),
      ]),
      ATHENA_PREVIEW_PORT_END: "5710",
      ATHENA_PREVIEW_PORT_START: "5701",
      ATHENA_PREVIEW_STATE_DIR: stateDir,
    };

    await runPreviewCli(["start", "athena"], env, worktreeRoot, (line) => output.push(line));
    await runPreviewCli(["list", "athena"], env, worktreeRoot, (line) => output.push(line));
    await runPreviewCli(["stop", "athena"], env, worktreeRoot, (line) => output.push(line));

    expect(output[0]).toBe("http://127.0.0.1:5701/");
    expect(output[1]).toContain(`${real(worktreeRoot)} pid=`);
    expect(output[2]).toBe("Stopped preview.");
  });

  it("rejects unsupported CLI targets and commands", async () => {
    const stateDir = await makeDir("athena-preview-state-");
    const worktreeRoot = await makeDir("athena-preview-worktree-");
    const env = { ...process.env, ATHENA_PREVIEW_STATE_DIR: stateDir };

    await expect(runPreviewCli(["start", "storefront"], env, worktreeRoot)).rejects.toThrow(
      'Unsupported preview target "storefront"'
    );
    await expect(runPreviewCli(["restart", "athena"], env, worktreeRoot)).rejects.toThrow(
      "Usage: bun scripts/preview-worktree.ts [start|list|stop] athena"
    );
  });
});
