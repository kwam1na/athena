import {
  defineHarnessConfig,
  DELIVERABLE_TREE_V1,
  DELIVERABLE_TREE_V1_NARRATION_SET,
  GATE_STRUCTURAL_FINDING_CODES,
  type ObligationPolicy,
} from "./.agent-skills/current/runtime/kernel.mjs";
import conditionalReviewers from "./.agents/review-selection.json" with { type: "json" };
import { HARNESS_APP_REGISTRY } from "./scripts/harness-app-registry.ts";

/** Athena declares policy and sensors; the installed product evaluates them. */
export const ATHENA_PR_VALIDATION_GATE_ID = "athena.pr-validation";
const reviewWaivable = ["review_evidence_missing", "stale_evidence", "evidence_not_green", "unresolved_actionable_findings"];
const liveCheck = (id: string, provider: string, summary: string): ObligationPolicy => ({
  id,
  activation: { kind: "always" },
  freshness: "live",
  providers: [provider],
  acceptedPayloadSpecs: ["checks.passed/1"],
  allowedResolutionKinds: ["satisfied_live_fact", "not_applicable"],
  humanWaiverAllowed: false,
  minimumAttestationLevel: "self",
  ciDelegationPolicyIds: [],
  waivableCodes: [],
  nonWaivableCodes: [...GATE_STRUCTURAL_FINDING_CODES],
  remediation: { default: [{ id: `repair-${id.replaceAll(".", "-")}`, kind: "manual_action", summary }] },
});

export default defineHarnessConfig({
  gateId: ATHENA_PR_VALIDATION_GATE_ID,
  baseRef: "origin/main",
  storageNamespace: "delivery-harness/",
  acceptedEnvelopeSpecs: ["delivery-evidence/1"],
  identityVersions: [DELIVERABLE_TREE_V1],
  computingIdentityVersion: DELIVERABLE_TREE_V1,
  reviewNeutral: DELIVERABLE_TREE_V1_NARRATION_SET,
  recordNeutral: [{ prefix: "telemetry/delivery-runs/", suffix: ".json" }],
  pathClassification: {
    generated: [{ kind: "glob", value: "**/_generated/**" }, { kind: "prefix", value: "graphify-out/" }, { kind: "glob", value: "**/routeTree.gen.ts" }],
    test: [{ kind: "glob", value: "**/*.test.ts" }, { kind: "glob", value: "**/*.spec.ts" }, { kind: "glob", value: "**/tests/**" }],
    lockfile: [{ kind: "glob", value: "**/bun.lockb" }, { kind: "glob", value: "**/bun.lock" }],
  },
  sensitivePaths: HARNESS_APP_REGISTRY.flatMap(app => app.validationScenarios.filter(scenario => scenario.reviewSensitive).map(scenario => ({
    id: scenario.id,
    patterns: scenario.touchedPaths.map(value => ({ kind: "prefix" as const, value: `${app.packageDir}/${value}` })),
  }))),
  activationThreshold: 50,
  agentEnvSignals: ["CLAUDECODE", "CLAUDE_CODE", "CODEX_THREAD_ID", "CODEX_SANDBOX", "CODEX_INTERNAL_ORIGINATOR_OVERRIDE", "GITHUB_ACTIONS", "ATHENA_HARNESS_CI_POLICY"],
  ciPolicies: [],
  ciPolicyEnvKey: "DELIVERY_HARNESS_CI_POLICY",
  preparationWiringPaths: ["harness.config.ts", ".agents/review-selection.json", "package.json", "scripts/harness-app-registry.ts", "scripts/harness-mechanical-check.ts", "scripts/harness-review.ts", "scripts/bun-version-check.ts", "scripts/frontend-dependency-parity.ts", "scripts/pre-commit-generated-artifacts.ts"],
  preparationCommands: [
    { id: "athena-bun-version", command: ["bun", "scripts/bun-version-check.ts"], timeoutMs: 30000 },
    { id: "athena-dependency-parity", command: ["bun", "scripts/frontend-dependency-parity.ts", "--repair"], timeoutMs: 600000 },
    { id: "athena-generated-artifacts", command: ["bun", "run", "pre-commit:generated-artifacts"], timeoutMs: 600000 },
    { id: "athena-mechanical", command: ["bun", "run", "pr:athena:mechanical"], timeoutMs: 600000 },
  ],
  // The roster beyond the product's two mandated lenses is the executor's
  // selection for the candidate, declared in `.agents/review-selection.json`.
  // `.agents/skills/ce-code-review/SKILL.md` describes how an ordinary Athena
  // delivery populates that file; an empty file means this candidate selected
  // no reviewer beyond the mandated two.
  additionalReviewLenses: conditionalReviewers
    .map(entry => {
      if (!entry || Object.keys(entry).sort().join(",") !== "reason,reviewerId" || typeof entry.reason !== "string" || !entry.reason.trim()) {
        throw new Error("Each .agents/review-selection.json entry must name reviewerId and a nonempty selection reason.");
      }
      return entry.reviewerId;
    })
    .map(id => ({
      lensId: `athena.${id}`, reviewerId: id, charterPath: `.agents/agents/${id}.agent.md`,
    })),
  providers: [
    { id: "athena.independent-review", findingCodes: [] },
    { id: "athena.validation", findingCodes: [], check: { command: ["bun", "run", "harness:review", "--base", "origin/main"], timeoutMs: 3600000 } },
    { id: "athena.documentation-evidence", findingCodes: [], check: { command: ["bun", "scripts/delivery-documentation-admission.ts", "--json"], timeoutMs: 120000 } },
    { id: "athena.documentation", findingCodes: [], command: ["bun", "scripts/delivery-live-sensor.ts", "documentation"] },
    { id: "athena.telemetry", findingCodes: [], command: ["bun", "scripts/delivery-live-sensor.ts", "telemetry"] },
  ],
  obligations: [
    {
      id: "review.green", activation: { kind: "relevant_change" }, freshness: "exact_candidate",
      providers: ["athena.independent-review"], acceptedPayloadSpecs: ["review.green/1"],
      allowedResolutionKinds: ["satisfied_evidence", "waived", "not_applicable"], humanWaiverAllowed: true,
      minimumAttestationLevel: "self", ciDelegationPolicyIds: [], waivableCodes: reviewWaivable,
      nonWaivableCodes: GATE_STRUCTURAL_FINDING_CODES.filter(code => !reviewWaivable.includes(code)),
      remediation: { default: [{ id: "obtain-independent-review", kind: "manual_action", summary: "Prepare this candidate, complete every required independent review, and submit the product-emitted evidence." }] },
    },
    {
      ...liveCheck("validation.passed", "athena.validation", "Repair the failing Athena validation sensor and rerun pr:athena."),
      freshness: "exact_candidate", allowedResolutionKinds: ["satisfied_evidence", "not_applicable"],
    },
    { ...liveCheck("documentation.accepted", "athena.documentation-evidence", "Repair delivery documentation or obtain trusted human approval."), freshness: "exact_candidate", allowedResolutionKinds: ["satisfied_evidence", "not_applicable"] },
    liveCheck("documentation.current", "athena.documentation", "Repair delivery documentation or obtain an exact trusted human documentation approval."),
    liveCheck("telemetry.recorded", "athena.telemetry", "After the successful gate, record and stage the current product run export, then prepare and verify."),
  ],
  deliveryRecordPath: "telemetry/delivery-runs/delivery-record.json",
  deliveryRecordVerification: { baseMovement: "stale" },
});
