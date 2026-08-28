import { createHash } from "node:crypto";

type AssertionContractInput = {
  id: string;
  area: string;
  statement: string;
  authority: string;
  parity: string;
  adjudication: string;
  citations: Array<{ sourceId: string; selector: string }>;
};

export function blockingAssertionSemanticDigest(
  assertion: AssertionContractInput,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: assertion.id,
        area: assertion.area,
        statement: assertion.statement,
        authority: assertion.authority,
        parity: assertion.parity,
        adjudication: assertion.adjudication,
        citations: assertion.citations.map(({ sourceId, selector }) => ({
          sourceId,
          selector,
        })),
      }),
    )
    .digest("hex");
}

export const REQUIRED_BLOCKING_ASSERTION_DIGESTS = new Map([
  [
    "route-tracked-implementation-to-execute",
    "6d30e2621e8c1b3060e578746d2ed4d9641cdd618c503e2c1732aec95243fa78",
  ],
  [
    "route-approved-ticket-creation-to-track",
    "4a1e7b47e51e8bbd16193432e951d360e4258e0edc6c78942ca1322c128ba93f",
  ],
  [
    "route-fuzzy-requirements-to-brainstorm",
    "af52125a2c48e347d71995ca9a73fd45ad869f0843c38014178fce0f790c39cb",
  ],
  [
    "route-approved-planning-to-plan-workflow",
    "8908b94a1fce1fab871c0c43ad21cbd317008c38c93bf368da29ef0470288a1a",
  ],
  [
    "route-unknown-root-cause-to-debugging",
    "f19bed56096bd51c8e1dbf733cf5bcb521c0be54509ec263583ea40b4c08de1d",
  ],
  [
    "route-review-only-to-code-review",
    "d25d3e1bc28a1afd03521ccb66eb270cf586c4564fab57e1dd6b8016befe8a05",
  ],
  [
    "route-explicit-skill-as-requested",
    "e193f1aa81e617ee22d1eba5c8e79b0b8fff321c2e8dd12904ac5bbf1e24f7d0",
  ],
  [
    "route-default-implementation-through-deliver-work",
    "f1503e640fa73f0b3494cda6f35add472dccb8e2d858e58cdf6dd9028172dc36",
  ],
  [
    "repository-policy-precedes-workflow-examples",
    "24c10ffb62e00e5b7117710bf7b778eca82334915970fa6e31762d35e1650a65",
  ],
  [
    "implementation-selects-explicit-test-posture",
    "31a6db2b3e4ce6c5909b96a5a268ccb61be3f4887f329d3b6cb382fbf633d176",
  ],
  [
    "smallest-honest-sensors-run-before-merge-gate",
    "6bf619830b7c3b3c38b94d8ff4f60520f7ee8faa436866d62584d8f3b6f38118",
  ],
  [
    "planning-captures-test-posture-and-sensors",
    "855ed4ae8fb4aadb1b64f817e26d0541806b4e7015c5fd203d516c7cc0cd5d09",
  ],
  [
    "planning-does-not-mutate-runtime-behavior",
    "3348c1b22d07f64a4b08a66b7cfa29c3a05e27a508bd8516d11ff8d62a5265ab",
  ],
  [
    "review-selects-core-and-risk-lenses",
    "a6afa19b67669f2fad85f18c28cae8878f22ec4e57d8f863c0fed87b240d4f66",
  ],
  [
    "review-is-independent-of-implementation",
    "e7935fc9848ffb87215f99389df34e06c82b5d5d7f538a9b1d54c248c4bc7d3e",
  ],
  [
    "actionable-findings-loop-to-resolution",
    "d5cb11e2e471f60eafe3f70c52ca994dbdc1faec35b5088fc47187a82d583237",
  ],
  [
    "tracker-neutral-workflow-has-actionable-no-tracker-handoff",
    "153cfef48729c6161df43d5acff011a3013fef89b2f366af7e406fbbecaf4ba1",
  ],
  [
    "linear-context-resolution-is-adapter-behavior",
    "969c1c8b6c4264f8387733cc1813695fad3a7325b67329cca258790b00c88c9d",
  ],
  [
    "linear-work-is-atomic-and-dependency-aware",
    "4c2aeb1f88798ba527f59d1d90ed11c843a56a9de23795e66301429f0876e2ef",
  ],
  [
    "linear-execution-keeps-ticket-state-current",
    "09b0ec8182917e4f1badf3a2f448a80e8ee6ba103b9d43aa5c71c82db7396850",
  ],
  [
    "compounding-requires-a-reusable-learning",
    "0d51206f4672f36d761fa746afc2c737d5e705ccfdceecc3cf2986ed01f934c7",
  ],
  [
    "athena-solution-format-remains-repository-owned",
    "8013c5da99a49838482ca19ce96b9734cac13222a0e729e84ec8387b4eac32b2",
  ],
  [
    "landed-report-does-not-replace-durable-learning",
    "137bc527589d6d7f669847b2f23d5124ae8c0282a5fb96c987ff35740141b2a7",
  ],
  [
    "configured-harness-blockers-cannot-degrade-away",
    "2df798bb229fbaa25f709a45dfdf763859e98018593a3f87af89bd71093c347e",
  ],
  [
    "harness-blockers-use-typed-sources-and-remediations",
    "b5e585d7ff3e83a9c81d3b3dd9faf6e2b06237959c14c85e302d5ee4ed8d72a2",
  ],
  [
    "operator-and-provider-proof-lanes-stay-separated",
    "df24f36ccae51bdd8efdd49660b5359c3192eb288a132c481c1d1ce15b739542",
  ],
  [
    "athena-review-evidence-binds-the-candidate",
    "762605f2f5a3e6e82cb533e8301c8091919aab3c83eac22bc13fe1c9f190640b",
  ],
  [
    "pr-athena-remains-merge-ready-authority",
    "3d9f5785dfc87507e9a24136645f8206de7bfbe1a538158ab2354f80314bb00d",
  ],
  [
    "generated-artifact-obligations-remain-mandatory",
    "be2c5affaad5acf8f768ac708045f717646532e402a37ba1df681b055f4a4792",
  ],
  [
    "athena-pr-contract-remains-mandatory",
    "0c2332ba7677245e54b0195be0a6db08712dea3de1a3edd3b7f0217b92136f9d",
  ],
  [
    "delivery-telemetry-recorded-after-final-gate",
    "559d230622c10cc3caa87b2fa5f1c7fb4e48125888b0e4110899d6166c631854",
  ],
  [
    "deployment-handoff-runs-from-clean-merged-main",
    "fef539e3191af061b8f40f3b27483749633c346a197b4d6dfc8969b71d618845",
  ],
  [
    "athena-domain-architecture-is-not-portable-workflow",
    "cd4043ac98d015eef078743b0ea0dcf829e3fab8517a49f0780c03906ff8dfd4",
  ],
]);

export type RequiredBlockingDependencyContract = {
  fromMemberId: string;
  toMemberId: string;
  selector: string;
  reference: string;
  requirement: "required" | "conditional" | "routing";
  parity: "blocking";
  relation: "literal-reference" | "reference-free-binding";
};

const literal = (
  contract: Omit<RequiredBlockingDependencyContract, "parity" | "relation">,
): RequiredBlockingDependencyContract => ({
  ...contract,
  parity: "blocking",
  relation: "literal-reference",
});

const referenceFree = (
  contract: Omit<RequiredBlockingDependencyContract, "parity" | "relation">,
): RequiredBlockingDependencyContract => ({
  ...contract,
  parity: "blocking",
  relation: "reference-free-binding",
});

export const REQUIRED_BLOCKING_DEPENDENCY_CONTRACTS = [
  literal({
    fromMemberId: "deliver-work-body",
    toMemberId: "compound-delivery-kernel",
    selector: "Always apply `$compound-delivery-kernel`.",
    reference: "compound-delivery-kernel",
    requirement: "required",
  }),
  literal({
    fromMemberId: "deliver-work-body",
    toMemberId: "athena-execute-source-bundle",
    selector: "If the work is already tracked in Linear, use `$execute`.",
    reference: "execute",
    requirement: "routing",
  }),
  literal({
    fromMemberId: "deliver-work-body",
    toMemberId: "linear-track-source-bundle",
    selector: "If approved work needs tickets, use `$track`.",
    reference: "track",
    requirement: "routing",
  }),
  literal({
    fromMemberId: "deliver-work-body",
    toMemberId: "ce-brainstorm-source-bundle",
    selector: "compound-engineering:ce-brainstorm",
    reference: "ce-brainstorm",
    requirement: "routing",
  }),
  literal({
    fromMemberId: "deliver-work-body",
    toMemberId: "ce-plan-source-bundle",
    selector: "compound-engineering:ce-plan",
    reference: "ce-plan",
    requirement: "routing",
  }),
  referenceFree({
    fromMemberId: "deliver-work-body",
    toMemberId: "ce-debug-source-bundle",
    selector:
      "If the request is a bug with unknown root cause, use a systematic debugging skill before planning the fix.",
    reference: "ce-debug",
    requirement: "routing",
  }),
  referenceFree({
    fromMemberId: "deliver-work-body",
    toMemberId: "ce-code-review-source-bundle",
    selector:
      "If the task is purely a review, use the available code-review skill instead of implementing.",
    reference: "ce-code-review",
    requirement: "routing",
  }),
  literal({
    fromMemberId: "ce-plan-source-bundle",
    toMemberId: "ce-brainstorm-source-bundle",
    selector: "`ce-brainstorm` defines **WHAT** to build.",
    reference: "ce-brainstorm",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-plan-source-bundle",
    toMemberId: "ce-debug-source-bundle",
    selector: "Surface `ce-debug` as a route-out option",
    reference: "ce-debug",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-plan-source-bundle",
    toMemberId: "ce-work-source-bundle",
    selector: "`ce-work` executes the plan.",
    reference: "ce-work",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-plan-source-bundle",
    toMemberId: "ce-doc-review-source-bundle",
    selector: "run the `ce-doc-review` skill on the plan file",
    reference: "ce-doc-review",
    requirement: "required",
  }),
  literal({
    fromMemberId: "ce-work-source-bundle",
    toMemberId: "ce-code-review-source-bundle",
    selector: "Invoke the `ce-code-review` skill",
    reference: "ce-code-review",
    requirement: "required",
  }),
  literal({
    fromMemberId: "ce-brainstorm-source-bundle",
    toMemberId: "ce-plan-source-bundle",
    selector: "Immediately load the `ce-plan` skill",
    reference: "ce-plan",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-brainstorm-source-bundle",
    toMemberId: "ce-doc-review-source-bundle",
    selector: "Load the `ce-doc-review` skill",
    reference: "ce-doc-review",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-brainstorm-source-bundle",
    toMemberId: "ce-work-source-bundle",
    selector: "Immediately load the `ce-work` skill",
    reference: "ce-work",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-debug-source-bundle",
    toMemberId: "ce-brainstorm-source-bundle",
    selector: "control has transferred to `/ce-brainstorm`",
    reference: "ce-brainstorm",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-debug-source-bundle",
    toMemberId: "ce-compound-source-bundle",
    selector: "run `/ce-compound`",
    reference: "ce-compound",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "athena-execute-source-bundle",
    toMemberId: "ce-landed-change-report-source-bundle",
    selector: "run repo-local `$ce-landed-change-report`",
    reference: "ce-landed-change-report",
    requirement: "required",
  }),
  literal({
    fromMemberId: "compound-delivery-kernel",
    toMemberId: "linear-track-source-bundle",
    selector: "Use `$track` so the repo",
    reference: "track",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "linear-track-source-bundle",
    toMemberId: "compound-delivery-kernel",
    selector: "Apply `$compound-delivery-kernel` when shaping tickets.",
    reference: "compound-delivery-kernel",
    requirement: "required",
  }),
  literal({
    fromMemberId: "linear-track-source-bundle",
    toMemberId: "athena-execute-source-bundle",
    selector: "stop and use `$execute`",
    reference: "execute",
    requirement: "routing",
  }),
  literal({
    fromMemberId: "linear-track-source-bundle",
    toMemberId: "ce-plan-source-bundle",
    selector: "Prefer `$ce-plan`.",
    reference: "ce-plan",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "athena-execute-source-bundle",
    toMemberId: "linear-track-source-bundle",
    selector: "Use `$track` first if the work is not yet ticketed",
    reference: "track",
    requirement: "routing",
  }),
  literal({
    fromMemberId: "athena-execute-source-bundle",
    toMemberId: "compound-delivery-kernel",
    selector: "Apply `$compound-delivery-kernel` throughout execution.",
    reference: "compound-delivery-kernel",
    requirement: "required",
  }),
  literal({
    fromMemberId: "athena-execute-source-bundle",
    toMemberId: "ce-compound-source-bundle",
    selector: "Use the repo-local `$ce-compound` skill",
    reference: "ce-compound",
    requirement: "conditional",
  }),
  referenceFree({
    fromMemberId: "ce-brainstorm-source-bundle",
    toMemberId: "ce-debug-source-bundle",
    selector: "Suggest the alternative skill the user appears to want",
    reference: "ce-debug",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-work-source-bundle",
    toMemberId: "ce-worktree-source-bundle",
    selector: "skill: ce-worktree",
    reference: "ce-worktree",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-code-review-source-bundle",
    toMemberId: "compound-reviewer-prompts",
    selector: "ce-correctness-reviewer",
    reference: "ce-correctness-reviewer",
    requirement: "required",
  }),
  referenceFree({
    fromMemberId: "compound-reviewer-prompts",
    toMemberId: "ce-session-extract-source-bundle",
    selector: "Invoke them through the Skill tool",
    reference: "ce-session-extract",
    requirement: "required",
  }),
  referenceFree({
    fromMemberId: "compound-reviewer-prompts",
    toMemberId: "ce-session-inventory-source-bundle",
    selector: "Extraction is delegated to two agent-facing skills.",
    reference: "ce-session-inventory",
    requirement: "required",
  }),
  literal({
    fromMemberId: "ce-compound-source-bundle",
    toMemberId: "compound-reviewer-prompts",
    selector: "ce-session-historian",
    reference: "ce-session-historian",
    requirement: "required",
  }),
  literal({
    fromMemberId: "ce-compound-source-bundle",
    toMemberId: "ce-session-inventory-source-bundle",
    selector: "ce-session-inventory",
    reference: "ce-session-inventory",
    requirement: "conditional",
  }),
  literal({
    fromMemberId: "ce-doc-review-source-bundle",
    toMemberId: "compound-reviewer-prompts",
    selector: "ce-coherence-reviewer",
    reference: "ce-coherence-reviewer",
    requirement: "required",
  }),
  literal({
    fromMemberId: "ce-landed-change-report-source-bundle",
    toMemberId: "compound-reviewer-prompts",
    selector: "ce-session-historian",
    reference: "ce-session-historian",
    requirement: "required",
  }),
] as const;

type NormativeSourceContract = {
  path: string;
  kind:
    | "approved-plan"
    | "approved-requirements"
    | "enforcement-policy"
    | "repository-policy"
    | "workflow-policy";
};

type BoundedMemberContract = {
  path: string;
  kind: "skill-bundle" | "dependency-bundle";
  classification: "portable-candidate" | "retained-overlay" | "excluded";
};

type RuleIdentityContract = {
  classification:
    "portable-candidate" | "retained-overlay" | "optional-adapter" | "excluded";
  assertionIds: readonly string[];
};

export const NORMATIVE_SOURCE_CONTRACTS = new Map<
  string,
  NormativeSourceContract
>([
  ["root-agent-guide", { path: "AGENTS.md", kind: "repository-policy" }],
  [
    "packages-agent-guide",
    { path: "packages/AGENTS.md", kind: "repository-policy" },
  ],
  [
    "local-skill-policy",
    { path: ".agents/README.md", kind: "repository-policy" },
  ],
  [
    "deliver-work-skill",
    {
      path: ".agents/skills/deliver-work/SKILL.md",
      kind: "workflow-policy",
    },
  ],
  [
    "delivery-kernel-skill",
    {
      path: ".agents/skills/compound-delivery-kernel/SKILL.md",
      kind: "workflow-policy",
    },
  ],
  [
    "plan-skill",
    { path: ".agents/skills/ce-plan/SKILL.md", kind: "workflow-policy" },
  ],
  [
    "work-skill",
    { path: ".agents/skills/ce-work/SKILL.md", kind: "workflow-policy" },
  ],
  [
    "review-skill",
    {
      path: ".agents/skills/ce-code-review/SKILL.md",
      kind: "workflow-policy",
    },
  ],
  [
    "compound-skill",
    {
      path: ".agents/skills/ce-compound/SKILL.md",
      kind: "workflow-policy",
    },
  ],
  [
    "track-skill",
    { path: ".agents/skills/track/SKILL.md", kind: "workflow-policy" },
  ],
  [
    "execute-skill",
    { path: ".agents/skills/execute/SKILL.md", kind: "workflow-policy" },
  ],
  [
    "approved-requirements",
    {
      path: "docs/brainstorms/2026-08-27-cross-agent-delivery-skills-requirements.md",
      kind: "approved-requirements",
    },
  ],
  [
    "approved-delivery-plan",
    {
      path: "docs/plans/2026-08-27-002-feat-cross-agent-delivery-rails-and-skills-plan.md",
      kind: "approved-plan",
    },
  ],
  [
    "typed-harness-blockers",
    { path: "scripts/harness-blockers.ts", kind: "enforcement-policy" },
  ],
] as const);

export const BOUNDED_MEMBER_CONTRACTS = new Map<string, BoundedMemberContract>([
  [
    "deliver-work-body",
    {
      path: ".agents/skills/deliver-work/SKILL.md",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "deliver-work-codex-metadata",
    {
      path: ".agents/skills/deliver-work/agents/openai.yaml",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "compound-delivery-kernel",
    {
      path: ".agents/skills/compound-delivery-kernel",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "ce-plan-source-bundle",
    {
      path: ".agents/skills/ce-plan",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "ce-work-source-bundle",
    {
      path: ".agents/skills/ce-work",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "ce-code-review-source-bundle",
    {
      path: ".agents/skills/ce-code-review",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "compound-reviewer-prompts",
    {
      path: ".agents/agents",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-compound-source-bundle",
    {
      path: ".agents/skills/ce-compound",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "linear-track-source-bundle",
    {
      path: ".agents/skills/track",
      kind: "skill-bundle",
      classification: "retained-overlay",
    },
  ],
  [
    "athena-execute-source-bundle",
    {
      path: ".agents/skills/execute",
      kind: "skill-bundle",
      classification: "retained-overlay",
    },
  ],
  [
    "ce-brainstorm-source-bundle",
    {
      path: ".agents/skills/ce-brainstorm",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "ce-debug-source-bundle",
    {
      path: ".agents/skills/ce-debug",
      kind: "skill-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "ce-doc-review-source-bundle",
    {
      path: ".agents/skills/ce-doc-review",
      kind: "dependency-bundle",
      classification: "portable-candidate",
    },
  ],
  [
    "ce-proof-source-bundle",
    {
      path: ".agents/skills/ce-proof",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-commit-source-bundle",
    {
      path: ".agents/skills/ce-commit",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-commit-push-pr-source-bundle",
    {
      path: ".agents/skills/ce-commit-push-pr",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-compound-refresh-source-bundle",
    {
      path: ".agents/skills/ce-compound-refresh",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-landed-change-report-source-bundle",
    {
      path: ".agents/skills/ce-landed-change-report",
      kind: "dependency-bundle",
      classification: "retained-overlay",
    },
  ],
  [
    "ce-frontend-design-source-bundle",
    {
      path: ".agents/skills/ce-frontend-design",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-demo-reel-source-bundle",
    {
      path: ".agents/skills/ce-demo-reel",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-setup-source-bundle",
    {
      path: ".agents/skills/ce-setup",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-worktree-source-bundle",
    {
      path: ".agents/skills/ce-worktree",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-session-inventory-source-bundle",
    {
      path: ".agents/skills/ce-session-inventory",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
  [
    "ce-session-extract-source-bundle",
    {
      path: ".agents/skills/ce-session-extract",
      kind: "dependency-bundle",
      classification: "excluded",
    },
  ],
] as const);

export const RULE_IDENTITY_CONTRACTS = new Map<string, RuleIdentityContract>([
  [
    "routing-and-repository-discovery",
    {
      classification: "portable-candidate",
      assertionIds: [
        "route-tracked-implementation-to-execute",
        "route-approved-ticket-creation-to-track",
        "route-fuzzy-requirements-to-brainstorm",
        "route-approved-planning-to-plan-workflow",
        "route-unknown-root-cause-to-debugging",
        "route-review-only-to-code-review",
        "route-explicit-skill-as-requested",
        "route-default-implementation-through-deliver-work",
        "repository-policy-precedes-workflow-examples",
      ],
    },
  ],
  [
    "planning-workflow",
    {
      classification: "portable-candidate",
      assertionIds: [
        "planning-captures-test-posture-and-sensors",
        "planning-does-not-mutate-runtime-behavior",
      ],
    },
  ],
  [
    "test-and-handoff-posture",
    {
      classification: "portable-candidate",
      assertionIds: [
        "implementation-selects-explicit-test-posture",
        "smallest-honest-sensors-run-before-merge-gate",
      ],
    },
  ],
  [
    "review-workflow",
    {
      classification: "portable-candidate",
      assertionIds: [
        "review-selects-core-and-risk-lenses",
        "review-is-independent-of-implementation",
        "actionable-findings-loop-to-resolution",
      ],
    },
  ],
  [
    "tracker-neutral-capability-contract",
    {
      classification: "portable-candidate",
      assertionIds: [
        "tracker-neutral-workflow-has-actionable-no-tracker-handoff",
      ],
    },
  ],
  [
    "linear-tracker-adapter",
    {
      classification: "optional-adapter",
      assertionIds: [
        "linear-context-resolution-is-adapter-behavior",
        "linear-work-is-atomic-and-dependency-aware",
        "linear-execution-keeps-ticket-state-current",
      ],
    },
  ],
  [
    "compound-workflow",
    {
      classification: "portable-candidate",
      assertionIds: ["compounding-requires-a-reusable-learning"],
    },
  ],
  [
    "athena-harness-evidence",
    {
      classification: "retained-overlay",
      assertionIds: [
        "configured-harness-blockers-cannot-degrade-away",
        "harness-blockers-use-typed-sources-and-remediations",
        "operator-and-provider-proof-lanes-stay-separated",
        "athena-review-evidence-binds-the-candidate",
      ],
    },
  ],
  [
    "athena-merge-ready-gates",
    {
      classification: "retained-overlay",
      assertionIds: [
        "pr-athena-remains-merge-ready-authority",
        "operator-and-provider-proof-lanes-stay-separated",
      ],
    },
  ],
  [
    "athena-reporting-policy",
    {
      classification: "retained-overlay",
      assertionIds: [
        "athena-solution-format-remains-repository-owned",
        "landed-report-does-not-replace-durable-learning",
      ],
    },
  ],
  [
    "athena-telemetry-policy",
    {
      classification: "retained-overlay",
      assertionIds: ["delivery-telemetry-recorded-after-final-gate"],
    },
  ],
  [
    "athena-deployment-handoff",
    {
      classification: "retained-overlay",
      assertionIds: ["deployment-handoff-runs-from-clean-merged-main"],
    },
  ],
  [
    "athena-generated-artifacts",
    {
      classification: "retained-overlay",
      assertionIds: ["generated-artifact-obligations-remain-mandatory"],
    },
  ],
  [
    "athena-pr-policy",
    {
      classification: "retained-overlay",
      assertionIds: ["athena-pr-contract-remains-mandatory"],
    },
  ],
  [
    "athena-domain-rules",
    {
      classification: "excluded",
      assertionIds: ["athena-domain-architecture-is-not-portable-workflow"],
    },
  ],
  [
    "compound-reviewer-prompt-graph",
    {
      classification: "excluded",
      assertionIds: ["review-selects-core-and-risk-lenses"],
    },
  ],
  [
    "codex-host-exposure-metadata",
    {
      classification: "optional-adapter",
      assertionIds: ["repository-policy-precedes-workflow-examples"],
    },
  ],
  [
    "host-tool-sequence",
    {
      classification: "excluded",
      assertionIds: ["host-tool-call-sequence-is-observed-only"],
    },
  ],
] as const);
