export const ATHENA_PR_VALIDATION_GATE_ID = "athena.pr-validation" as const;

export type HarnessGateId = typeof ATHENA_PR_VALIDATION_GATE_ID;
export type HarnessObligationId = "review.green" | "documentation.current";
export type HistoricalReviewProviderId = "ce-code-review" | "execute";
export type HarnessProviderId =
  | HistoricalReviewProviderId
  | "delivery-documentation-check";
export type HarnessCiPolicyId = "athena-pr-tests";
export type PreventedCostClass = "merge_grade_validation";

export type ObligationResolutionKind =
  | "satisfied_live_fact"
  | "satisfied_evidence"
  | "waived"
  | "delegated"
  | "not_applicable"
  | "blocked";

export type AllowedObligationResolutionKind = Exclude<
  ObligationResolutionKind,
  "blocked"
>;

export type ObligationActivation =
  | { kind: "always" }
  | {
      kind: "review_projection";
      minimumRelevantChangedLines: number;
      sensitiveScenarioIds: string[];
      relevantBinaryChangeActivates: boolean;
    };

export type ObligationFreshness =
  | { kind: "live" }
  | {
      kind: "exact_candidate";
      /**
       * Freshness binds the candidate's deliverable identity, not its raw tree
       * SHA: delivery narration under docs/reports/ and docs/solutions/ may move
       * the raw tree without changing what a reviewer approved. See
       * scripts/harness-review-identity.ts.
       */
      requireDeliverableTreeSha: true;
      requireBaseRef: true;
      requireBaseTipSha: true;
      requireWorktreeId: true;
    };

export type HarnessObligationDefinition = {
  id: HarnessObligationId;
  description: string;
  activation: ObligationActivation;
  providerIds: HarnessProviderId[];
  providerPolicy: "all" | "existential";
  freshness: ObligationFreshness;
  allowedResolutionKinds: AllowedObligationResolutionKind[];
  humanWaiverAllowed: boolean;
  ciDelegationPolicyIds: HarnessCiPolicyId[];
  remediation: {
    machine: string;
    human: string;
  };
};

export type HarnessObligationProviderDefinition = {
  id: HarnessProviderId;
  kind: "historical_evidence" | "live_deterministic";
};

export type HarnessCiPolicyDefinition = {
  id: HarnessCiPolicyId;
  gateId: HarnessGateId;
  delegatedObligationIds: HarnessObligationId[];
};

export type HarnessGateDefinition = {
  id: HarnessGateId;
  obligationIds: string[];
  preventedCostClass: PreventedCostClass;
  admissionEntrypoint: string;
  publicEntrypoints: string[];
  privateProviderCommands: string[][];
};

export type HarnessGateRegistry = {
  schemaVersion: 1;
  gates: Record<string, HarnessGateDefinition>;
  obligations: Record<string, HarnessObligationDefinition>;
  providers: Record<string, HarnessObligationProviderDefinition>;
  ciPolicies: Record<string, HarnessCiPolicyDefinition>;
};

const REVIEW_SENSITIVE_SCENARIO_IDS = [
  "athena.shared-demo-admission",
  "athena.cash-controls",
  "athena.pos-item-adjustment",
  "athena.pos-mixed-checkout",
  "athena.auth-staff-store-configuration",
  "athena.omnichannel-order-refund",
  "athena.pos-app-session-continuity",
  "athena.pos-offline-route-access",
  "storefront.checkout-auth-boundary",
  "storefront.payment-redirect-journeys",
] as const;

export const HARNESS_GATE_REGISTRY: HarnessGateRegistry = {
  schemaVersion: 1,
  gates: {
    [ATHENA_PR_VALIDATION_GATE_ID]: {
      id: ATHENA_PR_VALIDATION_GATE_ID,
      obligationIds: ["review.green", "documentation.current"],
      preventedCostClass: "merge_grade_validation",
      admissionEntrypoint: "pr:athena:validate-provider",
      publicEntrypoints: [
        "pr:athena",
        "pr:athena:validate",
        "pr:athena:validate-provider",
      ],
      privateProviderCommands: [
        ["bun", "run", "reports:presentation:check"],
        ["bun", "run", "docs:links:check"],
        ["bun", "run", "workflow:check"],
        ["bun", "run", "--filter", "@athena/webapp", "audit:convex"],
        ["bun", "run", "--filter", "@athena/webapp", "lint:convex:changed"],
        ["bun", "run", "--filter", "@athena/webapp", "lint:frontend:changed"],
        ["bun", "run", "architecture:check"],
        [
          "bunx",
          "tsc",
          "--noEmit",
          "-p",
          "packages/athena-webapp/tsconfig.json",
        ],
        ["bun", "run", "test:coverage"],
      ],
    },
  },
  obligations: {
    "review.green": {
      id: "review.green",
      description:
        "The exact prepared candidate completed an approved final-green review.",
      activation: {
        kind: "review_projection",
        minimumRelevantChangedLines: 50,
        sensitiveScenarioIds: [...REVIEW_SENSITIVE_SCENARIO_IDS],
        relevantBinaryChangeActivates: true,
      },
      providerIds: ["ce-code-review", "execute"],
      providerPolicy: "existential",
      freshness: {
        kind: "exact_candidate",
        requireDeliverableTreeSha: true,
        requireBaseRef: true,
        requireBaseTipSha: true,
        requireWorktreeId: true,
      },
      allowedResolutionKinds: [
        "satisfied_evidence",
        "waived",
        "delegated",
        "not_applicable",
      ],
      humanWaiverAllowed: true,
      ciDelegationPolicyIds: ["athena-pr-tests"],
      remediation: {
        machine:
          "Complete an approved final-green review for the prepared candidate and record its evidence.",
        human:
          "Run the approved review workflow for this candidate, or deliberately accept the offered human waiver.",
      },
    },
    "documentation.current": {
      id: "documentation.current",
      description:
        "The current candidate satisfies delivery documentation policy.",
      activation: { kind: "always" },
      providerIds: ["delivery-documentation-check"],
      providerPolicy: "all",
      freshness: { kind: "live" },
      allowedResolutionKinds: ["satisfied_live_fact"],
      humanWaiverAllowed: false,
      ciDelegationPolicyIds: [],
      remediation: {
        machine:
          "Repair every delivery documentation finding and evaluate again.",
        human: "Update the required delivery documentation and evaluate again.",
      },
    },
  },
  providers: {
    "ce-code-review": {
      id: "ce-code-review",
      kind: "historical_evidence",
    },
    execute: { id: "execute", kind: "historical_evidence" },
    "delivery-documentation-check": {
      id: "delivery-documentation-check",
      kind: "live_deterministic",
    },
  },
  ciPolicies: {
    "athena-pr-tests": {
      id: "athena-pr-tests",
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      delegatedObligationIds: ["review.green"],
    },
  },
};

function duplicateIdFindings(
  kind: string,
  definitions: Record<string, { id: string }>,
) {
  const findings: string[] = [];
  const seen = new Set<string>();
  for (const definition of Object.values(definitions)) {
    if (seen.has(definition.id)) {
      findings.push(`Duplicate ${kind} id ${definition.id}`);
    }
    seen.add(definition.id);
  }
  return findings;
}

export function validateHarnessGateRegistry(
  registry: HarnessGateRegistry,
  knownScenarioIds: readonly string[],
) {
  const findings = [
    ...duplicateIdFindings("gate", registry.gates),
    ...duplicateIdFindings("obligation", registry.obligations),
    ...duplicateIdFindings("provider", registry.providers),
    ...duplicateIdFindings("CI policy", registry.ciPolicies),
  ];
  const scenarioIds = new Set(knownScenarioIds);

  for (const gate of Object.values(registry.gates)) {
    for (const obligationId of gate.obligationIds) {
      if (!registry.obligations[obligationId]) {
        findings.push(
          `Gate ${gate.id} references unknown obligation ${obligationId}`,
        );
      }
    }
  }

  for (const obligation of Object.values(registry.obligations)) {
    for (const providerId of obligation.providerIds) {
      if (!registry.providers[providerId]) {
        findings.push(
          `Obligation ${obligation.id} references unknown provider ${providerId}`,
        );
      }
    }
    for (const policyId of obligation.ciDelegationPolicyIds) {
      const policy = registry.ciPolicies[policyId];
      if (!policy || !policy.delegatedObligationIds.includes(obligation.id)) {
        findings.push(
          `Obligation ${obligation.id} references invalid CI policy ${policyId}`,
        );
      }
    }
    if (obligation.activation.kind === "review_projection") {
      for (const scenarioId of obligation.activation.sensitiveScenarioIds) {
        if (!scenarioIds.has(scenarioId)) {
          findings.push(
            `Obligation ${obligation.id} references unknown sensitive scenario ${scenarioId}`,
          );
        }
      }
    }
  }

  for (const policy of Object.values(registry.ciPolicies)) {
    if (!registry.gates[policy.gateId]) {
      findings.push(
        `CI policy ${policy.id} references unknown gate ${policy.gateId}`,
      );
    }
    for (const obligationId of policy.delegatedObligationIds) {
      if (!registry.obligations[obligationId]) {
        findings.push(
          `CI policy ${policy.id} references unknown obligation ${obligationId}`,
        );
      }
    }
  }

  return findings.sort((left, right) => left.localeCompare(right));
}
