import { describe, expect, it } from "vitest";

import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
} from "./harness-gate-registry";
import {
  evaluateGateObligations,
  type CandidateBinding,
  type AttestedWaiverRecord,
  type EvaluateGateObligationsInput,
  type EvidenceRecord,
} from "./harness-gate-obligations";
import { HARNESS_REVIEW_IDENTITY_VERSION } from "./harness-review-identity";

const candidate: CandidateBinding = {
  treeSha: "tree-1",
  deliverableTreeSha: "deliverable-1",
  identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
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
      {
        providerId: "delivery-run-telemetry-check",
        runId: "telemetry-1",
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
  it("gives a malformed telemetry record its own regenerate remediation", () => {
    const decision = evaluateGateObligations(
      input({
        liveProviderResults: [
          {
            providerId: "delivery-documentation-check",
            runId: "docs-malformed",
            status: "green",
            findings: [],
          },
          {
            providerId: "delivery-run-telemetry-check",
            runId: "telemetry-malformed",
            status: "failed",
            findings: [
              {
                code: "telemetry_record_malformed",
                message: "Changed telemetry record is not a valid record.",
              },
            ],
          },
        ],
      }),
    );

    const malformed = decision.blockers.find(
      (blocker) => blocker.code === "telemetry_record_malformed",
    );
    // Distinct from `record-delivery-telemetry`: only the missing-record case
    // is waivable, and hand-editing a corrupt record is how the second bad
    // commit happens. A shared id would let the renderer print either.
    expect(malformed?.remediations.map((item) => item.id)).toEqual([
      "regenerate-delivery-telemetry",
    ]);
  });

  it("gives each documentation policy finding its own repair guidance", () => {
    const failingDocs = (code: string) => [
      {
        providerId: "delivery-documentation-check",
        runId: "docs-failing",
        status: "failed" as const,
        findings: [{ code, message: `${code} finding` }],
      },
      {
        providerId: "delivery-run-telemetry-check",
        runId: "telemetry-green-1",
        status: "green" as const,
        findings: [],
      },
    ];

    // Authoring a solution note and regenerating a landed-change report are
    // different repairs; neither may inherit the obligation's generic
    // repair-everything guidance.
    const compound = evaluateGateObligations(
      input({ liveProviderResults: failingDocs("compound-solution") }),
    );
    expect(
      compound.blockers
        .find((blocker) => blocker.code === "compound-solution")
        ?.remediations.map((item) => item.id),
    ).toEqual(["author-compound-solution-note"]);

    const report = evaluateGateObligations(
      input({ liveProviderResults: failingDocs("landed-change-report") }),
    );
    expect(
      report.blockers
        .find((blocker) => blocker.code === "landed-change-report")
        ?.remediations.map((item) => item.id),
    ).toEqual(["regenerate-landed-change-report"]);
  });

  it("keeps the obligation-level documentation remediation as fallback", () => {
    // A structural failure (no provider finding) has no per-code repair, so it
    // keeps the obligation's generic guidance.
    const decision = evaluateGateObligations(
      input({
        liveProviderResults: [
          {
            providerId: "delivery-documentation-check",
            runId: "docs-structural",
            status: "failed",
            findings: [],
          },
          {
            providerId: "delivery-run-telemetry-check",
            runId: "telemetry-green-2",
            status: "green",
            findings: [],
          },
        ],
      }),
    );

    expect(
      decision.blockers
        .find((blocker) => blocker.code === "live_provider_failed")
        ?.remediations.map((item) => item.id),
    ).toEqual(["repair-delivery-documentation"]);
  });

  it("uses the shared typed blocker contract without legacy projections", () => {
    const decision = evaluateGateObligations(input({ records: [] }));

    expect(decision.admitted).toBe(false);
    expect(decision.blockers).not.toHaveLength(0);
    expect(decision).not.toHaveProperty("findings");
    expect(decision).not.toHaveProperty("remediation");
    expect(decision.blockers[0]).toMatchObject({
      source: { kind: "obligation" },
      remediations: [expect.objectContaining({ id: expect.any(String) })],
    });
  });

  it("honors an attested documentation waiver in repository CI", () => {
    const waiver: AttestedWaiverRecord = {
      schemaVersion: 1,
      kind: "attested_waiver",
      recordId: "github-check:123",
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      obligationId: "documentation.current",
      candidate,
      approvedBy: "human-reviewer",
      attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
    };
    const decision = evaluateGateObligations(
      input({
        executionContext: {
          kind: "repository_ci",
          policyId: "athena-pr-tests",
        },
        liveProviderResults: [
          {
            providerId: "delivery-documentation-check",
            runId: "docs-blocked",
            status: "failed",
            findings: [
              {
                code: "compound-solution",
                message: "Solution note is missing",
              },
            ],
          },
          {
            providerId: "delivery-run-telemetry-check",
            runId: "telemetry-green",
            status: "green",
            findings: [],
          },
        ],
        records: [waiver],
      }),
    );

    expect(decision.admitted).toBe(true);
    expect(resolution(decision, "documentation.current")).toMatchObject({
      kind: "waived",
      waiverRecordId: "github-check:123",
      approvedBy: "human-reviewer",
      attestationUrl: "https://github.com/v26-labs/athena/actions/runs/456",
    });
  });

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
              },
              {
                code: "landed_report_stale",
                message: "Landed-change report is stale",
              },
            ],
          },
          {
            providerId: "delivery-run-telemetry-check",
            runId: "telemetry-2",
            status: "green",
            findings: [],
          },
        ],
      }),
    );

    expect(decision.admitted).toBe(false);
    expect(decision.blockers.map((blocker) => blocker.code)).toEqual([
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
      blockers: [
        expect.objectContaining({
          code: "review_evidence_missing",
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
          candidate: { ...candidate, deliverableTreeSha: "deliverable-old" },
        }),
      ],
      [
        evidence("ce-code-review", {
          candidate: { ...candidate, baseTipSha: "base-tip-moved" },
        }),
      ],
      [
        evidence("ce-code-review", {
          candidate: { ...candidate, diffBaseSha: "merge-base-moved" },
        }),
      ],
      [
        evidence("ce-code-review", {
          candidate: { ...candidate, worktreeId: "worktree-other" },
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

  it("keeps evidence current when only review-neutral content moved the raw tree", () => {
    const decision = evaluateGateObligations(
      input({
        records: [
          evidence("ce-code-review", {
            candidate: { ...candidate, treeSha: "tree-before-report" },
          }),
        ],
      }),
    );

    expect(decision.admitted).toBe(true);
    expect(resolution(decision, "review.green")).toMatchObject({
      kind: "satisfied_evidence",
      candidate: { deliverableTreeSha: candidate.deliverableTreeSha },
    });
  });

  it("rejects evidence recorded under a different or missing identity version", () => {
    for (const identityVersion of ["deliverable-tree/v0", undefined]) {
      const decision = evaluateGateObligations(
        input({
          records: [
            evidence("ce-code-review", {
              candidate: {
                ...candidate,
                identityVersion,
              } as CandidateBinding,
            }),
          ],
        }),
      );

      expect(decision.admitted).toBe(false);
      expect(resolution(decision, "review.green")?.kind).toBe("blocked");
    }
  });

  it("rejects legacy evidence even when the current candidate also lacks an identity", () => {
    // Pins the non-empty guard itself: without it, two absent digests would
    // compare equal and a pre-identity record would authorize the gate.
    const legacyCandidate = { ...candidate } as Partial<CandidateBinding>;
    delete legacyCandidate.deliverableTreeSha;
    const decision = evaluateGateObligations(
      input({
        candidate: legacyCandidate as CandidateBinding,
        records: [
          evidence("ce-code-review", {
            candidate: legacyCandidate as CandidateBinding,
          }),
        ],
      }),
    );

    expect(decision.admitted).toBe(false);
    expect(resolution(decision, "review.green")).toMatchObject({
      kind: "blocked",
      blockers: [expect.objectContaining({ code: "stale_evidence" })],
    });
  });

  it("rejects legacy evidence that carries no deliverable identity", () => {
    const legacyCandidate = { ...candidate } as Partial<CandidateBinding>;
    delete legacyCandidate.deliverableTreeSha;
    const decision = evaluateGateObligations(
      input({
        records: [
          evidence("ce-code-review", {
            candidate: legacyCandidate as CandidateBinding,
          }),
        ],
      }),
    );

    expect(decision.admitted).toBe(false);
    expect(resolution(decision, "review.green")).toMatchObject({
      kind: "blocked",
      blockers: [expect.objectContaining({ code: "stale_evidence" })],
    });
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

  it("honors a human waiver for a live obligation, but never for an agent", () => {
    const failingTelemetry = [
      {
        providerId: "delivery-documentation-check" as const,
        runId: "docs-3",
        status: "green" as const,
        findings: [],
      },
      {
        providerId: "delivery-run-telemetry-check" as const,
        runId: "telemetry-3",
        status: "failed" as const,
        findings: [
          {
            code: "telemetry_record_missing",
            message: "No telemetry record for this delivery",
          },
        ],
      },
    ];
    // Live obligations honor invocation-scoped waivers only: they are
    // re-evaluated from scratch each run, so a durable record must not carry a
    // waiver — possibly granted for a different failure — into later runs.
    const waiver = {
      schemaVersion: 1 as const,
      kind: "waiver" as const,
      recordId: "invocation:waiver-telemetry-1",
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      obligationId: "telemetry.recorded" as const,
      candidate,
    };

    // A waiver must work the same whether the obligation is satisfied by
    // historical evidence or by a live provider.
    expect(
      resolution(
        evaluateGateObligations(
          input({
            executionContext: { kind: "interactive_human" },
            liveProviderResults: failingTelemetry,
            records: [evidence(), waiver],
          }),
        ),
        "telemetry.recorded",
      ),
    ).toMatchObject({
      kind: "waived",
      waiverRecordId: "invocation:waiver-telemetry-1",
    });

    // The same waiver, published durably, must not admit a later run.
    expect(
      resolution(
        evaluateGateObligations(
          input({
            executionContext: { kind: "interactive_human" },
            liveProviderResults: failingTelemetry,
            records: [
              evidence(),
              { ...waiver, recordId: "durable-waiver-telemetry-1" },
            ],
          }),
        ),
        "telemetry.recorded",
      )?.kind,
    ).toBe("blocked");

    const agentDecision = evaluateGateObligations(
      input({
        executionContext: { kind: "agent", signal: "CODEX_THREAD_ID" },
        liveProviderResults: failingTelemetry,
        records: [evidence(), waiver],
      }),
    );
    expect(resolution(agentDecision, "telemetry.recorded")?.kind).toBe(
      "blocked",
    );
    expect(agentDecision.admitted).toBe(false);
  });

  it("selects the lexicographically first waiver when several apply", () => {
    // Deterministic selection so the reported waiverRecordId is stable across
    // runs when a candidate carries more than one waiver record.
    const waiverFor = (recordId: string) => ({
      schemaVersion: 1 as const,
      kind: "waiver" as const,
      recordId,
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      obligationId: "review.green" as const,
      candidate,
    });

    expect(
      resolution(
        evaluateGateObligations(
          input({
            executionContext: { kind: "interactive_human" },
            records: [waiverFor("waiver-b"), waiverFor("waiver-a")],
          }),
        ),
        "review.green",
      ),
    ).toMatchObject({ kind: "waived", waiverRecordId: "waiver-a" });
  });

  it("keeps a historical obligation's waiver durable", () => {
    // The invocation-scoping rule applies to live obligations only; review.green
    // waivers must still carry across runs for the same candidate.
    expect(
      resolution(
        evaluateGateObligations(
          input({
            executionContext: { kind: "interactive_human" },
            records: [
              {
                schemaVersion: 1 as const,
                kind: "waiver" as const,
                recordId: "durable-review-waiver",
                gateId: ATHENA_PR_VALIDATION_GATE_ID,
                obligationId: "review.green" as const,
                candidate,
              },
            ],
          }),
        ),
        "review.green",
      ),
    ).toMatchObject({
      kind: "waived",
      waiverRecordId: "durable-review-waiver",
    });
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
      blockers: [expect.objectContaining({ code: "corrupt_record" })],
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
      blockers: [expect.objectContaining({ code: "ambiguous_records" })],
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
