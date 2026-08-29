import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  type HarnessReviewLoopTelemetry,
  isValidReviewLoopTelemetry,
} from "./harness-obligation-records";

export const DELIVERY_RUN_LEDGER_VERSION = "1.0" as const;
export const DEFAULT_DELIVERY_RUN_LATEST_PATH =
  "artifacts/harness-delivery-runs/latest.json";
export const DEFAULT_DELIVERY_RUN_BASELINE_PATH =
  "artifacts/harness-delivery-runs/baseline.json";
export const DEFAULT_DELIVERY_RUN_HISTORY_DIR =
  "artifacts/harness-delivery-runs/history";
export const DEFAULT_DELIVERY_RUN_HISTORY_LIMIT = 50;

export type DeliveryRunStatus = "pass" | "fail" | "blocked" | "interrupted";
export type DeliveryRunCommandStatus =
  "pass" | "fail" | "blocked" | "interrupted";
export type DeliveryRunProofState =
  "proof_recorded" | "proof_not_recorded" | "proof_reused" | "prepush_reused";

export type DeliveryRunCommandSpan = {
  phase: string;
  command: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: DeliveryRunCommandStatus;
  exitCode: number | null;
  packageName?: string;
  suite?: string;
};

export type DeliveryRunProviderSkippedEvent = {
  providerName: string;
  status: "covered_by_provider";
  coveredBy: string;
  reason: string;
};

export type DeliveryRunGateDecisionEvent = {
  invocationId: string;
  invocationMode: "outer" | "standalone";
  parentIdentity: "pr:athena:delivery-run" | "direct";
  parentStartToken: string;
  sequence: "evaluated" | "candidate_changed" | "provider_failed" | "completed";
  gateId: string;
  treeSha: string;
  baseRef: string;
  baseTipSha: string;
  diffBaseSha: string;
  worktreeId: string;
  context: string;
  admitted: boolean;
  preventedCostClass: string;
  resolutionKinds: string[];
  blockerCodes: string[];
  timestamp: string;
};

export type DeliveryRunReviewLoopSummary = HarnessReviewLoopTelemetry & {
  providerId: string;
  runId: string;
  finalPassId: string;
  recordedAt: string;
};

export type DeliveryRunLedger = {
  version: typeof DELIVERY_RUN_LEDGER_VERSION;
  generatedAt: string;
  /**
   * The deliverable diff this run validated. Recorded so the telemetry sensor
   * can tell "a run has completed for this exact tree, so a current record is
   * producible" from "the tree moved since the last run" — without it the
   * sensor blocks the very run that would satisfy it.
   */
  deliverableDiffFingerprint?: string;
  status: DeliveryRunStatus;
  proofState: DeliveryRunProofState;
  blockedReason?: string;
  interruptedReason?: string;
  reviewLoop?: DeliveryRunReviewLoopSummary;
  commandSpans: DeliveryRunCommandSpan[];
  duplicateCommands: Array<{
    command: string;
    count: number;
  }>;
  duplicatePackageSuites: Array<{
    packageName: string;
    suite: string;
    count: number;
  }>;
  providerSkippedEvents: DeliveryRunProviderSkippedEvent[];
  gateDecisionEvents: DeliveryRunGateDecisionEvent[];
  summary: {
    commandCount: number;
    failedCommandCount: number;
    duplicateCommandCount: number;
    duplicatePackageSuiteCount: number;
    providerSkippedCount: number;
    gateDecisionCount: number;
    totalDurationMs: number;
  };
};

type DeliveryRunProviderSkippedInput = Omit<
  DeliveryRunProviderSkippedEvent,
  "status"
>;

export type CreateDeliveryRunLedgerInput = {
  generatedAt: string;
  status: DeliveryRunStatus;
  proofState: DeliveryRunProofState;
  commandSpans: DeliveryRunCommandSpan[];
  providerSkippedEvents?: DeliveryRunProviderSkippedInput[];
  gateDecisionEvents?: DeliveryRunGateDecisionEvent[];
  blockedReason?: string;
  interruptedReason?: string;
  reviewLoop?: DeliveryRunReviewLoopSummary;
  deliverableDiffFingerprint?: string;
};

export type DeliveryRunBaselineSummary = {
  present: boolean;
  status: DeliveryRunStatus | "missing";
  generatedAt: string | null;
  proofState: DeliveryRunProofState | null;
  commandCount: number;
  duplicateCommandCount: number;
  duplicatePackageSuiteCount: number;
  providerSkippedCount: number;
  totalDurationMs: number;
};

function countBy<T>(items: T[], keyFor: (item: T) => string | null) {
  const counts = new Map<string, number>();
  for (const item of items) {
    const key = keyFor(item);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .sort(([left], [right]) => left.localeCompare(right));
}

export function createDeliveryRunLedger(
  input: CreateDeliveryRunLedgerInput,
): DeliveryRunLedger {
  const commandSpans = [...input.commandSpans];
  const duplicateCommands = countBy(commandSpans, (span) => span.command).map(
    ([command, count]) => ({ command, count }),
  );
  const duplicatePackageSuites = countBy(commandSpans, (span) =>
    span.packageName && span.suite
      ? `${span.packageName}\u0000${span.suite}`
      : null,
  ).map(([key, count]) => {
    const [packageName, suite] = key.split("\u0000");
    return { packageName, suite, count };
  });
  const providerSkippedEvents = (input.providerSkippedEvents ?? []).map(
    (event) => ({
      ...event,
      status: "covered_by_provider" as const,
    }),
  );

  return {
    version: DELIVERY_RUN_LEDGER_VERSION,
    generatedAt: input.generatedAt,
    status: input.status,
    proofState: input.proofState,
    ...(input.blockedReason ? { blockedReason: input.blockedReason } : {}),
    ...(input.interruptedReason
      ? { interruptedReason: input.interruptedReason }
      : {}),
    ...(input.reviewLoop ? { reviewLoop: input.reviewLoop } : {}),
    ...(input.deliverableDiffFingerprint
      ? { deliverableDiffFingerprint: input.deliverableDiffFingerprint }
      : {}),
    commandSpans,
    duplicateCommands,
    duplicatePackageSuites,
    providerSkippedEvents,
    gateDecisionEvents: [...(input.gateDecisionEvents ?? [])],
    summary: {
      commandCount: commandSpans.length,
      failedCommandCount: commandSpans.filter((span) => span.status !== "pass")
        .length,
      duplicateCommandCount: duplicateCommands.length,
      duplicatePackageSuiteCount: duplicatePackageSuites.length,
      providerSkippedCount: providerSkippedEvents.length,
      gateDecisionCount: input.gateDecisionEvents?.length ?? 0,
      totalDurationMs: commandSpans.reduce(
        (total, span) => total + span.durationMs,
        0,
      ),
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isValidIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function isValidReviewLoop(
  value: unknown,
): value is DeliveryRunReviewLoopSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value.providerId === "string" &&
    value.providerId.length > 0 &&
    typeof value.runId === "string" &&
    value.runId.length > 0 &&
    typeof value.finalPassId === "string" &&
    value.finalPassId.length > 0 &&
    isValidIsoTimestamp(value.recordedAt) &&
    isValidReviewLoopTelemetry(value)
  );
}

const COMPLETED_PR_ATHENA_PHASES = [
  "prepare",
  "preflight",
  "validate",
  "record-proof",
  "scorecard",
] as const;

function hasCompletedPrAthenaSpans(ledger: Partial<DeliveryRunLedger>) {
  return (
    ledger.proofState === "proof_recorded" &&
    ledger.commandSpans?.length === COMPLETED_PR_ATHENA_PHASES.length &&
    ledger.commandSpans.every((span, index) => {
      const phase = COMPLETED_PR_ATHENA_PHASES[index];
      return (
        isRecord(span) &&
        span.phase === phase &&
        span.command === `bun run pr:athena:${phase}` &&
        isValidIsoTimestamp(span.startedAt) &&
        isValidIsoTimestamp(span.endedAt) &&
        Date.parse(span.endedAt) >= Date.parse(span.startedAt) &&
        isFiniteNonNegative(span.durationMs) &&
        span.status === "pass" &&
        span.exitCode === 0
      );
    })
  );
}

function isCanonicalPassingLedger(value: unknown): value is DeliveryRunLedger {
  if (!value || typeof value !== "object") return false;
  const ledger = value as Partial<DeliveryRunLedger>;
  if (
    ledger.version !== DELIVERY_RUN_LEDGER_VERSION ||
    !isValidIsoTimestamp(ledger.generatedAt) ||
    ledger.status !== "pass" ||
    ![
      "proof_recorded",
      "proof_not_recorded",
      "proof_reused",
      "prepush_reused",
    ].includes(String(ledger.proofState)) ||
    ledger.blockedReason !== undefined ||
    ledger.interruptedReason !== undefined ||
    (ledger.deliverableDiffFingerprint !== undefined &&
      typeof ledger.deliverableDiffFingerprint !== "string") ||
    (ledger.reviewLoop !== undefined &&
      !isValidReviewLoop(ledger.reviewLoop)) ||
    !Array.isArray(ledger.commandSpans) ||
    !hasCompletedPrAthenaSpans(ledger) ||
    !Array.isArray(ledger.duplicateCommands) ||
    !Array.isArray(ledger.duplicatePackageSuites) ||
    !Array.isArray(ledger.providerSkippedEvents) ||
    !Array.isArray(ledger.gateDecisionEvents) ||
    !ledger.summary ||
    typeof ledger.summary !== "object"
  ) {
    return false;
  }

  try {
    const canonical = createDeliveryRunLedger({
      generatedAt: ledger.generatedAt,
      status: ledger.status,
      proofState: ledger.proofState as DeliveryRunProofState,
      commandSpans: ledger.commandSpans,
      providerSkippedEvents: ledger.providerSkippedEvents.map((event) => ({
        providerName: event.providerName,
        coveredBy: event.coveredBy,
        reason: event.reason,
      })),
      gateDecisionEvents: ledger.gateDecisionEvents,
      reviewLoop: ledger.reviewLoop,
      deliverableDiffFingerprint: ledger.deliverableDiffFingerprint,
    });
    return (
      JSON.stringify(ledger.providerSkippedEvents) ===
        JSON.stringify(canonical.providerSkippedEvents) &&
      JSON.stringify(ledger.duplicateCommands) ===
        JSON.stringify(canonical.duplicateCommands) &&
      JSON.stringify(ledger.duplicatePackageSuites) ===
        JSON.stringify(canonical.duplicatePackageSuites) &&
      JSON.stringify(ledger.summary) === JSON.stringify(canonical.summary)
    );
  } catch {
    return false;
  }
}

async function writeJson(
  rootDir: string,
  relativePath: string,
  value: unknown,
) {
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeDeliveryRunLedger(
  rootDir: string,
  ledger: DeliveryRunLedger,
  options: {
    latestPath?: string;
    historyPath?: string;
    baselinePath?: string;
  } = {},
) {
  const latestPath = options.latestPath ?? DEFAULT_DELIVERY_RUN_LATEST_PATH;
  await writeJson(rootDir, latestPath, ledger);

  if (options.historyPath) {
    await writeJson(rootDir, options.historyPath, ledger);
  }

  if (options.baselinePath) {
    await writeJson(rootDir, options.baselinePath, ledger);
  }

  return {
    latestPath,
    historyPath: options.historyPath,
    baselinePath: options.baselinePath,
  };
}

async function readJsonOrNull<T>(rootDir: string, relativePath: string) {
  try {
    return JSON.parse(
      await readFile(path.join(rootDir, relativePath), "utf8"),
    ) as T;
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

export function summarizeDeliveryRunBaseline(
  ledger: DeliveryRunLedger | null,
): DeliveryRunBaselineSummary {
  if (!ledger) {
    return {
      present: false,
      status: "missing",
      generatedAt: null,
      proofState: null,
      commandCount: 0,
      duplicateCommandCount: 0,
      duplicatePackageSuiteCount: 0,
      providerSkippedCount: 0,
      totalDurationMs: 0,
    };
  }

  return {
    present: true,
    status: ledger.status,
    generatedAt: ledger.generatedAt,
    proofState: ledger.proofState,
    commandCount: ledger.summary.commandCount,
    duplicateCommandCount: ledger.summary.duplicateCommandCount,
    duplicatePackageSuiteCount: ledger.summary.duplicatePackageSuiteCount,
    providerSkippedCount: ledger.summary.providerSkippedCount,
    totalDurationMs: ledger.summary.totalDurationMs,
  };
}

export async function readDeliveryRunLedger(
  rootDir: string,
  relativePath = DEFAULT_DELIVERY_RUN_LATEST_PATH,
) {
  return readJsonOrNull<DeliveryRunLedger>(rootDir, relativePath);
}

export async function readDeliveryRunBaseline(
  rootDir: string,
  relativePath = DEFAULT_DELIVERY_RUN_BASELINE_PATH,
) {
  try {
    const ledger = await readJsonOrNull<unknown>(rootDir, relativePath);
    return isCanonicalPassingLedger(ledger) ? ledger : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function buildPartialDeliveryRunBaseline(
  rootDir: string,
  relativePath = DEFAULT_DELIVERY_RUN_BASELINE_PATH,
) {
  return summarizeDeliveryRunBaseline(
    await readDeliveryRunBaseline(rootDir, relativePath),
  );
}

/**
 * A baseline only needs the comparable facts, so both the worktree-local ledger
 * and a tracked telemetry record satisfy it — the latter is what makes the
 * comparison cross-delivery rather than confined to one worktree.
 */
export type DeliveryRunBaselineLike = Pick<
  DeliveryRunLedger,
  "generatedAt" | "summary" | "reviewLoop"
>;

/**
 * Summary lines are read by agents and relayed verbatim into delivery handoffs,
 * and the baseline can come from a committed record any branch authored. Any
 * value interpolated from that record is therefore untrusted input: strip
 * control characters and newlines so a record cannot inject ANSI escapes or
 * forge additional "[pr:athena]" lines.
 */
function safeField(value: string, limit = 80) {
  return value
    // eslint-disable-next-line no-control-regex
    // C0/C1 controls and DEL close the ANSI and forged-prefix vectors; bidi
    // overrides, separators and zero-width characters close visual reordering
    // of a line that handoffs relay verbatim.
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069\ufeff]/g, " ")
    .trim()
    .slice(0, limit);
}

/** Locale-independent thousands separators so summary lines stay deterministic. */
function formatCostAmount(amount: number) {
  return String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/**
 * A cost delta is only meaningful between runs metered the same way, so it is
 * computed only when the units match, and a change of reporting platform is
 * called out rather than silently folded into the number.
 */
function formatCostComparison(
  current: NonNullable<DeliveryRunReviewLoopSummary["reviewCost"]>,
  baseline: DeliveryRunReviewLoopSummary["reviewCost"],
) {
  if (!baseline) return "";
  if (baseline.unit !== current.unit) {
    return ` (no delta: last pass metered in ${safeField(baseline.unit, 32)})`;
  }
  const delta = current.total - baseline.total;
  const platformShift = baseline.reportedBy !== current.reportedBy
    ? `, reported by ${
      baseline.reportedBy ? safeField(baseline.reportedBy, 32) : "an unnamed platform"
    }`
    : "";
  return ` (delta ${delta >= 0 ? "+" : ""}${
    formatCostAmount(delta)
  } vs last pass${platformShift})`;
}

/**
 * Human/agent-readable terminal summary of a delivery run, sourced from the
 * ledger and a baseline. Printed by the pr:athena CLI after every run so the
 * telemetry that lands in artifacts is also visible in the transcript, and
 * relayable verbatim in delivery handoffs. `baselineSource` names where the
 * comparison came from, because a tracked baseline means "vs the last delivery"
 * while a worktree one means "vs an earlier run of this same ticket".
 */
export function formatDeliveryRunSummary(
  ledger: DeliveryRunLedger,
  baseline: DeliveryRunBaselineLike | null,
  options: { baselineSource?: "tracked" | "worktree" } = {},
): string[] {
  const lines = [
    `[pr:athena] run summary: status=${ledger.status} proof=${ledger.proofState}` +
      ` durationMs=${ledger.summary.totalDurationMs}` +
      ` commands=${ledger.summary.commandCount}` +
      ` failed=${ledger.summary.failedCommandCount}` +
      ` duplicates=${ledger.summary.duplicateCommandCount}` +
      (ledger.blockedReason
        ? ` blocked="${safeField(ledger.blockedReason, 120)}"`
        : "") +
      (ledger.interruptedReason
        ? ` interrupted="${safeField(ledger.interruptedReason, 120)}"`
        : ""),
  ];

  if (baseline) {
    const delta = ledger.summary.totalDurationMs -
      baseline.summary.totalDurationMs;
    lines.push(
      `[pr:athena] baseline: last pass ${safeField(baseline.generatedAt, 32)}` +
        (options.baselineSource ? ` source=${options.baselineSource}` : "") +
        ` durationMs=${baseline.summary.totalDurationMs}` +
        ` (delta ${delta >= 0 ? "+" : ""}${delta}ms)`,
    );
  } else {
    lines.push("[pr:athena] baseline: none recorded yet");
  }

  if (ledger.reviewLoop) {
    const { reviewLoop } = ledger;
    const findings = reviewLoop.findingCounts
      ? ` findings P0=${reviewLoop.findingCounts.P0}` +
        ` P1=${reviewLoop.findingCounts.P1}` +
        ` P2=${reviewLoop.findingCounts.P2}` +
        ` P3=${reviewLoop.findingCounts.P3}`
      : "";
    const deferred = reviewLoop.deferredExpansionCount > 0
      ? ` deferred=${reviewLoop.deferredExpansionCount}` +
        ` (${reviewLoop.deferredIssueIds.map((id) => safeField(id, 24)).join(", ")})`
      : " deferred=0";
    lines.push(
      `[pr:athena] review loop: provider=${safeField(reviewLoop.providerId, 32)}` +
        ` run=${safeField(reviewLoop.runId, 48)} iterations=${reviewLoop.iterationCount}` +
        findings +
        deferred,
    );

    if (reviewLoop.reviewCost) {
      const cost = reviewLoop.reviewCost;
      const source = cost.reportedBy
        ? `self-reported by ${safeField(cost.reportedBy, 32)}`
        : "self-reported";
      const topReviewers = Object.entries(cost.byReviewer ?? {})
        .sort(([, left], [, right]) => right - left)
        .slice(0, 3)
        .map(
          ([reviewer, amount]) =>
            `${safeField(reviewer, 32)} ${formatCostAmount(amount)}`,
        )
        .join(", ");
      lines.push(
        `[pr:athena] review cost: ${formatCostAmount(cost.total)} ${
        safeField(cost.unit, 32)
      }` +
          ` (${source})` +
          formatCostComparison(cost, baseline?.reviewLoop?.reviewCost) +
          (topReviewers ? ` top: ${topReviewers}` : ""),
      );
    }
  } else {
    lines.push("[pr:athena] review loop: no telemetry recorded");
  }

  return lines;
}

export function deliveryRunHistoryPath(
  generatedAt: string,
  historyDir = DEFAULT_DELIVERY_RUN_HISTORY_DIR,
) {
  return path.join(historyDir, `${generatedAt.replace(/[:.]/g, "-")}.json`);
}

/**
 * Baseline semantics: the most recent *passing* run prior to the current one.
 * Called before the current run overwrites latest.json, so a passing previous
 * latest is preserved as the comparison point and a failing/blocked previous
 * latest leaves the existing baseline untouched.
 */
export async function promotePassingLatestToBaseline(
  rootDir: string,
  options: { latestPath?: string; baselinePath?: string } = {},
) {
  const latest = await readDeliveryRunLedger(
    rootDir,
    options.latestPath ?? DEFAULT_DELIVERY_RUN_LATEST_PATH,
  );
  if (!isCanonicalPassingLedger(latest)) {
    return { promoted: false as const };
  }
  await writeJson(
    rootDir,
    options.baselinePath ?? DEFAULT_DELIVERY_RUN_BASELINE_PATH,
    latest,
  );
  return { promoted: true as const, generatedAt: latest.generatedAt };
}

export async function pruneDeliveryRunHistory(
  rootDir: string,
  options: { historyDir?: string; limit?: number } = {},
) {
  const historyDir = options.historyDir ?? DEFAULT_DELIVERY_RUN_HISTORY_DIR;
  const limit = options.limit ?? DEFAULT_DELIVERY_RUN_HISTORY_LIMIT;
  let entries: string[];
  try {
    entries = await readdir(path.join(rootDir, historyDir));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { removed: [] as string[] };
    }
    throw error;
  }
  const removed = entries
    .filter((entry) => entry.endsWith(".json"))
    .sort((left, right) => right.localeCompare(left))
    .slice(Math.max(0, limit));
  await Promise.all(
    removed.map((entry) =>
      rm(path.join(rootDir, historyDir, entry), { force: true }),
    ),
  );
  return { removed };
}
