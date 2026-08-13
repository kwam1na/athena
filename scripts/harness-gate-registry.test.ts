import { readFileSync } from "node:fs";

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
      obligationIds: [
        "review.green",
        "documentation.current",
        "telemetry.recorded",
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
      HARNESS_GATE_REGISTRY.obligations["telemetry.recorded"],
    ).toMatchObject({
      providerPolicy: "all",
      providerIds: ["delivery-run-telemetry-check"],
      allowedResolutionKinds: ["satisfied_live_fact", "waived"],
      freshness: { kind: "live" },
      activation: { kind: "always" },
      // An interactive human gets the same escape hatch review.green grants
      // them; agents never reach the waiver path, which is the population this
      // obligation exists to hold to account.
      humanWaiverAllowed: true,
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

  it.each([
    [
      "a permitted waiver whose resolution kind is disallowed",
      (registry: HarnessGateRegistry) => {
        registry.obligations["documentation.current"].humanWaiverAllowed = true;
      },
      'Obligation documentation.current allows a human waiver but omits "waived"',
    ],
    [
      "an allowed waived resolution no human may produce",
      (registry: HarnessGateRegistry) => {
        registry.obligations["documentation.current"].allowedResolutionKinds =
          ["satisfied_live_fact", "waived"];
      },
      'Obligation documentation.current allows the "waived" resolution but sets humanWaiverAllowed false',
    ],
  ])("reports %s", (_label, mutate, expected) => {
    // Either half alone is silent at runtime: the waiver is unproducible, or
    // the block is indistinguishable from a declined waiver.
    const registry = structuredClone(
      HARNESS_GATE_REGISTRY,
    ) as HarnessGateRegistry;
    mutate(registry);

    expect(
      validateHarnessGateRegistry(registry, knownSensitiveScenarioIds),
    ).toEqual(expect.arrayContaining([expect.stringContaining(expected)]));
  });

  it("keeps obligation remediation pointing at commands that exist", () => {
    // Remediation text is the only instruction a blocked human gets, so a
    // renamed package script must not leave it naming a command that is gone.
    const scripts = Object.keys(
      JSON.parse(readFileSync("package.json", "utf8")).scripts as Record<
        string,
        string
      >,
    );
    const referenced = Object.values(HARNESS_GATE_REGISTRY.obligations)
      .flatMap((obligation) => [
        obligation.remediation.machine,
        obligation.remediation.human,
      ])
      .flatMap((text) => [...text.matchAll(/`bun run ([a-z0-9:_-]+)`/g)])
      .map((match) => match[1]);

    expect(referenced.length).toBeGreaterThan(0);
    for (const script of referenced) {
      expect(scripts).toContain(script);
    }
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
