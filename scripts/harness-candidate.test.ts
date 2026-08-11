import { describe, expect, it } from "vitest";

import {
  captureStableHarnessCandidate,
  classifyCandidatePath,
  parseCandidateNumstat,
  projectReviewActivation,
  type CandidateDiffEntry,
} from "./harness-candidate";

type Observation = {
  headSha: string;
  headTreeSha: string;
  treeSha: string;
  baseTipSha: string;
  diffBaseSha: string;
  status: string;
  untracked: string;
};

function createCandidateSpawn(observations: Observation[]) {
  let observationIndex = 0;
  let commandIndex = 0;
  const commands = [
    "git rev-parse --verify HEAD",
    "git rev-parse --verify HEAD^{tree}",
    "git write-tree",
    "git rev-parse --verify origin/main",
    "git merge-base origin/main HEAD",
    "git status --porcelain --untracked-files=all",
    "git ls-files --others --exclude-standard",
    "git diff --quiet",
  ];

  return (command: string[]) => {
    const key = command.join(" ");
    expect(key).toBe(commands[commandIndex]);
    const observation =
      observations[Math.min(observationIndex, observations.length - 1)];
    let output = "";
    let exitCode = 0;

    switch (key) {
      case commands[0]:
        output = observation.headSha;
        break;
      case commands[1]:
        output = observation.headTreeSha;
        break;
      case commands[2]:
        output = observation.treeSha;
        break;
      case commands[3]:
        output = observation.baseTipSha;
        break;
      case commands[4]:
        output = observation.diffBaseSha;
        break;
      case commands[5]:
        output = observation.status;
        break;
      case commands[6]:
        output = observation.untracked;
        break;
      case commands[7]:
        exitCode = 0;
        break;
    }

    commandIndex += 1;
    if (commandIndex === commands.length) {
      commandIndex = 0;
      observationIndex += 1;
    }

    return {
      exited: Promise.resolve(exitCode),
      stdout: new Response(`${output}\n`).body,
      stderr: new Response("").body,
    };
  };
}

const cleanObservation: Observation = {
  headSha: "head-a",
  headTreeSha: "tree-a",
  treeSha: "tree-a",
  baseTipSha: "base-tip-a",
  diffBaseSha: "merge-base-a",
  status: "",
  untracked: "",
};

describe("stable harness candidate capture", () => {
  it("accepts two matching clean observations", async () => {
    await expect(
      captureStableHarnessCandidate("/repo", {
        spawn: createCandidateSpawn([cleanObservation, cleanObservation]),
      }),
    ).resolves.toEqual({
      ok: true,
      candidate: expect.objectContaining({
        headSha: "head-a",
        treeSha: "tree-a",
        mode: "clean",
        baseRef: "origin/main",
        baseTipSha: "base-tip-a",
        diffBaseSha: "merge-base-a",
      }),
    });
  });

  it("accepts a staged-index-only candidate", async () => {
    const staged = {
      ...cleanObservation,
      headTreeSha: "tree-before",
      treeSha: "tree-after",
      status: "M  scripts/example.ts",
    };
    await expect(
      captureStableHarnessCandidate("/repo", {
        spawn: createCandidateSpawn([staged, staged]),
      }),
    ).resolves.toMatchObject({
      ok: true,
      candidate: { mode: "staged-index", treeSha: "tree-after" },
    });
  });

  it("fails closed for unstaged or untracked content", async () => {
    const unstaged = { ...cleanObservation, status: " M scripts/example.ts" };
    await expect(
      captureStableHarnessCandidate("/repo", {
        spawn: createCandidateSpawn([unstaged, unstaged]),
      }),
    ).resolves.toMatchObject({ ok: false, status: "candidate_unprepared" });

    const untracked = {
      ...cleanObservation,
      status: "?? tmp.txt",
      untracked: "tmp.txt",
    };
    await expect(
      captureStableHarnessCandidate("/repo", {
        spawn: createCandidateSpawn([untracked, untracked]),
      }),
    ).resolves.toMatchObject({ ok: false, status: "candidate_unprepared" });
  });

  it("fails closed when the configured base cannot be resolved", async () => {
    await expect(
      captureStableHarnessCandidate("/repo", {
        spawn(command) {
          const key = command.join(" ");
          const failed = key === "git rev-parse --verify origin/main";
          return {
            exited: Promise.resolve(failed ? 1 : 0),
            stdout: new Response(failed ? "" : "value\n").body,
            stderr: new Response(
              failed ? "unknown revision: origin/main\n" : "",
            ).body,
          };
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      status: "candidate_unprepared",
      reason: "unknown revision: origin/main",
    });
  });

  it("returns candidate_ambiguous after finite mismatching observations", async () => {
    const changing = Array.from({ length: 6 }, (_, index) => ({
      ...cleanObservation,
      treeSha: `tree-${index}`,
    }));
    await expect(
      captureStableHarnessCandidate("/repo", {
        spawn: createCandidateSpawn(changing),
        maxAttempts: 3,
      }),
    ).resolves.toMatchObject({ ok: false, status: "candidate_ambiguous" });
  });

  it.each([
    ["HEAD", { headSha: "head-b" }],
    ["HEAD tree", { headTreeSha: "tree-head-b" }],
    ["index", { treeSha: "tree-index-b" }],
    ["base tip", { baseTipSha: "base-tip-b" }],
    ["merge base", { diffBaseSha: "merge-base-b" }],
    ["status", { status: "M  scripts/example.ts", treeSha: "tree-index-b" }],
    ["untracked files", { status: "?? tmp.txt", untracked: "tmp.txt" }],
  ])(
    "treats a changing %s observation as ambiguous",
    async (_label, change) => {
      await expect(
        captureStableHarnessCandidate("/repo", {
          spawn: createCandidateSpawn([
            cleanObservation,
            { ...cleanObservation, ...change },
          ]),
          maxAttempts: 1,
        }),
      ).resolves.toMatchObject({ ok: false, status: "candidate_ambiguous" });
    },
  );
});

describe("review activation projection", () => {
  it.each([
    "src/example.test.ts",
    "src/example.spec.tsx",
    "tests/e2e/checkout.ts",
    "src/__tests__/example.ts",
    "scripts/harness-behavior-fixtures/example.ts",
    "src/vitest.setup.ts",
    ".env.test",
    "packages/athena-webapp/docs/agent/validation-map.json",
    "packages/athena-webapp/convex/_generated/api.ts",
    "graphify-out/GRAPH_REPORT.md",
    "packages/athena-webapp/src/routeTree.gen.ts",
    "bun.lockb",
  ])("classifies %s as threshold-excluded", (repoPath) => {
    expect(classifyCandidatePath(repoPath)).not.toBe("relevant");
  });

  it("projects relevant changed lines without applying the gate threshold", () => {
    expect(
      projectReviewActivation(
        [{ path: "src/a.ts", additions: 49, deletions: 0 }],
        [],
      ),
    ).toMatchObject({ relevantLineCount: 49 });
    expect(
      projectReviewActivation(
        [{ path: "src/a.ts", additions: 49, deletions: 1 }],
        [],
      ),
    ).toMatchObject({ relevantLineCount: 50 });
  });

  it("excludes test/generated/lockfile volume and counts relevant deletions", () => {
    const entries: CandidateDiffEntry[] = [
      { path: "src/a.ts", additions: 0, deletions: 49 },
      { path: "src/a.test.ts", additions: 500, deletions: 0 },
      { path: "bun.lockb", additions: 500, deletions: 0 },
    ];
    expect(projectReviewActivation(entries, [])).toMatchObject({
      relevantLineCount: 49,
    });
  });

  it("activates relevant binary changes and checks both rename paths", () => {
    expect(
      projectReviewActivation(
        [
          {
            path: "src/image.png",
            additions: null,
            deletions: null,
            binary: true,
          },
        ],
        [],
      ),
    ).toMatchObject({ binaryPaths: ["src/image.png"] });
    expect(
      projectReviewActivation(
        [
          {
            oldPath: "src/secure/old.ts",
            path: "src/safe/new.ts",
            additions: 1,
            deletions: 1,
          },
        ],
        [
          {
            id: "sensitive",
            reviewSensitive: true,
            touchedPaths: ["src/secure"],
          },
        ],
      ),
    ).toMatchObject({ sensitiveScenarioIds: ["sensitive"] });
  });

  it("lets sensitivity activate even when threshold classification excludes the path", () => {
    expect(
      projectReviewActivation(
        [{ path: "src/secure/example.test.ts", additions: 1, deletions: 0 }],
        [
          {
            id: "sensitive",
            reviewSensitive: true,
            touchedPaths: ["src/secure"],
          },
        ],
      ),
    ).toMatchObject({
      relevantLineCount: 0,
      sensitiveScenarioIds: ["sensitive"],
    });
  });

  it("parses deletions, binary files, and both sides of Git rename numstat", () => {
    expect(
      parseCandidateNumstat(
        [
          "0\t12\tsrc/deleted.ts",
          "-\t-\tpublic/image.png",
          "2\t1\tsrc/{old => new}/module.ts",
        ].join("\n"),
      ),
    ).toEqual([
      {
        path: "src/deleted.ts",
        additions: 0,
        deletions: 12,
        binary: false,
      },
      {
        path: "public/image.png",
        additions: null,
        deletions: null,
        binary: true,
      },
      {
        oldPath: "src/old/module.ts",
        path: "src/new/module.ts",
        additions: 2,
        deletions: 1,
        binary: false,
      },
    ]);
  });
});
