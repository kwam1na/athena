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

  it("names the review run root the evidence recorder actually resolves", async () => {
    const agentsGuide = await readRepoFile("AGENTS.md");

    expect(agentsGuide).toContain(
      "`<node-tmpdir-realpath>/compound-engineering/execute/<run-id>`, where `<node-tmpdir-realpath>` is the realpath of Node's `os.tmpdir()`",
    );
    expect(agentsGuide).toContain(
      "On macOS that is the per-user `$TMPDIR` directory resolved through the `/var` symlink (`/private/var/folders/.../T`) \u2014 neither `/tmp` nor the raw `/var/folders/...` form `os.tmpdir()` prints",
    );
    expect(agentsGuide).not.toContain("/tmp/compound-engineering/execute/");
  });

  it("names the reviewer set and the generated-payload review treatment", async () => {
    const [agentsGuide, codeReviewSkill] = await Promise.all([
      readRepoFile("AGENTS.md"),
      readRepoFile(".agents/skills/ce-code-review/SKILL.md"),
    ]);

    const alwaysOnReviewers = [
      "ce-correctness-reviewer",
      "ce-testing-reviewer",
      "ce-maintainability-reviewer",
      "ce-project-standards-reviewer",
      "ce-agent-native-reviewer",
      "ce-learnings-researcher",
    ];
    for (const reviewer of alwaysOnReviewers) {
      expect(agentsGuide).toContain(`\`${reviewer}\``);
      expect(codeReviewSkill).toContain(`\`${reviewer}\``);
    }
    expect(agentsGuide).toContain(
      "extended by every cross-cutting, stack-specific, and CE conditional reviewer whose declared selection condition the candidate's diff meets",
    );
    expect(agentsGuide).toContain(
      "Review `.agent-skills/**` as generated release payload rather than authored code",
    );
  });

  it("declares how a release is installed and how a run event is emitted", async () => {
    const agentsGuide = await readRepoFile("AGENTS.md");

    expect(agentsGuide).toContain(
      "`AGENT_SKILLS_CHECKOUT=<agent-skills checkout> bun run agent-skills:install -- <release-id> --profile <profile>`",
    );
    expect(agentsGuide).toContain(
      "Athena's run-event command is `DELIVERY_EVENT='<json payload>' bun run delivery:emit -- <kind>`",
    );
    expect(agentsGuide).toContain(
      "Athena's two mandated lens ids are `lens.outcome-correctness` and `lens.adversarial-testing`",
    );
  });

  it("references the installed workflow for the review rules it no longer restates", async () => {
    const agentsGuide = await readRepoFile("AGENTS.md");

    expect(agentsGuide).toContain(
      "The installed `review-work` workflow owns that bound and Athena does not narrow it.",
    );
    expect(agentsGuide).toContain(
      "The delivery's round bound, its grace round, and the typed blocker raised when the bound is reached are the installed `review-work` and `execute-work` workflows'",
    );
    expect(agentsGuide).toContain(
      "The installed `obtain-review` and `review-work` workflows own which findings are actionable and when a deferral is discharged",
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
