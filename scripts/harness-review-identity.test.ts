import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  HARNESS_REVIEW_IDENTITY_VERSION,
  computeDeliverableTreeIdentity,
  digestDeliverableEntries,
  isPostGateValidationNeutralPath,
  isReviewNeutralPath,
  parseTreeEntries,
} from "./harness-review-identity";

type TreeEntry = { mode: string; objectSha: string; path: string };

function lsTreeOutput(entries: TreeEntry[]) {
  // `-z` output is NUL-terminated, including after the final record.
  return entries
    .map((entry) => `${entry.mode} blob ${entry.objectSha}\t${entry.path}\0`)
    .join("");
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

  it("treats a post-run machine record as review neutral", () => {
    // A record describes a run that already happened, so writing one must not
    // invalidate the review evidence it reports on.
    expect(
      isReviewNeutralPath(
        "telemetry/delivery-runs/2026-06-18T12-00-00-000Z-codex-thing.json",
      ),
    ).toBe(true);
  });

  it("does not exempt the rest of telemetry/ from review", () => {
    // The exemption is scoped to the record directory: a future sibling under
    // telemetry/ must not silently inherit an escape from the reviewed
    // deliverable.
    expect(isReviewNeutralPath("telemetry/some-future-record.json")).toBe(false);
    expect(isReviewNeutralPath("telemetry/scripts/run.ts")).toBe(false);
  });

  it("keeps post-gate validation neutrality narrower than review neutrality", () => {
    expect(
      isPostGateValidationNeutralPath("telemetry/delivery-runs/run.json"),
    ).toBe(true);
    expect(isPostGateValidationNeutralPath("telemetry/delivery-runs/README.md")).toBe(
      false,
    );
    expect(isPostGateValidationNeutralPath("docs/reports/changed.html")).toBe(
      false,
    );
    expect(isPostGateValidationNeutralPath("docs/solutions/changed.md")).toBe(
      false,
    );
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

  it("does not let a trailing space in a path collide with the trimmed path", async () => {
    const plain = await identityFor([sourceEntry]);
    const trailingSpace = await identityFor([
      { ...sourceEntry, path: `${sourceEntry.path} ` },
    ]);

    expect(trailingSpace.deliverableTreeSha).not.toBe(plain.deliverableTreeSha);
  });

  it("does not let a newline in a path forge a second entry", async () => {
    const forgedRecord = `100644 blob blob-report-a\tdocs/reports/x.html`;
    const injected = await identityFor([
      { ...sourceEntry, path: `${sourceEntry.path}\n${forgedRecord}` },
    ]);
    const plain = await identityFor([sourceEntry]);

    // Splitting on anything but NUL would parse the forged half as its own
    // entry, drop it as review-neutral, and collide with the plain tree.
    expect(injected.deliverableTreeSha).not.toBe(plain.deliverableTreeSha);
  });

  it("keeps a legal newline in a path parsable instead of hard-failing", async () => {
    const newlinePath = await identityFor([
      { ...sourceEntry, path: "packages/athena-webapp/convex/we\nird.ts" },
    ]);

    expect(newlinePath.deliverableTreeSha).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not fold a backslash path onto a review-neutral path", async () => {
    const withBackslashPath = await identityFor([
      sourceEntry,
      {
        mode: "100644",
        objectSha: "blob-report-a",
        path: "docs\\reports\\x.html",
      },
    ]);
    const withoutIt = await identityFor([sourceEntry]);

    // `docs\reports\x.html` is a legal, distinct path. Rewriting the separator
    // would exclude it from the reviewed deliverable entirely.
    expect(isReviewNeutralPath("docs\\reports\\x.html")).toBe(false);
    expect(withBackslashPath.deliverableTreeSha).not.toBe(
      withoutIt.deliverableTreeSha,
    );
  });

  it("keeps a path containing a space inside the reviewed deliverable", async () => {
    const spacedPath =
      "packages/storefront-webapp/src/components/states/checkout unavailable/CheckoutUnavailable.tsx";
    const entries = parseTreeEntries(
      `100644 blob blob-spaced-a\t${spacedPath}\0`,
    );

    expect(entries).toEqual([
      { mode: "100644", objectSha: "blob-spaced-a", path: spacedPath },
    ]);
    expect(isReviewNeutralPath(spacedPath)).toBe(false);
  });

  it("is ordered by byte value rather than host collation", async () => {
    const entryFor = (path: string) => ({
      mode: "100644",
      objectSha: "blob-a",
      path,
    });
    const ascending = await identityFor([entryFor("a/Z.ts"), entryFor("a/a.ts")]);
    const descending = await identityFor([
      entryFor("a/a.ts"),
      entryFor("a/Z.ts"),
    ]);

    expect(ascending.deliverableTreeSha).toBe(descending.deliverableTreeSha);
  });

  it("pins the digest framing and comparator with a golden vector", () => {
    // `a/Z.ts` sorts before `a/a.ts` by byte value and after it under most ICU
    // collations, so this literal changes if the comparator, the field framing,
    // or the identity-version domain prefix ever changes. An authorization
    // digest that varies by host would reject evidence recorded on another
    // machine, so the exact bytes are the contract.
    const identity = digestDeliverableEntries([
      { mode: "100644", objectSha: "blob-a", path: "a/a.ts" },
      { mode: "100644", objectSha: "blob-a", path: "a/Z.ts" },
    ]);

    expect(identity.deliverableTreeSha).toBe(
      "b25f071c04958c3374932dab019de14eab68be4df7f8c6c035dd88d726296714",
    );
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
  // This repo really does track a path containing a space, so the fixture does
  // too: a tightened record regex must fail here, not in production.
  await mkdir(path.join(rootDir, "src", "checkout unavailable"), {
    recursive: true,
  });
  await writeFile(path.join(rootDir, "src", "app.ts"), "export const a = 1;\n");
  await writeFile(
    path.join(rootDir, "src", "checkout unavailable", "View.tsx"),
    "export const View = null;\n",
  );
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

  it("keeps a real spaced path inside the identity and reacts to its content", async () => {
    const rootDir = await gitFixture();
    const reviewed = await headTreeIdentity(rootDir);

    await writeFile(
      path.join(rootDir, "src", "checkout unavailable", "View.tsx"),
      "export const View = 1;\n",
    );
    await git(rootDir, ["add", "-A"]);
    await git(rootDir, ["commit", "--quiet", "-m", "spaced"]);

    expect((await headTreeIdentity(rootDir)).deliverableTreeSha).not.toBe(
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
