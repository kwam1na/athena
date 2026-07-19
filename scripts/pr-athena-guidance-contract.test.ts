import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("Athena merge-ready validation guidance", () => {
  it("routes every delivery entrypoint through pr:athena before broad validation", async () => {
    const [
      rootGuide,
      packageGuide,
      packageIndex,
      packageTestingGuide,
      commitPushSkill,
    ] =
      await Promise.all([
        readRepoFile("AGENTS.md"),
        readRepoFile("packages/athena-webapp/AGENTS.md"),
        readRepoFile("packages/athena-webapp/docs/agent/index.md"),
        readRepoFile("packages/athena-webapp/docs/agent/testing.md"),
        readRepoFile(".agents/skills/ce-commit-push-pr/SKILL.md"),
      ]);

    expect(rootGuide).toContain(
      "At a merge-ready boundary, run `bun run pr:athena` before assembling or running an independent broad validation suite."
    );
    expect(packageGuide).toContain(
      "Use `bun run pr:athena` from the repo root as the merge-ready validation authority."
    );
    expect(packageIndex).toContain(
      "Do not compose the commands below into a substitute merge gate"
    );
    expect(packageTestingGuide).toContain(
      "run `bun run pr:athena` from the repository root before any independently assembled broad suite"
    );
    expect(commitPushSkill).toContain(
      "Run the repository's PR-equivalent validation command before pushing"
    );
    expect(commitPushSkill).toContain(
      "For Athena, the command is `bun run pr:athena`"
    );
  });
});
