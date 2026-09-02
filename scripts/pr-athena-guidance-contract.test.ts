import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("Athena merge-ready validation guidance", () => {
  it("requires approved review workflows to issue exact-candidate evidence before validation", async () => {
    const [agentsGuide, codeReviewSkill] = await Promise.all([
      readRepoFile("AGENTS.md"),
      readRepoFile(".agents/skills/ce-code-review/SKILL.md"),
    ]);

    for (const skill of [agentsGuide, codeReviewSkill]) {
      expect(skill).toContain("bun run pr:athena:prepare");
      expect(skill).toContain("bun run harness:review-context");
      expect(skill).toContain("final-manifest.json");
      expect(skill).toContain("bun run harness:review-evidence --");
    }
    expect(
      agentsGuide.indexOf("bun run harness:review-evidence --"),
    ).toBeLessThan(
      agentsGuide.indexOf("For Athena, run the full `bun run pr:athena` gate"),
    );
  });

  it("routes every delivery entrypoint through pr:athena before broad validation", async () => {
    const [
      rootGuide,
      packageGuide,
      packageIndex,
      packageTestingGuide,
      commitPushSkill,
    ] = await Promise.all([
      readRepoFile("AGENTS.md"),
      readRepoFile("packages/athena-webapp/AGENTS.md"),
      readRepoFile("packages/athena-webapp/docs/agent/index.md"),
      readRepoFile("packages/athena-webapp/docs/agent/testing.md"),
      readRepoFile(".agents/skills/ce-commit-push-pr/SKILL.md"),
    ]);

    expect(rootGuide).toContain(
      "At a merge-ready boundary, run `bun run pr:athena` before assembling or running an independent broad validation suite.",
    );
    expect(packageGuide).toContain(
      "Use `bun run pr:athena` from the repo root as the merge-ready validation authority.",
    );
    expect(packageIndex).toContain(
      "Do not compose the commands below into a substitute merge gate",
    );
    expect(packageTestingGuide).toContain(
      "run `bun run pr:athena` from the repository root before any independently assembled broad suite",
    );
    expect(commitPushSkill).toContain(
      "Run the repository's PR-equivalent validation command before pushing",
    );
    expect(commitPushSkill).toContain(
      "For Athena, the command is `bun run pr:athena`",
    );
  });

  it("classifies the in-app docs corpus as an Athena production deploy surface", async () => {
    const agentsGuide = await readRepoFile("AGENTS.md");

    expect(agentsGuide).toContain("`docs/solutions/**`");
    expect(agentsGuide).toContain("`docs/reports/**`");
    expect(agentsGuide).toContain("`scripts/deploy-vps.sh athena-local`");
  });
});
