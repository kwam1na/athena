import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HARNESS_REVIEW_IDENTITY_VERSION,
  computeDeliverableTreeIdentity,
  isReviewNeutralPath,
} from "./harness-review-identity";

type TreeEntry = { mode: string; objectSha: string; path: string };

function lsTreeOutput(entries: TreeEntry[]) {
  return entries
    .map((entry) => `${entry.mode} blob ${entry.objectSha}\t${entry.path}`)
    .join("\n");
}

function createSpawn(treeOutputs: Record<string, string>) {
  return (command: string[]) => {
    const treeSha = command.at(-1) ?? "";
    const output = treeOutputs[treeSha];
    return {
      exited: Promise.resolve(output === undefined ? 128 : 0),
      stdout: new Response(output ?? "").body,
      stderr: new Response(output === undefined ? "unknown tree" : "").body,
    };
  };
}

const sourceEntry: TreeEntry = {
  mode: "100644",
  objectSha: "blob-source-a",
  path: "packages/athena-webapp/convex/reports/weeklyClose.ts",
};

async function identityFor(entries: TreeEntry[], treeSha = "tree-a") {
  return computeDeliverableTreeIdentity("/repo", treeSha, {
    spawn: createSpawn({ [treeSha]: lsTreeOutput(entries) }),
  });
}

describe("review-neutral path policy", () => {
  it.each([
    "docs/reports/2026/athena-weekly-close.html",
    "docs/solutions/architecture/athena-review-identity.md",
  ])("treats delivery narration path %s as review neutral", (repoPath) => {
    expect(isReviewNeutralPath(repoPath)).toBe(true);
  });

  it.each([
    "packages/athena-webapp/convex/reports/weeklyClose.ts",
    "packages/athena-webapp/convex/_generated/api.d.ts",
    "packages/athena-webapp/src/routeTree.gen.ts",
    "graphify-out/graph.json",
    "artifacts/harness-delivery-runs/provider-evidence.json",
    "docs/agent/validation-map.json",
    "scripts/harness-review-identity.ts",
    "package.json",
  ])("keeps %s inside the reviewed deliverable", (repoPath) => {
    expect(isReviewNeutralPath(repoPath)).toBe(false);
  });
});

describe("deliverable tree identity", () => {
  it("is stable for the same tree contents", async () => {
    const entries = [sourceEntry];
    await expect(identityFor(entries)).resolves.toEqual(
      await identityFor(entries),
    );
  });

  it("names the identity version it was computed with", async () => {
    const identity = await identityFor([sourceEntry]);
    expect(identity.identityVersion).toBe(HARNESS_REVIEW_IDENTITY_VERSION);
    expect(identity.deliverableTreeSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ignores added, edited, and removed review-neutral paths", async () => {
    const base = await identityFor([sourceEntry]);
    const withReport = await identityFor([
      sourceEntry,
      {
        mode: "100644",
        objectSha: "blob-report-a",
        path: "docs/reports/2026/athena-weekly-close.html",
      },
      {
        mode: "100644",
        objectSha: "blob-solution-a",
        path: "docs/solutions/architecture/athena-review-identity.md",
      },
    ]);
    const withEditedReport = await identityFor([
      sourceEntry,
      {
        mode: "100644",
        objectSha: "blob-report-b",
        path: "docs/reports/2026/athena-weekly-close.html",
      },
      {
        mode: "100644",
        objectSha: "blob-solution-a",
        path: "docs/solutions/architecture/athena-review-identity.md",
      },
    ]);

    expect(withReport.deliverableTreeSha).toBe(base.deliverableTreeSha);
    expect(withEditedReport.deliverableTreeSha).toBe(base.deliverableTreeSha);
  });

  it("rejects a comment-only edit to a reviewed source file", async () => {
    const base = await identityFor([sourceEntry]);
    const commentOnlyEdit = await identityFor([
      { ...sourceEntry, objectSha: "blob-source-b" },
    ]);

    expect(commentOnlyEdit.deliverableTreeSha).not.toBe(
      base.deliverableTreeSha,
    );
  });

  it("rejects a mode-only change to a reviewed source file", async () => {
    const base = await identityFor([sourceEntry]);
    const modeChange = await identityFor([{ ...sourceEntry, mode: "100755" }]);

    expect(modeChange.deliverableTreeSha).not.toBe(base.deliverableTreeSha);
  });

  it("rejects a renamed reviewed source file with identical contents", async () => {
    const base = await identityFor([sourceEntry]);
    const renamed = await identityFor([
      {
        ...sourceEntry,
        path: "packages/athena-webapp/convex/reports/weeklyCloseRail.ts",
      },
    ]);

    expect(renamed.deliverableTreeSha).not.toBe(base.deliverableTreeSha);
  });

  it("rejects a deleted reviewed source file", async () => {
    const base = await identityFor([sourceEntry]);
    const deleted = await identityFor([]);

    expect(deleted.deliverableTreeSha).not.toBe(base.deliverableTreeSha);
  });

  it.each([
    "packages/athena-webapp/convex/_generated/api.d.ts",
    "graphify-out/graph.json",
    "artifacts/harness-delivery-runs/provider-evidence.json",
  ])("rejects a generated-artifact change under %s", async (repoPath) => {
    const base = await identityFor([sourceEntry]);
    const withArtifact = await identityFor([
      sourceEntry,
      { mode: "100644", objectSha: "blob-artifact-a", path: repoPath },
    ]);

    expect(withArtifact.deliverableTreeSha).not.toBe(base.deliverableTreeSha);
  });

  it("fails loudly when the tree cannot be read", async () => {
    await expect(
      computeDeliverableTreeIdentity("/repo", "tree-missing", {
        spawn: createSpawn({}),
      }),
    ).rejects.toThrow(/unknown tree|git ls-tree/);
  });
});

const repoRoots: string[] = [];

async function git(rootDir: string, args: string[]) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, GIT_DIR: undefined, GIT_WORK_TREE: undefined },
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) throw new Error(stderr.trim() || stdout.trim());
  return stdout.trim();
}

async function gitFixture() {
  const rootDir = await mkdtemp(path.join(tmpdir(), "review-identity-git-"));
  repoRoots.push(rootDir);
  await git(rootDir, ["init", "--quiet"]);
  await git(rootDir, ["config", "user.email", "harness@example.com"]);
  await git(rootDir, ["config", "user.name", "Harness"]);
  await mkdir(path.join(rootDir, "src"), { recursive: true });
  await mkdir(path.join(rootDir, "docs", "reports"), { recursive: true });
  await writeFile(path.join(rootDir, "src", "app.ts"), "export const a = 1;\n");
  await git(rootDir, ["add", "-A"]);
  await git(rootDir, ["commit", "--quiet", "-m", "base"]);
  return rootDir;
}

async function headTreeIdentity(rootDir: string) {
  const treeSha = await git(rootDir, ["rev-parse", "--verify", "HEAD^{tree}"]);
  return computeDeliverableTreeIdentity(rootDir, treeSha);
}

afterEach(async () => {
  await Promise.all(
    repoRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("deliverable tree identity against real Git", () => {
  it("survives a report-only commit and rejects a comment-only source commit", async () => {
    const rootDir = await gitFixture();
    const reviewed = await headTreeIdentity(rootDir);

    await writeFile(
      path.join(rootDir, "docs", "reports", "landed.html"),
      "<p>landed change report</p>\n",
    );
    await git(rootDir, ["add", "-A"]);
    await git(rootDir, ["commit", "--quiet", "-m", "report"]);
    const afterReport = await headTreeIdentity(rootDir);

    await writeFile(
      path.join(rootDir, "src", "app.ts"),
      "// a comment the reviewer never read\nexport const a = 1;\n",
    );
    await git(rootDir, ["add", "-A"]);
    await git(rootDir, ["commit", "--quiet", "-m", "comment"]);
    const afterComment = await headTreeIdentity(rootDir);

    expect(afterReport.deliverableTreeSha).toBe(reviewed.deliverableTreeSha);
    expect(afterComment.deliverableTreeSha).not.toBe(
      reviewed.deliverableTreeSha,
    );
  });

  it("rejects a staged index whose source content differs from the reviewed tree", async () => {
    const rootDir = await gitFixture();
    const reviewed = await headTreeIdentity(rootDir);

    await writeFile(path.join(rootDir, "src", "app.ts"), "export const a = 2;\n");
    await git(rootDir, ["add", "-A"]);
    const stagedTree = await git(rootDir, ["write-tree"]);
    const staged = await computeDeliverableTreeIdentity(rootDir, stagedTree);

    expect(staged.deliverableTreeSha).not.toBe(reviewed.deliverableTreeSha);
  });
});
