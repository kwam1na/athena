import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const DELIVERY_RUN_LEDGER_VERSION = "1.0" as const;
export const DEFAULT_DELIVERY_RUN_LATEST_PATH =
  "artifacts/harness-delivery-runs/latest.json";
export const DEFAULT_DELIVERY_RUN_BASELINE_PATH =
  "artifacts/harness-delivery-runs/baseline.json";

export type DeliveryRunStatus = "pass" | "fail" | "blocked" | "interrupted";
export type DeliveryRunCommandStatus =
  | "pass"
  | "fail"
  | "blocked"
  | "interrupted";
export type DeliveryRunProofState =
  | "proof_recorded"
  | "proof_not_recorded"
  | "prepush_reused";

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

export type DeliveryRunLedger = {
  version: typeof DELIVERY_RUN_LEDGER_VERSION;
  generatedAt: string;
  status: DeliveryRunStatus;
  proofState: DeliveryRunProofState;
  blockedReason?: string;
  interruptedReason?: string;
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
  summary: {
    commandCount: number;
    failedCommandCount: number;
    duplicateCommandCount: number;
    duplicatePackageSuiteCount: number;
    providerSkippedCount: number;
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
  blockedReason?: string;
  interruptedReason?: string;
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
  input: CreateDeliveryRunLedgerInput
): DeliveryRunLedger {
  const commandSpans = [...input.commandSpans];
  const duplicateCommands = countBy(commandSpans, (span) => span.command).map(
    ([command, count]) => ({ command, count })
  );
  const duplicatePackageSuites = countBy(commandSpans, (span) =>
    span.packageName && span.suite ? `${span.packageName}\u0000${span.suite}` : null
  ).map(([key, count]) => {
    const [packageName, suite] = key.split("\u0000");
    return { packageName, suite, count };
  });
  const providerSkippedEvents = (input.providerSkippedEvents ?? []).map(
    (event) => ({
      ...event,
      status: "covered_by_provider" as const,
    })
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
    commandSpans,
    duplicateCommands,
    duplicatePackageSuites,
    providerSkippedEvents,
    summary: {
      commandCount: commandSpans.length,
      failedCommandCount: commandSpans.filter(
        (span) => span.status !== "pass"
      ).length,
      duplicateCommandCount: duplicateCommands.length,
      duplicatePackageSuiteCount: duplicatePackageSuites.length,
      providerSkippedCount: providerSkippedEvents.length,
      totalDurationMs: commandSpans.reduce(
        (total, span) => total + span.durationMs,
        0
      ),
    },
  };
}

async function writeJson(rootDir: string, relativePath: string, value: unknown) {
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
  } = {}
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
    return JSON.parse(await readFile(path.join(rootDir, relativePath), "utf8")) as T;
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
  ledger: DeliveryRunLedger | null
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
  relativePath = DEFAULT_DELIVERY_RUN_LATEST_PATH
) {
  return readJsonOrNull<DeliveryRunLedger>(rootDir, relativePath);
}

export async function readDeliveryRunBaseline(
  rootDir: string,
  relativePath = DEFAULT_DELIVERY_RUN_BASELINE_PATH
) {
  return readJsonOrNull<DeliveryRunLedger>(rootDir, relativePath);
}

export async function buildPartialDeliveryRunBaseline(
  rootDir: string,
  relativePath = DEFAULT_DELIVERY_RUN_BASELINE_PATH
) {
  return summarizeDeliveryRunBaseline(
    await readDeliveryRunBaseline(rootDir, relativePath)
  );
}
