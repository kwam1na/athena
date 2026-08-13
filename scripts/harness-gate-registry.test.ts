import { describe, expect, it } from "vitest";

import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
  validateHarnessGateRegistry,
  type HarnessGateRegistry,
} from "./harness-gate-registry";

const knownSensitiveScenarioIds = [
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
];

describe("HARNESS_GATE_REGISTRY", () => {
  it("declares the Athena cost boundary and its reusable obligations", () => {
    expect(
      HARNESS_GATE_REGISTRY.gates[ATHENA_PR_VALIDATION_GATE_ID],
    ).toMatchObject({
      preventedCostClass: "merge_grade_validation",
      admissionEntrypoint: "pr:athena:validate-provider",
      publicEntrypoints: [
        "pr:athena",
        "pr:athena:validate",
        "pr:athena:validate-provider",
      ],
      obligationIds: ["review.green", "documentation.current"],
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
    });

    expect(HARNESS_GATE_REGISTRY.obligations["review.green"]).toMatchObject({
      providerPolicy: "existential",
      providerIds: ["ce-code-review", "execute"],
      allowedResolutionKinds: [
        "satisfied_evidence",
        "waived",
        "delegated",
        "not_applicable",
      ],
      // The declared freshness must keep naming what the evaluator actually
      // compares: the candidate's deliverable identity, not its raw tree SHA.
      freshness: {
        kind: "exact_candidate",
        requireDeliverableTreeSha: true,
        requireBaseRef: true,
        requireBaseTipSha: true,
        requireWorktreeId: true,
      },
      activation: {
        kind: "review_projection",
        minimumRelevantChangedLines: 50,
      },
    });

    expect(
      HARNESS_GATE_REGISTRY.obligations["documentation.current"],
    ).toMatchObject({
      providerPolicy: "all",
      providerIds: ["delivery-documentation-check"],
      allowedResolutionKinds: ["satisfied_live_fact"],
      freshness: { kind: "live" },
      activation: { kind: "always" },
    });

    expect(
      validateHarnessGateRegistry(
        HARNESS_GATE_REGISTRY,
        knownSensitiveScenarioIds,
      ),
    ).toEqual([]);
  });

  it("reports unknown obligation and sensitive-scenario references", () => {
    const registry = structuredClone(
      HARNESS_GATE_REGISTRY,
    ) as HarnessGateRegistry;
    registry.gates[ATHENA_PR_VALIDATION_GATE_ID].obligationIds.push(
      "missing.obligation",
    );
    registry.obligations["review.green"].activation = {
      kind: "review_projection",
      minimumRelevantChangedLines: 50,
      sensitiveScenarioIds: ["missing.scenario"],
      relevantBinaryChangeActivates: true,
    };

    expect(
      validateHarnessGateRegistry(registry, knownSensitiveScenarioIds),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("unknown obligation missing.obligation"),
        expect.stringContaining("unknown sensitive scenario missing.scenario"),
      ]),
    );
  });

  it("reports duplicate stable IDs even when object keys differ", () => {
    const registry = structuredClone(
      HARNESS_GATE_REGISTRY,
    ) as HarnessGateRegistry;
    registry.providers.alias = {
      ...registry.providers["ce-code-review"],
    };

    expect(
      validateHarnessGateRegistry(registry, knownSensitiveScenarioIds),
    ).toContain("Duplicate provider id ce-code-review");
  });
});
