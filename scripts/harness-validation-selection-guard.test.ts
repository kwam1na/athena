import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const runner = resolve(
  import.meta.dirname,
  "harness-validation-selection-guard.mjs",
);
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) =>
      !key.startsWith("GIT_") &&
      !key.startsWith("DELIVERY_CHECK_") &&
      !key.startsWith("ATHENA_SELECTION_"),
  ),
);
async function fixture(
  run: (
    root: string,
    env: Record<string, string>,
    git: (...args: string[]) => string,
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), "athena-selection-guard-"));
  const git = (...args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      env: cleanEnv,
      encoding: "utf8",
    }).trim();
  try {
    git("init", "-q", "-b", "main");
    git("config", "user.name", "Fixture");
    git("config", "user.email", "fixture@example.test");
    await writeFile(join(root, "source.txt"), "base");
    git("add", ".");
    git("commit", "-qm", "base");
    const base = git("rev-parse", "HEAD");
    await writeFile(join(root, "source.txt"), "candidate");
    git("add", ".");
    const tree = git("write-tree");
    const candidate = git(
      "commit-tree",
      tree,
      "-p",
      base,
      "-m",
      "Prepared execution snapshot",
    );
    for (const [ref, value] of [
      ["refs/delivery/base", base],
      ["refs/delivery/origin-head", base],
      ["refs/delivery/merge-base", base],
      ["refs/delivery/candidate", candidate],
    ])
      git("update-ref", ref, value);
    const env = {
      ATHENA_SELECTION_HEAD: base,
      ATHENA_SELECTION_TREE: tree,
      ATHENA_SELECTION_BASE: base,
      ATHENA_SELECTION_MERGE_BASE: base,
      DELIVERY_CHECK_ORIGIN_HEAD: base,
      DELIVERY_CHECK_ORIGIN_TREE: tree,
      DELIVERY_CHECK_MERGE_BASE: base,
      DELIVERY_CHECK_BASE_REF: "refs/delivery/base",
      DELIVERY_CHECK_CANDIDATE_REF: "refs/delivery/candidate",
    };
    await run(root, env, git);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
const execute = (cwd: string, env: Record<string, string>) =>
  spawnSync("node", [runner], {
    cwd,
    env: { ...cleanEnv, ...env },
    encoding: "utf8",
  });
describe("native selection binding guard", () => {
  it("accepts the pinned staged tree even when origin HEAD has different source", async () =>
    fixture(async (root, env) => {
      const result = execute(root, env);
      expect({ code: result.status, stderr: result.stderr }).toEqual({
        code: 0,
        stderr: "",
      });
    }));
  for (const field of [
    "ATHENA_SELECTION_HEAD",
    "ATHENA_SELECTION_TREE",
    "ATHENA_SELECTION_BASE",
    "ATHENA_SELECTION_MERGE_BASE",
    "DELIVERY_CHECK_ORIGIN_TREE",
  ]) {
    it(`refuses stale ${field}`, async () =>
      fixture(async (root, env) => {
        const result = execute(root, { ...env, [field]: "f".repeat(40) });
        expect(result.status).toBe(1);
        expect(result.stderr).toContain('"code":"validation_selection_stale"');
      }));
  }
  it("refuses missing coordinates rather than silently using live HEAD", async () =>
    fixture(async (root, env) => {
      delete env.ATHENA_SELECTION_TREE;
      expect(execute(root, env).status).toBe(1);
    }));
  it("checks private Git references instead of trusting matching flags", async () =>
    fixture(async (root, env, git) => {
      git("update-ref", "refs/delivery/candidate", env.ATHENA_SELECTION_HEAD);
      expect(execute(root, env).status).toBe(1);
    }));
  it("cannot pass without native full Git context", async () =>
    fixture(async (root, env) => {
      await rm(join(root, ".git"), { recursive: true, force: true });
      expect(execute(root, env).status).toBe(1);
    }));
});
