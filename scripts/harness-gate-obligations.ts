import type {
  HarnessCiPolicyId,
  HarnessGateDefinition,
  HarnessGateRegistry,
  HarnessObligationDefinition,
  HarnessObligationId,
  HarnessProviderId,
  PreventedCostClass,
} from "./harness-gate-registry";

export type CandidateBinding = {
  treeSha: string;
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
  remediation: string;
  obligationId?: string;
  providerId?: string;
  recordId?: string;
};

export type LiveProviderResult = {
  providerId: string;
  runId: string;
  status: "green" | "failed";
  findings: ObligationFinding[];
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
  EvidenceRecord | WaiverRecord | InvalidObligationRecord;

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
  findings: ObligationFinding[];
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
  findings: ObligationFinding[];
  diagnostics: ObligationFinding[];
  remediation: {
    machine: string[];
    human: string[];
  };
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

function candidateBindingsEqual(
  left: CandidateBinding,
  right: CandidateBinding,
) {
  return (
    left.treeSha === right.treeSha &&
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
  details: Partial<ObligationFinding> = {},
): ObligationFinding {
  return {
    code,
    message,
    remediation: obligation.remediation.machine,
    obligationId: obligation.id,
    ...details,
  };
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

function evaluateLiveObligation(
  gate: HarnessGateDefinition,
  obligation: HarnessObligationDefinition,
  results: readonly LiveProviderResult[],
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
          ...result.findings.map((providerFinding) => ({
            ...providerFinding,
            obligationId: obligation.id,
            providerId,
          })),
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
    return {
      resolution: {
        kind: "blocked",
        gateId: gate.id,
        obligationId: obligation.id,
        findings,
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
        findings: evidenceResult.blockingFindings,
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
        findings: evidenceResult.malformedFindings,
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

  if (
    input.executionContext.kind === "interactive_human" &&
    obligation.humanWaiverAllowed
  ) {
    const waivers = input.records
      .filter(
        (record): record is WaiverRecord =>
          record.kind === "waiver" &&
          record.gateId === gate.id &&
          record.obligationId === obligation.id &&
          candidateBindingsEqual(record.candidate, input.candidate),
      )
      .sort((left, right) => left.recordId.localeCompare(right.recordId));
    if (waivers.length > 0) {
      return {
        resolution: {
          kind: "waived",
          gateId: gate.id,
          obligationId: obligation.id,
          waiverRecordId: waivers[0].recordId,
          candidate: waivers[0].candidate,
        },
        diagnostics: evidenceResult.blockingFindings,
      };
    }
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
      findings,
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
    findings: [
      finding(
        obligation,
        "resolution_not_allowed",
        `Resolution ${resolution.kind} is not allowed by obligation ${obligation.id}.`,
      ),
    ],
  };
}

function unique(values: string[]) {
  return [...new Set(values)];
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
        ? evaluateLiveObligation(gate, obligation, input.liveProviderResults)
        : evaluateHistoricalObligation(gate, obligation, input);
    resolutions.push(
      enforceAllowedResolution(gate, obligation, evaluation.resolution),
    );
    diagnostics.push(...evaluation.diagnostics);
  }

  const findings = resolutions.flatMap((resolution) =>
    resolution.kind === "blocked" ? resolution.findings : [],
  );
  const blockedObligationIds = new Set<string>(
    resolutions
      .filter((resolution) => resolution.kind === "blocked")
      .map((resolution) => resolution.obligationId),
  );

  return {
    gateId: gate.id,
    candidate: input.candidate,
    preventedCostClass: gate.preventedCostClass,
    admitted: findings.length === 0,
    resolutions,
    findings,
    diagnostics,
    remediation: {
      machine: unique(
        gate.obligationIds.flatMap((obligationId) =>
          blockedObligationIds.has(obligationId)
            ? [input.registry.obligations[obligationId].remediation.machine]
            : [],
        ),
      ),
      human: unique(
        gate.obligationIds.flatMap((obligationId) =>
          blockedObligationIds.has(obligationId)
            ? [input.registry.obligations[obligationId].remediation.human]
            : [],
        ),
      ),
    },
  };
}
