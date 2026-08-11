import { describe, expect, it } from "vitest";

import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
} from "./harness-gate-registry";
import {
  evaluateGateObligations,
  type CandidateBinding,
  type EvaluateGateObligationsInput,
  type EvidenceRecord,
} from "./harness-gate-obligations";

const candidate: CandidateBinding = {
  treeSha: "tree-1",
  baseRef: "origin/main",
  baseTipSha: "base-tip-1",
  diffBaseSha: "merge-base-1",
  worktreeId: "worktree-1",
};

function evidence(
  providerId: "ce-code-review" | "execute" = "ce-code-review",
  overrides: Partial<EvidenceRecord> = {},
): EvidenceRecord {
  return {
    schemaVersion: 1,
    kind: "evidence",
    recordId: `${providerId}-record-1`,
    gateId: ATHENA_PR_VALIDATION_GATE_ID,
    obligationId: "review.green",
    providerId,
    runId: `${providerId}-run-1`,
    finalPassId: "pass-1",
    candidate,
    verdict: "green",
    unresolvedActionableCount: 0,
    ...overrides,
  };
}

function input(
  overrides: Partial<EvaluateGateObligationsInput> = {},
): EvaluateGateObligationsInput {
  return {
    registry: HARNESS_GATE_REGISTRY,
    gateId: ATHENA_PR_VALIDATION_GATE_ID,
    candidate,
    reviewProjection: {
      relevantChangedLines: 50,
      matchedSensitiveScenarioIds: [],
      hasRelevantBinaryChange: false,
    },
    executionContext: { kind: "agent", signal: "CODEX_THREAD_ID" },
    liveProviderResults: [
      {
        providerId: "delivery-documentation-check",
        runId: "docs-1",
        status: "green",
        findings: [],
      },
    ],
    records: [evidence()],
    ...overrides,
  };
}

function resolution(
  decision: ReturnType<typeof evaluateGateObligations>,
  obligationId: string,
) {
  return decision.resolutions.find(
    (entry) => entry.obligationId === obligationId,
  );
}

describe("evaluateGateObligations", () => {
  it.each(["ce-code-review", "execute"] as const)(
    "accepts fresh final-green evidence from approved provider %s",
    (providerId) => {
      const decision = evaluateGateObligations(
        input({ records: [evidence(providerId)] }),
      );

      expect(decision.admitted).toBe(true);
      expect(resolution(decision, "review.green")).toMatchObject({
        kind: "satisfied_evidence",
        providerId,
        candidate,
      });
      expect(resolution(decision, "documentation.current")).toMatchObject({
        kind: "satisfied_live_fact",
        providerId: "delivery-documentation-check",
      });
    },
  );

  it("reports review as not applicable below threshold while retaining live facts", () => {
    const decision = evaluateGateObligations(
      input({
        reviewProjection: {
          relevantChangedLines: 49,
          matchedSensitiveScenarioIds: [],
          hasRelevantBinaryChange: false,
        },
        records: [],
      }),
    );

    expect(decision.admitted).toBe(true);
    expect(resolution(decision, "review.green")).toMatchObject({
      kind: "not_applicable",
    });
    expect(resolution(decision, "documentation.current")?.kind).toBe(
      "satisfied_live_fact",
    );
  });

  it("activates review at the inclusive threshold, for sensitivity, or for binary changes", () => {
    for (const reviewProjection of [
      {
        relevantChangedLines: 50,
        matchedSensitiveScenarioIds: [],
        hasRelevantBinaryChange: false,
      },
      {
        relevantChangedLines: 0,
        matchedSensitiveScenarioIds: ["athena.cash-controls"],
        hasRelevantBinaryChange: false,
      },
      {
        relevantChangedLines: 0,
        matchedSensitiveScenarioIds: [],
        hasRelevantBinaryChange: true,
      },
    ]) {
      const decision = evaluateGateObligations(
        input({ reviewProjection, records: [] }),
      );
      expect(resolution(decision, "review.green")?.kind).toBe("blocked");
    }
  });

  it("aggregates deterministic documentation findings with missing review", () => {
    const decision = evaluateGateObligations(
      input({
        records: [],
        liveProviderResults: [
          {
            providerId: "delivery-documentation-check",
            runId: "docs-2",
            status: "failed",
            findings: [
              {
                code: "solution_note_stale",
                message: "Solution note is stale",
                remediation: "Update the solution note",
              },
              {
                code: "landed_report_stale",
                message: "Landed-change report is stale",
                remediation: "Regenerate the landed-change report",
              },
            ],
          },
        ],
      }),
    );

    expect(decision.admitted).toBe(false);
    expect(decision.findings.map((finding) => finding.code)).toEqual([
      "review_evidence_missing",
      "solution_note_stale",
      "landed_report_stale",
    ]);
  });

  it("lets a fresh approved existential provider demote malformed neighbors to diagnostics", () => {
    const decision = evaluateGateObligations(
      input({
        records: [
          {
            kind: "invalid",
            gateId: ATHENA_PR_VALIDATION_GATE_ID,
            obligationId: "review.green",
            providerId: "execute",
            appliesToCandidate: true,
            code: "corrupt_record",
            message: "Malformed execute record",
          },
          evidence("ce-code-review"),
        ],
      }),
    );

    expect(decision.admitted).toBe(true);
    expect(decision.diagnostics).toEqual([
      expect.objectContaining({ code: "corrupt_record" }),
    ]);
  });

  it("requires every approved provider when historical policy is all", () => {
    const registry = structuredClone(HARNESS_GATE_REGISTRY);
    registry.obligations["review.green"].providerPolicy = "all";

    const incomplete = evaluateGateObligations(
      input({ registry, records: [evidence("ce-code-review")] }),
    );
    expect(resolution(incomplete, "review.green")).toMatchObject({
      kind: "blocked",
      findings: [
        expect.objectContaining({
          code: "review_evidence_missing",
          providerId: "execute",
        }),
      ],
    });

    const complete = evaluateGateObligations(
      input({
        registry,
        records: [evidence("ce-code-review"), evidence("execute")],
      }),
    );
    expect(complete.admitted).toBe(true);
  });

  it("admits an existential live obligation when any approved provider is green", () => {
    const registry = structuredClone(HARNESS_GATE_REGISTRY);
    registry.obligations["documentation.current"].providerPolicy =
      "existential";
    registry.obligations["documentation.current"].providerIds.push("execute");

    const decision = evaluateGateObligations(input({ registry }));

    expect(decision.admitted).toBe(true);
    expect(decision.diagnostics).toEqual([
      expect.objectContaining({
        code: "live_provider_missing",
        providerId: "execute",
      }),
    ]);
  });

  it("blocks malformed, stale, unknown, non-green, and unresolved records without a fresh provider", () => {
    const cases: EvaluateGateObligationsInput["records"][] = [
      [
        {
          kind: "invalid",
          gateId: ATHENA_PR_VALIDATION_GATE_ID,
          obligationId: "review.green",
          providerId: "ce-code-review",
          appliesToCandidate: true,
          code: "unsupported_schema",
          message: "Unsupported schema",
        },
      ],
      [
        evidence("ce-code-review", {
          candidate: { ...candidate, treeSha: "old" },
        }),
      ],
      [evidence("ce-code-review", { providerId: "unknown-provider" })],
      [evidence("ce-code-review", { verdict: "non_green" })],
      [evidence("ce-code-review", { unresolvedActionableCount: 1 })],
    ];

    for (const records of cases) {
      const decision = evaluateGateObligations(input({ records }));
      expect(decision.admitted).toBe(false);
      expect(resolution(decision, "review.green")?.kind).toBe("blocked");
    }
  });

  it("uses evidence before waiver, ignores waivers for agents, and supports authorized delegation", () => {
    const waiver = {
      schemaVersion: 1 as const,
      kind: "waiver" as const,
      recordId: "waiver-1",
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      obligationId: "review.green" as const,
      candidate,
    };

    expect(
      resolution(
        evaluateGateObligations(
          input({
            executionContext: { kind: "interactive_human" },
            records: [waiver, evidence()],
          }),
        ),
        "review.green",
      )?.kind,
    ).toBe("satisfied_evidence");

    expect(
      resolution(
        evaluateGateObligations(input({ records: [waiver] })),
        "review.green",
      )?.kind,
    ).toBe("blocked");

    expect(
      resolution(
        evaluateGateObligations(
          input({
            executionContext: { kind: "interactive_human" },
            records: [waiver],
          }),
        ),
        "review.green",
      )?.kind,
    ).toBe("waived");

    expect(
      resolution(
        evaluateGateObligations(
          input({
            executionContext: {
              kind: "repository_ci",
              policyId: "athena-pr-tests",
            },
            records: [],
          }),
        ),
        "review.green",
      )?.kind,
    ).toBe("delegated");
  });

  it("does not let a waiver hide an applicable malformed record", () => {
    const decision = evaluateGateObligations(
      input({
        executionContext: { kind: "interactive_human" },
        records: [
          {
            schemaVersion: 1,
            kind: "waiver",
            recordId: "waiver-1",
            gateId: ATHENA_PR_VALIDATION_GATE_ID,
            obligationId: "review.green",
            candidate,
          },
          {
            kind: "invalid",
            gateId: ATHENA_PR_VALIDATION_GATE_ID,
            obligationId: "review.green",
            providerId: "ce-code-review",
            appliesToCandidate: true,
            code: "corrupt_record",
            message: "Malformed review record",
          },
        ],
      }),
    );

    expect(resolution(decision, "review.green")).toMatchObject({
      kind: "blocked",
      findings: [expect.objectContaining({ code: "corrupt_record" })],
    });
  });

  it("blocks incompatible records in the same provider run slot", () => {
    const decision = evaluateGateObligations(
      input({
        records: [
          evidence("ce-code-review"),
          evidence("ce-code-review", { recordId: "conflicting-record" }),
        ],
      }),
    );

    expect(resolution(decision, "review.green")).toMatchObject({
      kind: "blocked",
      findings: [expect.objectContaining({ code: "ambiguous_records" })],
    });
  });

  it("returns deterministic, immutable decisions for identical inputs", () => {
    const evaluationInput = input();
    const before = structuredClone(evaluationInput);

    expect(evaluateGateObligations(evaluationInput)).toEqual(
      evaluateGateObligations(evaluationInput),
    );
    expect(evaluationInput).toEqual(before);
  });
});
