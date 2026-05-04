import { describe, expect, it } from "vitest";

import {
  collectHarnessRepoValidationSelection,
  matchesHarnessRepoValidationPath,
} from "./harness-repo-validation";

describe("matchesHarnessRepoValidationPath", () => {
  it.each([
    "scripts/harness-review.ts",
    "scripts/pre-push-review.ts",
    "packages/athena-webapp/docs/agent/testing.md",
    "packages/athena-webapp/AGENTS.md",
    "packages/AGENTS.md",
    "README.md",
    "package.json",
    "manage-athena-versions.sh",
    ".github/workflows/athena-pr-tests.yml",
    ".husky/pre-commit",
    ".husky/pre-push",
  ])("matches repo-owned harness path %s", (filePath) => {
    expect(matchesHarnessRepoValidationPath(filePath)).toBe(true);
  });

  it.each([
    "packages/athena-webapp/src/app.ts",
    "packages/storefront-webapp/src/routes/index.tsx",
    "graphify-out/GRAPH_REPORT.md",
  ])("ignores non-repo harness path %s", (filePath) => {
    expect(matchesHarnessRepoValidationPath(filePath)).toBe(false);
  });
});

describe("collectHarnessRepoValidationSelection", () => {
  it("returns the shared repo commands and coverage for repo-owned changes", () => {
    const selection = collectHarnessRepoValidationSelection([
      "README.md",
      "scripts/harness-review.ts",
      "scripts/harness-review.ts",
    ]);

    expect(selection.matchedFiles).toEqual([
      "README.md",
      "scripts/harness-review.ts",
    ]);
    expect(selection.matchedSurfaces).toEqual([
      {
        surfaceName: "repo harness implementation and workflow wiring",
        files: ["README.md", "scripts/harness-review.ts"],
      },
    ]);
    expect(selection.selectedCommands).toEqual([
      "bun run harness:test",
      "bun run test:coverage",
      "bun run harness:inferential-review",
    ]);
  });

  it("returns no coverage when only app-local files change", () => {
    const selection = collectHarnessRepoValidationSelection([
      "packages/athena-webapp/src/app.ts",
    ]);

    expect(selection.matchedFiles).toEqual([]);
    expect(selection.matchedSurfaces).toEqual([]);
    expect(selection.selectedCommands).toEqual([]);
  });
});
