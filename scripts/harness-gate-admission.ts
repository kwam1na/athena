import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { chmod, link, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";

import { HARNESS_APP_REGISTRY } from "./harness-app-registry";
import {
  captureStableHarnessCandidate,
  evaluateCandidateReviewActivation,
  type HarnessCandidate,
  type ReviewSensitiveScenario,
} from "./harness-candidate";
import {
  evaluateDeliveryDocumentationCheck,
  type DeliveryDocumentationFinding,
} from "./delivery-documentation-check";
import { discoverCurrentDocumentationWaiver } from "./delivery-documentation-admission";
import type { DiscoveredDocumentationWaiver } from "./documentation-waiver-attestation";
import {
  evaluateDeliveryRunTelemetryCheck,
  type DeliveryRunTelemetryFindingCode,
} from "./delivery-run-telemetry";
import {
  classifyCurrentHarnessExecutionContext,
  type HarnessExecutionContext as ClassifiedExecutionContext,
} from "./harness-execution-context";
import {
  evaluateGateObligations,
  type CandidateBinding,
  type DiscoveredObligationRecord,
  type GateObligationDecision,
  type HarnessExecutionContext,
} from "./harness-gate-obligations";
import {
  ATHENA_PR_VALIDATION_GATE_ID,
  HARNESS_GATE_REGISTRY,
  type HarnessObligationId,
} from "./harness-gate-registry";
import {
  discoverHarnessObligationRecords,
  publishHarnessObligationRecord,
  resolveHarnessObligationStorageContext,
  type HarnessObligationRecord,
  type HarnessObligationRecordDiagnostic,
} from "./harness-obligation-records";
import { evaluatePrAthenaPreparationReceipt } from "./pr-athena-prepare";
import {
  createHarnessBlocker,
  formatHarnessCommand,
  formatHarnessBlockers,
  HarnessBlockedError,
  runHarnessCliBoundary,
  serializeHarnessBlockers,
  type HarnessBlocker,
} from "./harness-blockers";

export const HARNESS_GATE_DECISION_SCHEMA_VERSION = 2 as const;
const DECISION_EVENTS_GIT_PATH = "codex/harness-obligations/v2/events";
const execFileAsync = promisify(execFile);
const SAFE_INVOCATION_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const VALID_SCENARIO_ID = /^[a-z0-9.-]+$/;

type PreparationEvaluation = Awaited<
  ReturnType<typeof evaluatePrAthenaPreparationReceipt>
>;
type DocumentationEvaluation = ReturnType<
  typeof evaluateDeliveryDocumentationCheck
>;
type TelemetryEvaluation = ReturnType<typeof evaluateDeliveryRunTelemetryCheck>;
type ActivationProjection = Awaited<
  ReturnType<typeof evaluateCandidateReviewActivation>
>;

export type HarnessGateDecisionEvent = {
  schemaVersion: typeof HARNESS_GATE_DECISION_SCHEMA_VERSION;
  kind: "gate_decision";
  invocationId: string;
  invocationMode: "outer" | "standalone";
  parentIdentity: "pr:athena:delivery-run" | "direct";
  parentStartToken: string;
  sequence: "evaluated" | "candidate_changed" | "provider_failed" | "completed";
  gateId: string;
  candidate: CandidateBinding;
  context: HarnessExecutionContext["kind"];
  admitted: boolean;
  decision: Omit<GateObligationDecision, "blockers">;
  preventedCostClass: string;
  timestamp: string;
  /** Exclusive v2 blocking-diagnostic envelope consumed by delivery tooling. */
  blockerEnvelope: ReturnType<typeof serializeHarnessBlockers>;
};

type AdmissionOptions = {
  invocationId?: string;
  evaluatePreparation?: (rootDir: string) => Promise<PreparationEvaluation>;
  projectActivation?: (
    rootDir: string,
    candidate: HarnessCandidate,
  ) => Promise<ActivationProjection>;
  classifyContext?: () => ClassifiedExecutionContext;
  discoverRecords?: typeof discoverHarnessObligationRecords;
  evaluateDocumentation?: (rootDir: string) => DocumentationEvaluation;
  discoverDocumentationWaiver?: (
    candidate: HarnessCandidate,
    documentation: DocumentationEvaluation,
  ) => Promise<DiscoveredDocumentationWaiver | undefined>;
  evaluateTelemetry?: (rootDir: string) => TelemetryEvaluation;
  resolveWorktreeId?: (rootDir: string) => Promise<string>;
  captureCandidate?: typeof captureStableHarnessCandidate;
  writeDecisionEvent?: (
    rootDir: string,
    event: HarnessGateDecisionEvent,
  ) => Promise<string>;
  spawnHeavy?: (command: readonly string[], rootDir: string) => Promise<number>;
  promptForWaiver?: (
    decision: GateObligationDecision,
    obligationIds: readonly string[],
  ) => Promise<boolean>;
  publishWaiver?: (
    rootDir: string,
    candidate: CandidateBinding,
    obligationId: string,
  ) => Promise<unknown>;
  now?: () => string;
  logger?: Pick<Console, "log" | "error">;
};

function toEvaluatorContext(
  context: ClassifiedExecutionContext,
): HarnessExecutionContext {
  switch (context.kind) {
    case "ci":
      return { kind: "repository_ci", policyId: context.policyId };
    case "agent":
      return context;
    case "human":
      return { kind: "interactive_human" };
    case "unknown":
      return { kind: "unknown", reason: context.reason };
  }
}

function candidateBinding(candidate: HarnessCandidate, worktreeId: string) {
  return {
    treeSha: candidate.treeSha,
    deliverableTreeSha: candidate.deliverableTreeSha,
    identityVersion: candidate.identityVersion,
    baseRef: candidate.baseRef,
    baseTipSha: candidate.baseTipSha,
    diffBaseSha: candidate.diffBaseSha,
    worktreeId,
  } satisfies CandidateBinding;
}

function sameCandidate(left: HarnessCandidate, right: HarnessCandidate) {
  return (
    left.treeSha === right.treeSha &&
    left.baseRef === right.baseRef &&
    left.baseTipSha === right.baseTipSha &&
    left.diffBaseSha === right.diffBaseSha &&
    left.headSha === right.headSha &&
    left.mode === right.mode &&
    left.status === right.status &&
    JSON.stringify(left.untrackedFiles) === JSON.stringify(right.untrackedFiles)
  );
}

function mapRecord(
  record: HarnessObligationRecord,
): DiscoveredObligationRecord {
  const boundCandidate = { ...record.candidate, worktreeId: record.worktreeId };
  if (record.resolution.kind === "waiver") {
    return {
      schemaVersion: 1,
      kind: "waiver",
      recordId: record.recordId,
      gateId: record.gateId,
      obligationId: record.obligationId,
      candidate: boundCandidate,
    };
  }
  return {
    schemaVersion: 1,
    kind: "evidence",
    recordId: record.recordId,
    gateId: record.gateId,
    obligationId: record.obligationId,
    providerId: record.resolution.providerId,
    runId: record.resolution.runId,
    finalPassId: record.resolution.finalPassId,
    candidate: boundCandidate,
    verdict: record.resolution.outcome,
    unresolvedActionableCount: record.resolution.unresolvedActionableCount,
  };
}

function mapRecordDiagnostic(
  diagnostic: HarnessObligationRecordDiagnostic,
): DiscoveredObligationRecord | undefined {
  if (diagnostic.kind !== "malformed_record") return undefined;
  return {
    kind: "invalid",
    gateId: ATHENA_PR_VALIDATION_GATE_ID,
    obligationId: "review.green",
    appliesToCandidate: true,
    code: "malformed_record",
    message: `${diagnostic.path}: ${diagnostic.reason}`,
  };
}

function documentationProviderResult(result: DocumentationEvaluation) {
  return {
    providerId: "delivery-documentation-check",
    runId: randomUUID(),
    status: result.status === "pass" ? ("green" as const) : ("failed" as const),
    findings: result.findings.map((finding) => ({
      code: finding.policy,
      message: `${finding.label}: ${finding.message}`,
    })),
  };
}

function telemetryProviderResult(result: TelemetryEvaluation) {
  return {
    providerId: "delivery-run-telemetry-check",
    runId: randomUUID(),
    status: result.status === "pass" ? ("green" as const) : ("failed" as const),
    // The provider's own code is preserved rather than flattened: only a
    // missing record is waivable, so a malformed one must not arrive wearing
    // the waivable code.
    findings: result.findings.map((finding) => ({
      code: finding.code,
      message: `Delivery-run telemetry: ${finding.message}`,
    })),
  };
}

function reviewProjection(projection: ActivationProjection) {
  return {
    relevantChangedLines: projection.relevantLineCount,
    matchedSensitiveScenarioIds: projection.sensitiveScenarioIds,
    hasRelevantBinaryChange: projection.binaryPaths.length > 0,
  };
}

/**
 * Which blocked findings an interactive human may waive, per obligation. The
 * codes are enumerated rather than blanket-allowed so a waiver stays an
 * "I accept this missing artifact" decision and never becomes a way past a
 * malformed record or an unknown provider.
 */
export const WAIVABLE_FINDING_CODES: {
  "review.green": readonly string[];
  "documentation.current": readonly DeliveryDocumentationFinding["policy"][];
  // Typed against the provider's own code union: a misspelling here would
  // otherwise type-check and silently make the waiver unofferable forever.
  "telemetry.recorded": readonly DeliveryRunTelemetryFindingCode[];
} = {
  "review.green": [
    "review_evidence_missing",
    "stale_evidence",
    "unknown_provider",
    "evidence_not_green",
  ],
  "documentation.current": ["compound-solution", "landed-change-report"],
  "telemetry.recorded": ["telemetry_record_missing"],
};

// Exhaustive-by-construction witnesses for the typed provider code unions.
// Adding a member to either union fails to compile until it is named here,
// which is what routes the new code into the classification decision below
// instead of letting it default to silence.
const DOCUMENTATION_PROVIDER_CODES: Record<
  DeliveryDocumentationFinding["policy"],
  null
> = {
  "compound-solution": null,
  "landed-change-report": null,
};

const TELEMETRY_PROVIDER_CODES: Record<DeliveryRunTelemetryFindingCode, null> = {
  telemetry_record_missing: null,
  telemetry_record_malformed: null,
};

/**
 * Every finding code an obligation can carry into a blocked resolution:
 * the evaluator's structural codes plus each provider's full code surface.
 * The waiver offer intersects blockers against WAIVABLE_FINDING_CODES, so an
 * unclassified code silently voids waivers for the whole run — this export is
 * the closed enumeration that makes such a gap a test failure instead.
 */
export const EMITTABLE_BLOCKED_FINDING_CODES: Readonly<
  Record<HarnessObligationId, readonly string[]>
> = {
  "review.green": [
    "review_evidence_missing",
    "stale_evidence",
    "unknown_provider",
    "evidence_not_green",
    "unresolved_actionable_findings",
    "ambiguous_records",
    // mapRecordDiagnostic is the only production source of invalid records,
    // and it always emits this code.
    "malformed_record",
    "resolution_not_allowed",
  ],
  "documentation.current": [
    ...Object.keys(DOCUMENTATION_PROVIDER_CODES),
    "live_provider_missing",
    "ambiguous_live_provider",
    "live_provider_failed",
    "resolution_not_allowed",
  ],
  "telemetry.recorded": [
    ...Object.keys(TELEMETRY_PROVIDER_CODES),
    "live_provider_missing",
    "ambiguous_live_provider",
    "live_provider_failed",
    "resolution_not_allowed",
  ],
};

/**
 * The deliberate complement of WAIVABLE_FINDING_CODES: codes an obligation can
 * emit into a blocked resolution that a human waiver must never cover. A waiver
 * means "I accept this missing artifact", never "I accept this malformed
 * record" or "I accept a structurally broken evaluation". Together with the
 * waivable list this partitions EMITTABLE_BLOCKED_FINDING_CODES exactly; the
 * guard test fails until every new code lands in one of the two.
 */
export const INTENTIONALLY_NOT_WAIVABLE_FINDING_CODES: Readonly<
  Record<HarnessObligationId, readonly string[]>
> = {
  "review.green": [
    "unresolved_actionable_findings",
    "ambiguous_records",
    "malformed_record",
    "resolution_not_allowed",
  ],
  "documentation.current": [
    "live_provider_missing",
    "ambiguous_live_provider",
    "live_provider_failed",
    "resolution_not_allowed",
  ],
  "telemetry.recorded": [
    "telemetry_record_malformed",
    "live_provider_missing",
    "ambiguous_live_provider",
    "live_provider_failed",
    "resolution_not_allowed",
  ],
};

function waivableBlockedObligationIds(
  decision: GateObligationDecision,
  context: HarnessExecutionContext,
) {
  if (context.kind !== "interactive_human") return [];
  const blocked = decision.resolutions.filter(
    (resolution) => resolution.kind === "blocked",
  );
  if (blocked.length === 0) return [];
  const waivable = blocked.every((resolution) => {
    const obligation =
      HARNESS_GATE_REGISTRY.obligations[resolution.obligationId];
    const allowedCodes =
      WAIVABLE_FINDING_CODES[resolution.obligationId as HarnessObligationId];
    return (
      Boolean(obligation?.humanWaiverAllowed) &&
      allowedCodes !== undefined &&
      resolution.blockers.every((blocker) =>
        (allowedCodes as readonly string[]).includes(blocker.code),
      )
    );
  });
  return waivable ? blocked.map((resolution) => resolution.obligationId) : [];
}

function canOfferInvocationWaiver(
  decision: GateObligationDecision,
  context: HarnessExecutionContext,
) {
  return waivableBlockedObligationIds(decision, context).length > 0;
}

function withInvocationWaiver(
  candidate: CandidateBinding,
  records: DiscoveredObligationRecord[],
  obligationIds: readonly string[],
) {
  return [
    ...records,
    ...obligationIds.map((obligationId) => ({
      schemaVersion: 1 as const,
      kind: "waiver" as const,
      recordId: `invocation:${randomUUID()}`,
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      obligationId,
      candidate,
    })),
  ];
}

/**
 * The prompt must name every obligation the single confirmation waives. One
 * "yes" can now cover more than review evidence, and consent to a headline that
 * names only one of them is not consent to the rest.
 */
async function defaultPrompt(
  decision: GateObligationDecision,
  obligationIds: readonly string[] = [],
) {
  const named =
    obligationIds.length > 0 ? obligationIds.join(", ") : "review.green";
  console.log(`This prepared candidate is blocked by: ${named}.`);
  console.log(formatHarnessBlockers(decision.blockers));
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    const answer = await terminal.question(
      `Waive ${named} for this invocation? Type 'yes' to continue: `,
    );
    return answer.trim().toLowerCase() === "yes";
  } catch {
    return false;
  } finally {
    terminal.close();
  }
}

async function defaultSpawnHeavy(command: readonly string[], rootDir: string) {
  const child = Bun.spawn([...command], {
    cwd: rootDir,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  return child.exited;
}

async function resolveDecisionEventsDir(rootDir: string) {
  const { stdout } = await execFileAsync(
    "git",
    ["rev-parse", "--git-path", DECISION_EVENTS_GIT_PATH],
    { cwd: rootDir },
  );
  const value = stdout.trim();
  return path.isAbsolute(value) ? value : path.resolve(rootDir, value);
}

function assertSafeInvocationId(invocationId: string) {
  if (!SAFE_INVOCATION_ID.test(invocationId)) {
    throw new Error(
      "Harness invocation ID must be 1-128 filesystem-safe characters.",
    );
  }
}

function containedEventDestination(eventsDir: string, fileName: string) {
  const destination = path.resolve(eventsDir, fileName);
  const relative = path.relative(eventsDir, destination);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(
      "Harness decision event destination escaped its directory.",
    );
  }
  return destination;
}

export async function writeHarnessGateDecisionEvent(
  rootDir: string,
  event: HarnessGateDecisionEvent,
) {
  assertSafeInvocationId(event.invocationId);
  const eventsDir = await resolveDecisionEventsDir(rootDir);
  await mkdir(eventsDir, { recursive: true, mode: 0o700 });
  await chmod(eventsDir, 0o700);
  const destination = containedEventDestination(
    eventsDir,
    `${event.invocationId}--${event.sequence}.json`,
  );
  const temporary = containedEventDestination(
    eventsDir,
    `.${event.invocationId}--${event.sequence}.${process.pid}.${randomUUID()}.tmp`,
  );
  try {
    await writeFile(temporary, `${JSON.stringify(event, null, 2)}\n`, {
      mode: 0o600,
      flag: "wx",
    });
    await link(temporary, destination);
    console.log(JSON.stringify(event));
    return destination;
  } finally {
    await rm(temporary, { force: true });
  }
}

function eventFor(
  invocationId: string,
  invocationMode: HarnessGateDecisionEvent["invocationMode"],
  parentIdentity: HarnessGateDecisionEvent["parentIdentity"],
  parentStartToken: string,
  sequence: HarnessGateDecisionEvent["sequence"],
  candidate: CandidateBinding,
  context: HarnessExecutionContext,
  decision: GateObligationDecision,
  admitted: boolean,
  now: () => string,
): HarnessGateDecisionEvent {
  const { blockers, ...eventDecision } = decision;
  return {
    schemaVersion: HARNESS_GATE_DECISION_SCHEMA_VERSION,
    kind: "gate_decision",
    invocationId,
    invocationMode,
    parentIdentity,
    parentStartToken,
    sequence,
    gateId: ATHENA_PR_VALIDATION_GATE_ID,
    candidate,
    context: context.kind,
    admitted,
    decision: eventDecision,
    preventedCostClass: decision.preventedCostClass,
    timestamp: now(),
    blockerEnvelope: serializeHarnessBlockers(blockers),
  };
}

function candidateChangedBlocker(
  code:
    | "candidate_changed_during_prompt"
    | "candidate_changed_before_spawn"
    | "candidate_changed_after_provider",
  message: string,
) {
  const blocker = createHarnessBlocker({
    code,
    source: { kind: "candidate", id: "candidate-drift" },
    summary: message,
    remediations: [
      {
        id: "prepare-current-candidate",
        kind: "command",
        command: ["bun", "run", "pr:athena:prepare"],
        summary: "Prepare the current candidate again and publish a fresh receipt.",
      },
    ],
  });
  return blocker;
}

function withBlocker(
  decision: GateObligationDecision,
  blocker: HarnessBlocker,
) {
  return { ...decision, blockers: [...decision.blockers, blocker] };
}

export function defaultScenarios(): ReviewSensitiveScenario[] {
  const seenIds = new Set<string>();
  return HARNESS_APP_REGISTRY.flatMap((app) =>
    app.validationScenarios.map((scenario, index) => {
      const candidate = scenario as unknown as Partial<ReviewSensitiveScenario>;
      if (
        typeof candidate.id !== "string" ||
        !VALID_SCENARIO_ID.test(candidate.id) ||
        seenIds.has(candidate.id)
      ) {
        throw new Error(
          `Harness validation scenario ${app.appName}[${index}] has a malformed id.`,
        );
      }
      if (typeof candidate.reviewSensitive !== "boolean") {
        throw new Error(
          `Harness validation scenario ${candidate.id} has a malformed reviewSensitive policy.`,
        );
      }
      seenIds.add(candidate.id);
      return {
        id: candidate.id,
        reviewSensitive: candidate.reviewSensitive,
        touchedPaths: scenario.touchedPaths,
        packageDir: app.packageDir,
      };
    }),
  );
}

export async function runHarnessGateAdmission(
  rootDir: string,
  options: AdmissionOptions = {},
) {
  const logger = options.logger ?? console;
  const invocationId =
    options.invocationId ??
    process.env.ATHENA_HARNESS_INVOCATION_ID ??
    randomUUID();
  assertSafeInvocationId(invocationId);
  const invocationMode = process.env.ATHENA_HARNESS_INVOCATION_ID
    ? ("outer" as const)
    : ("standalone" as const);
  const parentIdentity =
    invocationMode === "outer" ? "pr:athena:delivery-run" : "direct";
  const parentStartToken =
    process.env.ATHENA_HARNESS_PARENT_START_TOKEN ?? `direct:${invocationId}`;
  const now = options.now ?? (() => new Date().toISOString());
  const writeEvent =
    options.writeDecisionEvent ?? writeHarnessGateDecisionEvent;
  const preparation = await (
    options.evaluatePreparation ?? evaluatePrAthenaPreparationReceipt
  )(rootDir);
  if (preparation.prepared === false) {
    throw new HarnessBlockedError([preparation.blocker]);
  }
  const context = toEvaluatorContext(
    (
      options.classifyContext ??
      (() =>
        classifyCurrentHarnessExecutionContext(
          ATHENA_PR_VALIDATION_GATE_ID,
          "review.green",
        ))
    )(),
  );
  const worktreeId = await (
    options.resolveWorktreeId ??
    ((dir) =>
      resolveHarnessObligationStorageContext(dir, {}).then(
        (resolved) => resolved.worktreeId,
      ))
  )(rootDir);
  const binding = candidateBinding(preparation.candidate, worktreeId);
  const initialCapture = await (
    options.captureCandidate ?? captureStableHarnessCandidate
  )(rootDir);
  if (
    !initialCapture.ok ||
    !sameCandidate(preparation.candidate, initialCapture.candidate)
  ) {
    throw new HarnessBlockedError([
      createHarnessBlocker({
        code: "candidate_changed_after_preparation",
        source: { kind: "candidate", id: "candidate-drift" },
        summary: "The candidate changed after preparation.",
        remediations: [
          {
            id: "prepare-current-candidate",
            kind: "command",
            command: ["bun", "run", "pr:athena:prepare"],
            summary: "Prepare the current candidate again and publish a fresh receipt.",
          },
        ],
      }),
    ]);
  }
  const projection = await (
    options.projectActivation ??
    ((dir, candidate) =>
      evaluateCandidateReviewActivation(dir, candidate, defaultScenarios()))
  )(rootDir, preparation.candidate);
  const documentation = (
    options.evaluateDocumentation ?? evaluateDeliveryDocumentationCheck
  )(rootDir);
  const telemetry = (
    options.evaluateTelemetry ??
    // Derived from the classified context, never from a raw CI env var: agent
    // sandboxes commonly export CI, and letting that switch this evaluation
    // into strict mode disables the bootstrap leniency and leaves a
    // non-interactive agent with no legal move. The real CI enforcement point
    // is the separate delivery:telemetry-check workflow step.
    ((dir: string) =>
      evaluateDeliveryRunTelemetryCheck(dir, {
        ciMode: context.kind === "repository_ci",
      }))
  )(rootDir);
  const discovered = await (
    options.discoverRecords ?? discoverHarnessObligationRecords
  )(rootDir, {
    gateId: ATHENA_PR_VALIDATION_GATE_ID,
    obligationId: "review.green",
  });
  let records = [
    ...discovered.records.map(mapRecord),
    ...discovered.diagnostics
      .map(mapRecordDiagnostic)
      .filter((record): record is DiscoveredObligationRecord =>
        Boolean(record),
      ),
  ];
  const attestedDocumentationWaiver =
    documentation.status === "fail"
      ? await (
          options.discoverDocumentationWaiver ??
          ((currentCandidate, currentDocumentation) =>
            discoverCurrentDocumentationWaiver(
              rootDir,
              currentCandidate,
              currentDocumentation,
            ))
        )(preparation.candidate, documentation)
      : undefined;
  if (attestedDocumentationWaiver) {
    records.push({
      schemaVersion: 1,
      kind: "attested_waiver",
      recordId: attestedDocumentationWaiver.recordId,
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      obligationId: "documentation.current",
      candidate: binding,
      approvedBy: attestedDocumentationWaiver.approvedBy,
      attestationUrl: attestedDocumentationWaiver.attestationUrl,
    });
  }
  const decisionInput = () => ({
    registry: HARNESS_GATE_REGISTRY,
    gateId: ATHENA_PR_VALIDATION_GATE_ID,
    candidate: binding,
    reviewProjection: reviewProjection(projection),
    executionContext: context,
    liveProviderResults: [
      documentationProviderResult(documentation),
      telemetryProviderResult(telemetry),
    ],
    records,
  });
  let decision = evaluateGateObligations(decisionInput());
  let invocationWaiver = false;
  let waivedObligationIds: readonly string[] = [];
  if (!decision.admitted && canOfferInvocationWaiver(decision, context)) {
    waivedObligationIds = waivableBlockedObligationIds(decision, context);
    const accepted = await (options.promptForWaiver ?? defaultPrompt)(
      decision,
      waivedObligationIds,
    );
    if (accepted) {
      const promptCapture = await (
        options.captureCandidate ?? captureStableHarnessCandidate
      )(rootDir);
      if (
        !promptCapture.ok ||
        !sameCandidate(preparation.candidate, promptCapture.candidate)
      ) {
        const changed = candidateChangedBlocker(
          "candidate_changed_during_prompt",
          "The candidate changed while the waiver prompt was open.",
        );
        decision = {
          ...decision,
          admitted: false,
          blockers: [...decision.blockers, changed],
        };
      } else {
        records = withInvocationWaiver(binding, records, waivedObligationIds);
        decision = evaluateGateObligations(decisionInput());
        invocationWaiver = decision.admitted;
      }
    } else {
      const declined = createHarnessBlocker({
        code: "waiver_declined",
        source: { kind: "obligation", id: "review.green" },
        summary: "The interactive human did not accept the offered waiver.",
        remediations: [
          {
            // Distinct from the obligation's own `complete-final-green-review`
            // on purpose: that one still offers the waiver, and the operator
            // has just declined it. Sharing the id would let the renderer print
            // whichever phrasing it saw first.
            id: "complete-final-green-review-after-decline",
            kind: "manual_action",
            summary:
              "Complete an approved final-green review for this candidate.",
          },
        ],
      });
      decision = { ...decision, blockers: [...decision.blockers, declined] };
    }
  }
  await writeEvent(
    rootDir,
    eventFor(
      invocationId,
      invocationMode,
      parentIdentity,
      parentStartToken,
      "evaluated",
      binding,
      context,
      decision,
      decision.admitted,
      now,
    ),
  );
  if (!decision.admitted) {
    logger.error(formatHarnessBlockers(decision.blockers));
    return { admitted: false as const, status: "blocked" as const, decision };
  }

  // This is the last awaitable authorization capture. The first heavy spawn is
  // the next effect on the successful path.
  const finalCapture = await (
    options.captureCandidate ?? captureStableHarnessCandidate
  )(rootDir);
  if (
    !finalCapture.ok ||
    !sameCandidate(preparation.candidate, finalCapture.candidate)
  ) {
    const changed = candidateChangedBlocker(
      "candidate_changed_before_spawn",
      "The candidate changed immediately before heavy validation.",
    );
    const changedDecision = {
      ...decision,
      admitted: false,
      blockers: [...decision.blockers, changed],
    };
    await writeEvent(
      rootDir,
      eventFor(
        invocationId,
        invocationMode,
        parentIdentity,
        parentStartToken,
        "candidate_changed",
        binding,
        context,
        changedDecision,
        false,
        now,
      ),
    );
    // The blocker was built and persisted to the event, then discarded for the
    // operator: this path exited 1 with nothing on the terminal, which is the
    // failure mode the typed contract exists to remove.
    logger.error(formatHarnessBlockers(changedDecision.blockers));
    return {
      admitted: false as const,
      status: "candidate_changed" as const,
      decision: changedDecision,
    };
  }

  const providerCommands =
    HARNESS_GATE_REGISTRY.gates[ATHENA_PR_VALIDATION_GATE_ID]
      .privateProviderCommands;
  for (const command of providerCommands) {
    const exitCode = await (options.spawnHeavy ?? defaultSpawnHeavy)(
      command,
      rootDir,
    );
    if (exitCode !== 0) {
      const providerBlocker = createHarnessBlocker({
        code: "provider_command_failed",
        source: { kind: "gate", id: ATHENA_PR_VALIDATION_GATE_ID },
        summary: `A private validation provider exited with code ${exitCode}.`,
        details: `Provider command: ${formatHarnessCommand(command)}`,
        remediations: [
          {
            id: "rerun-provider-command",
            kind: "command",
            command: command as [string, ...string[]],
            summary:
              "Rerun the failed provider command and inspect its complete output.",
          },
        ],
      });
      const providerDecision = withBlocker(decision, providerBlocker);
      await writeEvent(
        rootDir,
        eventFor(
          invocationId,
          invocationMode,
          parentIdentity,
          parentStartToken,
          "provider_failed",
          binding,
          context,
          providerDecision,
          true,
          now,
        ),
      );
      logger.error(formatHarnessBlockers([providerBlocker]));
      return {
        admitted: true as const,
        status: "provider_failed" as const,
        exitCode,
        decision: providerDecision,
      };
    }
  }

  const completionCapture = await (
    options.captureCandidate ?? captureStableHarnessCandidate
  )(rootDir);
  if (
    !completionCapture.ok ||
    !sameCandidate(preparation.candidate, completionCapture.candidate)
  ) {
    const changed = candidateChangedBlocker(
      "candidate_changed_after_provider",
      "The candidate changed while heavy validation was running.",
    );
    const changedDecision = {
      ...decision,
      admitted: false,
      blockers: [...decision.blockers, changed],
    };
    await writeEvent(
      rootDir,
      eventFor(
        invocationId,
        invocationMode,
        parentIdentity,
        parentStartToken,
        "candidate_changed",
        binding,
        context,
        changedDecision,
        false,
        now,
      ),
    );
    logger.error(formatHarnessBlockers(changedDecision.blockers));
    return {
      admitted: true as const,
      status: "provider_changed_candidate" as const,
      decision: changedDecision,
    };
  }
  if (invocationWaiver) {
    // One durable waiver record per *historical* obligation the human accepted,
    // so the audit trail names what was waived rather than implying
    // review.green. Live obligations are re-evaluated every run and their
    // waivers are invocation-scoped, so a durable record for them would never
    // be read back — the decision event is their audit trail.
    const durableWaivers = waivedObligationIds.filter(
      (obligationId) =>
        HARNESS_GATE_REGISTRY.obligations[obligationId]?.freshness.kind !==
        "live",
    );
    for (const obligationId of durableWaivers) {
      await (
        options.publishWaiver ??
        ((dir, currentCandidate, waivedObligationId) =>
          publishHarnessObligationRecord(dir, {
            gateId: ATHENA_PR_VALIDATION_GATE_ID,
            obligationId: waivedObligationId,
            candidate: currentCandidate,
            resolution: { kind: "waiver" },
          }))
      )(rootDir, binding, obligationId);
    }
  }
  await writeEvent(
    rootDir,
    eventFor(
      invocationId,
      invocationMode,
      parentIdentity,
      parentStartToken,
      "completed",
      binding,
      context,
      decision,
      true,
      now,
    ),
  );
  logger.log("Harness gate obligations satisfied; heavy validation completed.");
  return { admitted: true as const, status: "passed" as const, decision };
}

async function main() {
  const result = await runHarnessGateAdmission(process.cwd());
  return result.status === "passed" ? 0 : 1;
}

if (import.meta.main) {
  process.exitCode = await runHarnessCliBoundary({
    source: { kind: "command", id: "pr:athena:validate-provider" },
    reproduce: ["bun", "run", "pr:athena:validate-provider"],
    run: main,
    renderNonZero: false,
  });
}
