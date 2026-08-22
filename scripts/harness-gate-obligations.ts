import type {
  HarnessCiPolicyId,
  HarnessGateDefinition,
  HarnessGateRegistry,
  HarnessObligationDefinition,
  HarnessObligationId,
  HarnessProviderId,
  PreventedCostClass,
} from "./harness-gate-registry";
import {
  HARNESS_REVIEW_IDENTITY_VERSION,
  type HarnessReviewIdentityVersion,
} from "./harness-review-identity";
import {
  createHarnessBlocker,
  type HarnessBlocker,
  type HarnessBlockerSource,
  type HarnessRemediation,
} from "./harness-blockers";

export type CandidateBinding = {
  /** The exact prepared tree. Recorded for audit, not used for freshness. */
  treeSha: string;
  /** Identity of the reviewable content inside `treeSha`. */
  deliverableTreeSha: string;
  identityVersion: HarnessReviewIdentityVersion;
  baseRef: string;
  baseTipSha: string;
  diffBaseSha: string;
  worktreeId: string;
};

export type ReviewActivationProjection = {
  relevantChangedLines: number;
  matchedSensitiveScenarioIds: string[];
  hasRelevantBinaryChange: boolean;
};

export type HarnessExecutionContext =
  | { kind: "repository_ci"; policyId: string }
  | {
      kind: "agent";
      signal:
        | "CODEX_THREAD_ID"
        | "CODEX_INTERNAL_ORIGINATOR_OVERRIDE"
        | "CODEX_CI"
        | "CLAUDE_CODE";
    }
  | { kind: "interactive_human" }
  | { kind: "unknown"; reason?: string };

export type ObligationFinding = {
  code: string;
  message: string;
  obligationId?: string;
  providerId?: string;
  recordId?: string;
  blocker: HarnessBlocker;
};

export type LiveProviderFinding = Pick<ObligationFinding, "code" | "message">;

export type LiveProviderResult = {
  providerId: string;
  runId: string;
  status: "green" | "failed";
  findings: LiveProviderFinding[];
};

export type EvidenceRecord = {
  schemaVersion: 1;
  kind: "evidence";
  recordId: string;
  gateId: string;
  obligationId: string;
  providerId: string;
  runId: string;
  finalPassId: string;
  candidate: CandidateBinding;
  verdict: "green" | "non_green";
  unresolvedActionableCount: number;
};

export type WaiverRecord = {
  schemaVersion: 1;
  kind: "waiver";
  recordId: string;
  gateId: string;
  obligationId: string;
  candidate: CandidateBinding;
};

export type AttestedWaiverRecord = {
  schemaVersion: 1;
  kind: "attested_waiver";
  recordId: string;
  gateId: string;
  obligationId: "documentation.current";
  candidate: CandidateBinding;
  approvedBy: string;
  attestationUrl: string;
};

export type InvalidObligationRecord = {
  kind: "invalid";
  gateId: string;
  obligationId: string;
  providerId?: string;
  recordId?: string;
  appliesToCandidate: boolean;
  code: string;
  message: string;
};

export type DiscoveredObligationRecord =
  | EvidenceRecord
  | WaiverRecord
  | AttestedWaiverRecord
  | InvalidObligationRecord;

type ResolutionBase = {
  gateId: string;
  obligationId: HarnessObligationId;
};

export type SatisfiedLiveFactResolution = ResolutionBase & {
  kind: "satisfied_live_fact";
  providerId: HarnessProviderId;
  runId: string;
};

export type SatisfiedEvidenceResolution = ResolutionBase & {
  kind: "satisfied_evidence";
  providerId: HarnessProviderId;
  recordId: string;
  runId: string;
  finalPassId: string;
  candidate: CandidateBinding;
};

export type WaivedResolution = ResolutionBase & {
  kind: "waived";
  waiverRecordId: string;
  candidate: CandidateBinding;
  approvedBy?: string;
  attestationUrl?: string;
};

export type DelegatedResolution = ResolutionBase & {
  kind: "delegated";
  ciPolicyId: HarnessCiPolicyId;
};

export type NotApplicableResolution = ResolutionBase & {
  kind: "not_applicable";
  activation: {
    relevantChangedLines: number;
    matchedSensitiveScenarioIds: string[];
    hasRelevantBinaryChange: boolean;
  };
};

export type BlockedResolution = ResolutionBase & {
  kind: "blocked";
  blockers: HarnessBlocker[];
};

export type ObligationResolution =
  | SatisfiedLiveFactResolution
  | SatisfiedEvidenceResolution
  | WaivedResolution
  | DelegatedResolution
  | NotApplicableResolution
  | BlockedResolution;

export type GateObligationDecision = {
  gateId: string;
  candidate: CandidateBinding;
  preventedCostClass: PreventedCostClass;
  admitted: boolean;
  resolutions: ObligationResolution[];
  diagnostics: ObligationFinding[];
  blockers: HarnessBlocker[];
};

export type EvaluateGateObligationsInput = {
  registry: HarnessGateRegistry;
  gateId: string;
  candidate: CandidateBinding;
  reviewProjection: ReviewActivationProjection;
  executionContext: HarnessExecutionContext;
  liveProviderResults: LiveProviderResult[];
  records: DiscoveredObligationRecord[];
};

/**
 * Freshness compares the deliverable identity, not the raw tree: a reviewer
 * approves reviewable content, and delivery narration is deliberately outside
 * it. Both sides must name the same known identity version and a non-empty
 * digest, so a record that predates the identity — or claims an unknown one —
 * fails closed as stale rather than matching on absent fields.
 */
function candidateBindingsEqual(
  left: CandidateBinding,
  right: CandidateBinding,
) {
  return (
    left.identityVersion === HARNESS_REVIEW_IDENTITY_VERSION &&
    right.identityVersion === HARNESS_REVIEW_IDENTITY_VERSION &&
    Boolean(left.deliverableTreeSha) &&
    left.deliverableTreeSha === right.deliverableTreeSha &&
    left.baseRef === right.baseRef &&
    left.baseTipSha === right.baseTipSha &&
    left.diffBaseSha === right.diffBaseSha &&
    left.worktreeId === right.worktreeId
  );
}

function finding(
  obligation: HarnessObligationDefinition,
  code: string,
  message: string,
  details: Partial<ObligationFinding> & { source?: HarnessBlockerSource } = {},
): ObligationFinding {
  const {
    source = { kind: "obligation", id: obligation.id },
    ...findingDetails
  } = details;
  const remediation = remediationFor(obligation, code);
  return {
    code,
    message,
    obligationId: obligation.id,
    ...findingDetails,
    blocker: createHarnessBlocker({
      code,
      source,
      summary: message,
      remediations: remediation,
    }),
  };
}

function remediationFor(
  obligation: HarnessObligationDefinition,
  code?: string,
): readonly [HarnessRemediation, ...HarnessRemediation[]] {
  switch (obligation.id) {
    case "review.green":
      return [
        {
          id: "complete-final-green-review",
          kind: "manual_action",
          summary: obligation.remediation.human,
        },
      ];
    case "documentation.current":
      return [
        {
          id: "repair-delivery-documentation",
          kind: "code_change",
          summary: obligation.remediation.machine,
        },
      ];
    case "telemetry.recorded":
      // A malformed record and a missing one need different instructions: only
      // the missing case is waivable, and hand-editing a corrupt record is how
      // the second bad commit happens. A distinct id keeps the renderer from
      // collapsing the two.
      if (code === "telemetry_record_malformed") {
        return [
          {
            id: "regenerate-delivery-telemetry",
            kind: "command",
            command: ["bun", "run", "delivery:telemetry-record"],
            summary:
              "Regenerate the telemetry record with the recorder instead of editing it by hand.",
          },
        ];
      }
      return [
        {
          id: "record-delivery-telemetry",
          kind: "command",
          command: ["bun", "run", "delivery:telemetry-record"],
          summary: obligation.remediation.machine,
        },
      ];
    default: {
      // Adding a fourth obligation should fail to compile here rather than
      // return undefined into a non-empty remediation tuple at runtime.
      const unhandled: never = obligation.id;
      throw new Error(`No remediation defined for obligation ${unhandled}.`);
    }
  }
}

function isActive(
  obligation: HarnessObligationDefinition,
  projection: ReviewActivationProjection,
) {
  if (obligation.activation.kind === "always") {
    return true;
  }

  const allowedSensitiveIds = new Set(
    obligation.activation.sensitiveScenarioIds,
  );
  return (
    projection.relevantChangedLines >=
      obligation.activation.minimumRelevantChangedLines ||
    (obligation.activation.relevantBinaryChangeActivates &&
      projection.hasRelevantBinaryChange) ||
    projection.matchedSensitiveScenarioIds.some((id) =>
      allowedSensitiveIds.has(id),
    )
  );
}

/**
 * A verified GitHub attestation crosses execution contexts because the
 * admission adapter has already proven its human issuer and portable candidate
 * binding. Otherwise a waiver is available only to the interactive human who
 * accepted it. Keeping both paths here preserves `waived` as one resolution
 * kind without confusing an attestation with provider-green evidence.
 */
function waiverFor(
  gate: HarnessGateDefinition,
  obligation: HarnessObligationDefinition,
  input: EvaluateGateObligationsInput,
) {
  if (!obligation.humanWaiverAllowed) return null;
  const attested = input.records
    .filter(
      (record): record is AttestedWaiverRecord =>
        record.kind === "attested_waiver" &&
        record.gateId === gate.id &&
        record.obligationId === obligation.id &&
        candidateBindingsEqual(record.candidate, input.candidate),
    )
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
  if (attested.length > 0) {
    return {
      kind: "waived" as const,
      gateId: gate.id,
      obligationId: obligation.id,
      waiverRecordId: attested[0].recordId,
      candidate: attested[0].candidate,
      approvedBy: attested[0].approvedBy,
      attestationUrl: attested[0].attestationUrl,
    };
  }
  if (input.executionContext.kind !== "interactive_human") return null;
  // A live obligation is re-evaluated from scratch every run, so its waiver is
  // scoped to the invocation that granted it. Honoring a durable record here
  // would let one "yes" to a missing artifact silently admit a *different*
  // failure — including finding codes the offer deliberately excludes — on
  // every later run against the same candidate.
  const invocationScopedOnly = obligation.freshness.kind === "live";
  const waivers = input.records
    .filter(
      (record): record is WaiverRecord =>
        record.kind === "waiver" &&
        record.gateId === gate.id &&
        record.obligationId === obligation.id &&
        (!invocationScopedOnly || record.recordId.startsWith("invocation:")) &&
        candidateBindingsEqual(record.candidate, input.candidate),
    )
    .sort((left, right) => left.recordId.localeCompare(right.recordId));
  if (waivers.length === 0) return null;
  return {
    kind: "waived" as const,
    gateId: gate.id,
    obligationId: obligation.id,
    waiverRecordId: waivers[0].recordId,
    candidate: waivers[0].candidate,
  };
}

function evaluateLiveObligation(
  gate: HarnessGateDefinition,
  obligation: HarnessObligationDefinition,
  results: readonly LiveProviderResult[],
  input: EvaluateGateObligationsInput,
): { resolution: ObligationResolution; diagnostics: ObligationFinding[] } {
  const providerResults = obligation.providerIds.flatMap((providerId) =>
    results.filter((result) => result.providerId === providerId),
  );
  const findings: ObligationFinding[] = [];
  const greenResults: LiveProviderResult[] = [];

  for (const providerId of obligation.providerIds) {
    const matching = providerResults.filter(
      (result) => result.providerId === providerId,
    );
    if (matching.length === 0) {
      findings.push(
        finding(
          obligation,
          "live_provider_missing",
          `Live provider ${providerId} did not return a result.`,
          { providerId },
        ),
      );
      continue;
    }
    if (matching.length > 1) {
      findings.push(
        finding(
          obligation,
          "ambiguous_live_provider",
          `Live provider ${providerId} returned more than one result.`,
          { providerId },
        ),
      );
      continue;
    }

    const result = matching[0];
    if (result.status !== "green" || result.findings.length > 0) {
      if (result.findings.length === 0) {
        findings.push(
          finding(
            obligation,
            "live_provider_failed",
            `Live provider ${providerId} failed without a structured finding.`,
            { providerId },
          ),
        );
      } else {
        findings.push(
          ...result.findings.map((providerFinding) =>
            finding(obligation, providerFinding.code, providerFinding.message, {
              obligationId: obligation.id,
              providerId,
              source: { kind: "provider", id: providerId },
            }),
          ),
        );
      }
    } else {
      greenResults.push(result);
    }
  }

  const satisfied =
    obligation.providerPolicy === "all"
      ? greenResults.length === obligation.providerIds.length
      : greenResults.length > 0;
  if (!satisfied) {
    const waived = waiverFor(gate, obligation, input);
    if (waived) return { resolution: waived, diagnostics: findings };
    return {
      resolution: {
        kind: "blocked",
        gateId: gate.id,
        obligationId: obligation.id,
        blockers: findings.map((entry) => entry.blocker),
      },
      diagnostics: [],
    };
  }

  const result = greenResults[0];
  return {
    resolution: {
      kind: "satisfied_live_fact",
      gateId: gate.id,
      obligationId: obligation.id,
      providerId: result.providerId as HarnessProviderId,
      runId: result.runId,
    },
    diagnostics: findings,
  };
}

function recordFinding(
  obligation: HarnessObligationDefinition,
  record: EvidenceRecord | InvalidObligationRecord,
  code: string,
  message: string,
) {
  return finding(obligation, code, message, {
    providerId: record.providerId,
    recordId: record.recordId,
  });
}

function semanticEvidenceSlot(record: EvidenceRecord) {
  return `${record.providerId}\0${record.runId}\0${record.finalPassId}`;
}

function findEvidence(
  gate: HarnessGateDefinition,
  obligation: HarnessObligationDefinition,
  candidate: CandidateBinding,
  records: readonly DiscoveredObligationRecord[],
) {
  const applicable = records.filter(
    (record) =>
      record.gateId === gate.id && record.obligationId === obligation.id,
  );
  const invalidFindings: ObligationFinding[] = [];
  const malformedFindings: ObligationFinding[] = [];
  const fresh: EvidenceRecord[] = [];

  for (const record of applicable) {
    if (record.kind === "invalid") {
      if (record.appliesToCandidate) {
        const malformedFinding = recordFinding(
          obligation,
          record,
          record.code,
          record.message,
        );
        invalidFindings.push(malformedFinding);
        malformedFindings.push(malformedFinding);
      }
      continue;
    }
    if (record.kind !== "evidence") {
      continue;
    }
    if (
      !obligation.providerIds.includes(record.providerId as HarnessProviderId)
    ) {
      invalidFindings.push(
        recordFinding(
          obligation,
          record,
          "unknown_provider",
          `Record ${record.recordId} names unapproved provider ${record.providerId}.`,
        ),
      );
      continue;
    }
    if (!candidateBindingsEqual(record.candidate, candidate)) {
      invalidFindings.push(
        recordFinding(
          obligation,
          record,
          "stale_evidence",
          `Record ${record.recordId} does not match the current candidate.`,
        ),
      );
      continue;
    }
    if (record.verdict !== "green") {
      invalidFindings.push(
        recordFinding(
          obligation,
          record,
          "evidence_not_green",
          `Record ${record.recordId} is not final green evidence.`,
        ),
      );
      continue;
    }
    if (record.unresolvedActionableCount !== 0) {
      invalidFindings.push(
        recordFinding(
          obligation,
          record,
          "unresolved_actionable_findings",
          `Record ${record.recordId} has unresolved actionable findings.`,
        ),
      );
      continue;
    }
    fresh.push(record);
  }

  const recordsBySlot = new Map<string, EvidenceRecord[]>();
  for (const record of fresh) {
    const slot = semanticEvidenceSlot(record);
    recordsBySlot.set(slot, [...(recordsBySlot.get(slot) ?? []), record]);
  }
  for (const slotRecords of recordsBySlot.values()) {
    const identities = new Set(slotRecords.map((record) => record.recordId));
    if (identities.size > 1) {
      return {
        evidence: undefined,
        blockingFindings: [
          finding(
            obligation,
            "ambiguous_records",
            "Fresh evidence records disagree within one provider run slot.",
          ),
        ],
        diagnostics: invalidFindings,
        malformedFindings,
      };
    }
  }

  fresh.sort(
    (left, right) =>
      left.providerId.localeCompare(right.providerId) ||
      left.recordId.localeCompare(right.recordId),
  );
  const providersWithFreshEvidence = new Set(
    fresh.map((record) => record.providerId),
  );
  const missingProviderFindings =
    obligation.providerPolicy === "all"
      ? obligation.providerIds
          .filter((providerId) => !providersWithFreshEvidence.has(providerId))
          .map((providerId) =>
            finding(
              obligation,
              "review_evidence_missing",
              `Approved provider ${providerId} has no fresh final-green review evidence.`,
              { providerId },
            ),
          )
      : [];
  const policySatisfied =
    obligation.providerPolicy === "all"
      ? missingProviderFindings.length === 0
      : fresh.length > 0;
  return {
    evidence: policySatisfied ? fresh[0] : undefined,
    blockingFindings: policySatisfied
      ? []
      : [...invalidFindings, ...missingProviderFindings],
    diagnostics: policySatisfied ? invalidFindings : [],
    malformedFindings: policySatisfied ? [] : malformedFindings,
  };
}

function evaluateHistoricalObligation(
  gate: HarnessGateDefinition,
  obligation: HarnessObligationDefinition,
  input: EvaluateGateObligationsInput,
): { resolution: ObligationResolution; diagnostics: ObligationFinding[] } {
  const evidenceResult = findEvidence(
    gate,
    obligation,
    input.candidate,
    input.records,
  );
  if (evidenceResult.evidence) {
    const evidence = evidenceResult.evidence;
    return {
      resolution: {
        kind: "satisfied_evidence",
        gateId: gate.id,
        obligationId: obligation.id,
        providerId: evidence.providerId as HarnessProviderId,
        recordId: evidence.recordId,
        runId: evidence.runId,
        finalPassId: evidence.finalPassId,
        candidate: evidence.candidate,
      },
      diagnostics: evidenceResult.diagnostics,
    };
  }

  if (
    evidenceResult.blockingFindings.some(
      (entry) => entry.code === "ambiguous_records",
    )
  ) {
    return {
      resolution: {
        kind: "blocked",
        gateId: gate.id,
        obligationId: obligation.id,
        blockers: evidenceResult.blockingFindings.map((entry) => entry.blocker),
      },
      diagnostics: evidenceResult.diagnostics,
    };
  }

  if (evidenceResult.malformedFindings.length > 0) {
    return {
      resolution: {
        kind: "blocked",
        gateId: gate.id,
        obligationId: obligation.id,
        blockers: evidenceResult.malformedFindings.map(
          (entry) => entry.blocker,
        ),
      },
      diagnostics: evidenceResult.blockingFindings.filter(
        (entry) => !evidenceResult.malformedFindings.includes(entry),
      ),
    };
  }

  if (input.executionContext.kind === "repository_ci") {
    const policy = input.registry.ciPolicies[input.executionContext.policyId];
    if (
      policy &&
      policy.gateId === gate.id &&
      policy.delegatedObligationIds.includes(obligation.id) &&
      obligation.ciDelegationPolicyIds.includes(policy.id)
    ) {
      return {
        resolution: {
          kind: "delegated",
          gateId: gate.id,
          obligationId: obligation.id,
          ciPolicyId: policy.id,
        },
        diagnostics: evidenceResult.blockingFindings,
      };
    }
  }

  const waived = waiverFor(gate, obligation, input);
  if (waived) {
    return {
      resolution: waived,
      diagnostics: evidenceResult.blockingFindings,
    };
  }

  const findings =
    evidenceResult.blockingFindings.length > 0
      ? evidenceResult.blockingFindings
      : [
          finding(
            obligation,
            "review_evidence_missing",
            "The qualifying candidate has no fresh approved final-green review evidence.",
          ),
        ];
  return {
    resolution: {
      kind: "blocked",
      gateId: gate.id,
      obligationId: obligation.id,
      blockers: findings.map((entry) => entry.blocker),
    },
    diagnostics: [],
  };
}

function enforceAllowedResolution(
  gate: HarnessGateDefinition,
  obligation: HarnessObligationDefinition,
  resolution: ObligationResolution,
): ObligationResolution {
  if (
    resolution.kind === "blocked" ||
    obligation.allowedResolutionKinds.includes(resolution.kind)
  ) {
    return resolution;
  }

  return {
    kind: "blocked",
    gateId: gate.id,
    obligationId: obligation.id,
    blockers: [
      finding(
        obligation,
        "resolution_not_allowed",
        `Resolution ${resolution.kind} is not allowed by obligation ${obligation.id}.`,
      ).blocker,
    ],
  };
}

export function evaluateGateObligations(
  input: EvaluateGateObligationsInput,
): GateObligationDecision {
  const gate = input.registry.gates[input.gateId];
  if (!gate) {
    throw new Error(`Unknown harness gate ${input.gateId}`);
  }

  const resolutions: ObligationResolution[] = [];
  const diagnostics: ObligationFinding[] = [];

  for (const obligationId of gate.obligationIds) {
    const obligation = input.registry.obligations[obligationId];
    if (!obligation) {
      throw new Error(
        `Gate ${gate.id} references unknown obligation ${obligationId}`,
      );
    }

    if (!isActive(obligation, input.reviewProjection)) {
      const resolution: NotApplicableResolution = {
        kind: "not_applicable",
        gateId: gate.id,
        obligationId: obligation.id,
        activation: {
          relevantChangedLines: input.reviewProjection.relevantChangedLines,
          matchedSensitiveScenarioIds: [
            ...input.reviewProjection.matchedSensitiveScenarioIds,
          ],
          hasRelevantBinaryChange:
            input.reviewProjection.hasRelevantBinaryChange,
        },
      };
      resolutions.push(enforceAllowedResolution(gate, obligation, resolution));
      continue;
    }

    const evaluation =
      obligation.freshness.kind === "live"
        ? evaluateLiveObligation(
            gate,
            obligation,
            input.liveProviderResults,
            input,
          )
        : evaluateHistoricalObligation(gate, obligation, input);
    resolutions.push(
      enforceAllowedResolution(gate, obligation, evaluation.resolution),
    );
    diagnostics.push(...evaluation.diagnostics);
  }

  const blockers = resolutions.flatMap((resolution) =>
    resolution.kind === "blocked" ? resolution.blockers : [],
  );
  return {
    gateId: gate.id,
    candidate: input.candidate,
    preventedCostClass: gate.preventedCostClass,
    admitted: blockers.length === 0,
    resolutions,
    diagnostics,
    blockers,
  };
}
