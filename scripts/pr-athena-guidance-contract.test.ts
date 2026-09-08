import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "..");

async function readRepoFile(relativePath: string) {
  return readFile(path.join(repoRoot, relativePath), "utf8");
}

describe("Athena merge-ready validation guidance", () => {
  it("requires prepared review outcomes to use product-emitted evidence before validation", async () => {
    const [agentsGuide, codeReviewSkill] = await Promise.all([
      readRepoFile("AGENTS.md"),
      readRepoFile(".agents/skills/ce-code-review/SKILL.md"),
    ]);

    for (const skill of [agentsGuide, codeReviewSkill]) {
      expect(skill).toContain("bun run pr:athena:prepare");
      expect(skill).toContain("bun run harness:review-context");
      expect(skill).toContain("review-outcome/1");
      expect(skill).toContain("bun run harness:review-evidence --");
    }
    expect(agentsGuide).toContain("emit-review-evidence --context <review-context.json>");
    expect(agentsGuide).toContain("Do not hand-edit the emitted manifest.");
    expect(codeReviewSkill).toContain("returns the product manifest path");
    expect(codeReviewSkill).toContain("--manifest <returned-path>");
    expect(
      agentsGuide.indexOf("bun run harness:review-evidence --"),
    ).toBeLessThan(
      agentsGuide.indexOf("For Athena, run the full `bun run pr:athena` gate"),
    );
  });

  it("delegates evidence storage and manifest paths to the installed product", async () => {
    const [agentsGuide, codeReviewSkill] = await Promise.all([
      readRepoFile("AGENTS.md"),
      readRepoFile(".agents/skills/ce-code-review/SKILL.md"),
    ]);

    expect(agentsGuide).toContain(
      "The installed product owns review contexts, outcome validation, evidence emission, candidate binding, freshness, and storage.",
    );
    expect(agentsGuide).toContain("do not author a second Athena evidence manifest");
    expect(agentsGuide).toContain("Submit the manifest path returned by that command");
    expect(codeReviewSkill).toContain(
      "Keep the reviewer results and round history under the review run root.",
    );
    expect(codeReviewSkill).toContain(
      "Never hand-author the retired Athena `final-manifest.json` envelope",
    );
    expect(agentsGuide).not.toContain(
      "<node-tmpdir-realpath>/compound-engineering/execute/<run-id>",
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
      "`bun run agent-skills:install -- --archive <archive.zip> --metadata <release.json>`",
    );
    expect(agentsGuide).toContain(
      "invoke `bun scripts/delivery-product.ts emit <kind> --json '<payload>'` directly",
    );
    expect(agentsGuide).toContain("no producer checkout is required");
    expect(agentsGuide).not.toContain("AGENT_SKILLS_CHECKOUT=");
    expect(agentsGuide).not.toContain("DELIVERY_EVENT=");
    expect(agentsGuide).toContain(
      "The two mandated lens ids are `lens.outcome-correctness` and `lens.adversarial-testing`",
    );
  });

  it("references the installed workflow for the review rules it no longer restates", async () => {
    const agentsGuide = await readRepoFile("AGENTS.md");
    const harnessGuide = await readRepoFile("docs/harness.md");

    expect(agentsGuide).toContain(
      "The installed `review-work` and `execute-work` workflows own the original bound, constrained grace eligibility, and terminal blockers",
    );
    expect(agentsGuide).toContain(
      "The delivery's round bound, its grace round, and the typed blocker raised when the bound is reached are the installed `review-work` and `execute-work` workflows'",
    );
    expect(agentsGuide).toContain(
      "Preserve finding dispositions, filed deferral issue ids, every round, and host-reported costs.",
    );
    expect(agentsGuide).toContain(
      '`obligationId: "review.green"` and `kind: "satisfied_evidence"`',
    );
    expect(agentsGuide).toContain(
      "coverage of every currently selected lens, with unanimous approval",
    );
    expect(agentsGuide).toContain(
      "For an active review obligation, every other or missing resolution, including `waived`, requires complete acquisition.",
    );
    expect(agentsGuide).toContain(
      "no undischarged actionable findings or tracking obligations",
    );
    expect(agentsGuide).toContain(
      "New actionable review feedback requires a complete review",
    );
    expect(agentsGuide).toContain(
      "other admission or recovery blockers remain blocking for their own stages and do not by themselves require another review",
    );
    expect(agentsGuide).toContain(
      "continue to validation without another acquisition or emission",
    );
    expect(agentsGuide).toContain(
      "A product-verified reuse does not create a round, reset history, or create grace eligibility.",
    );
    expect(harnessGuide.replace(/\s+/g, " ")).not.toContain(
      "Any review fix requires preparation and a complete re-review",
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
