import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  createDeliveryRunLedger,
  deliveryRunHistoryPath,
  formatDeliveryRunSummary,
  promotePassingLatestToBaseline,
  pruneDeliveryRunHistory,
  readDeliveryRunBaseline,
  type DeliveryRunGateDecisionEvent,
  type DeliveryRunProviderSkippedEvent,
  type DeliveryRunCommandSpan,
  type DeliveryRunCommandStatus,
  type DeliveryRunLedger,
  type DeliveryRunBaselineLike,
  type DeliveryRunProofState,
  type DeliveryRunReviewLoopSummary,
  type DeliveryRunStatus,
  writeDeliveryRunLedger,
} from "./harness-delivery-run-ledger";
import {
  collectChangedPathsForDiff,
  readLatestPassingDeliveryRunTelemetry,
} from "./delivery-run-telemetry";
import { collectDeliverableDiffFingerprint } from "./delivery-diff-fingerprint";
import { ATHENA_PR_VALIDATION_GATE_ID } from "./harness-gate-registry";
import {
  discoverHarnessObligationRecords,
  resolveHarnessObligationStorageContext,
} from "./harness-obligation-records";
import { evaluatePrAthenaPreparationReceipt } from "./pr-athena-prepare";

const DEFAULT_PROVIDER_EVIDENCE_PATH =
  "artifacts/harness-delivery-runs/provider-evidence.json";
const DECISION_EVENTS_GIT_PATH = "codex/harness-obligations/v1/events";

type CommandResult = {
  exitCode: number;
  providerSkippedEvents?: DeliveryRunProviderSkippedEvent[];
};

type ExpectedGateDecisionEvent = {
  invocationId: string;
  parentStartToken: string;
  gateId: string;
  candidate: {
    treeSha: string;
    baseRef: string;
    baseTipSha: string;
    diffBaseSha: string;
    worktreeId: string;
  };
};

type CommandRunner = (
  command: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) => Promise<CommandResult>;

type PrAthenaDeliveryRunOptions = {
  nowIso?: () => string;
  monotonicMs?: () => number;
  runCommand?: CommandRunner;
  writeLedger?: boolean;
  resolveGateDecisionExpectation?: (
    rootDir: string,
    invocationId: string,
    parentStartToken: string,
  ) => Promise<ExpectedGateDecisionEvent>;
  consumeGateDecisionEvents?: (
    rootDir: string,
    expected: ExpectedGateDecisionEvent,
    providerExitCode: number,
  ) => Promise<DeliveryRunGateDecisionEvent[]>;
  resolveReviewLoopSummary?: (
    rootDir: string,
  ) => Promise<DeliveryRunReviewLoopSummary | undefined>;
  resolveDeliverableFingerprint?: (rootDir: string) => string | undefined;
};

type PrAthenaPhase = {
  phase: "prepare" | "preflight" | "validate" | "record-proof" | "scorecard";
  command: string[];
};

const PR_ATHENA_PHASES: PrAthenaPhase[] = [
  { phase: "prepare", command: ["bun", "run", "pr:athena:prepare"] },
  { phase: "preflight", command: ["bun", "run", "pr:athena:preflight"] },
  { phase: "validate", command: ["bun", "run", "pr:athena:validate"] },
  { phase: "record-proof", command: ["bun", "run", "pr:athena:record-proof"] },
];
const PR_ATHENA_SCORECARD_PHASE: PrAthenaPhase = {
  phase: "scorecard",
  command: ["bun", "run", "pr:athena:scorecard"],
};

const PROVIDER_EVIDENCE_COMMAND = "write-provider-evidence";
const PROOF_GIT_PATH = "codex/pre-push-pr-athena-proof.json";

function commandToString(command: string[]) {
  return command
    .map((part) =>
      /\s/.test(part) ? `'${part.replaceAll("'", "'\\''")}'` : part,
    )
    .join(" ");
}

export async function captureAndForwardProcessStream(
  stream: ReadableStream<Uint8Array> | null | undefined,
  forward: (chunk: Uint8Array) => unknown | Promise<unknown>,
) {
  if (!stream) return "";

  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let captured = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    captured += decoder.decode(value, { stream: true });
    await forward(value);
  }
  captured += decoder.decode();
  return captured;
}

async function runProcess(
  command: string[],
  options: { cwd: string; env?: NodeJS.ProcessEnv },
) {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
    env: options.env,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    captureAndForwardProcessStream(process.stdout, (chunk) =>
      Bun.write(Bun.stdout, chunk),
    ),
    captureAndForwardProcessStream(process.stderr, (chunk) =>
      Bun.write(Bun.stderr, chunk),
    ),
    process.exited,
  ]);
  return {
    exitCode,
    providerSkippedEvents: parseProviderSkippedEvents(stdout),
  };
}

async function runGitStdout(rootDir: string, args: string[]) {
  const process = Bun.spawn(["git", ...args], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
    env: buildGitProcessEnv(),
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `git ${args.join(" ")} failed`);
  }

  return stdout.trim();
}

function buildGitProcessEnv(env: NodeJS.ProcessEnv = process.env) {
  return Object.fromEntries(
    Object.entries(env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

export async function writePrAthenaProviderEvidence(
  rootDir: string,
  evidencePath = DEFAULT_PROVIDER_EVIDENCE_PATH,
) {
  const treeSha = await runGitStdout(rootDir, ["write-tree"]);
  const absolutePath = path.join(rootDir, evidencePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await Bun.write(
    absolutePath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        provider: "pr:athena:delivery-run",
        treeSha,
        capabilities: [
          {
            capability: "root-script-tests",
            command: "bun run test:coverage:scripts",
          },
          {
            capability: "athena-webapp-vitest",
            command: "bun run --filter '@athena/webapp' test:coverage",
            coverage: { mode: "full" },
          },
          {
            capability: "athena-webapp-typecheck",
            command:
              "bunx tsc --noEmit -p packages/athena-webapp/tsconfig.json",
          },
        ],
      },
      null,
      2,
    )}\n`,
  );
}

export function parseProviderSkippedEvents(
  output: string,
): DeliveryRunProviderSkippedEvent[] {
  return output.split("\n").flatMap((line) => {
    try {
      const parsed = JSON.parse(line) as {
        type?: string;
        status?: string;
        capability?: string;
        command?: string;
        providedBy?: string;
      };

      if (
        parsed.type !== "provider_skipped" ||
        parsed.status !== "covered_by_provider" ||
        !parsed.providedBy ||
        !parsed.capability ||
        !parsed.command
      ) {
        return [];
      }

      return [
        {
          providerName: parsed.providedBy,
          coveredBy: parsed.command,
          reason: parsed.capability,
        },
      ];
    } catch {
      return [];
    }
  });
}

async function resolveDecisionEventsDir(rootDir: string) {
  return path.resolve(
    rootDir,
    await runGitStdout(rootDir, [
      "rev-parse",
      "--git-path",
      DECISION_EVENTS_GIT_PATH,
    ]),
  );
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseGateDecisionEvent(
  value: unknown,
  expected: ExpectedGateDecisionEvent,
): DeliveryRunGateDecisionEvent {
  const event = value as Record<string, unknown>;
  const candidate = event?.candidate as Record<string, unknown> | undefined;
  const decision = event?.decision as Record<string, unknown> | undefined;
  const resolutions = decision?.resolutions;
  const findings = decision?.findings;
  const diagnostics = decision?.diagnostics;
  const remediation = decision?.remediation as
    Record<string, unknown> | undefined;
  const decisionCandidate = decision?.candidate as
    Record<string, unknown> | undefined;
  const sequence = event?.sequence;
  if (
    event?.schemaVersion !== 1 ||
    event.kind !== "gate_decision" ||
    event.invocationId !== expected.invocationId ||
    event.invocationMode !== "outer" ||
    event.parentIdentity !== "pr:athena:delivery-run" ||
    event.parentStartToken !== expected.parentStartToken ||
    event.gateId !== expected.gateId ||
    ![
      "evaluated",
      "candidate_changed",
      "provider_failed",
      "completed",
    ].includes(String(sequence)) ||
    candidate?.treeSha !== expected.candidate.treeSha ||
    candidate.baseRef !== expected.candidate.baseRef ||
    candidate.baseTipSha !== expected.candidate.baseTipSha ||
    candidate.diffBaseSha !== expected.candidate.diffBaseSha ||
    candidate.worktreeId !== expected.candidate.worktreeId ||
    !nonEmpty(event.context) ||
    typeof event.admitted !== "boolean" ||
    !nonEmpty(event.preventedCostClass) ||
    !nonEmpty(event.timestamp) ||
    !Number.isFinite(Date.parse(event.timestamp)) ||
    decision?.gateId !== expected.gateId ||
    decision.admitted !== event.admitted ||
    decision.preventedCostClass !== event.preventedCostClass ||
    decisionCandidate?.treeSha !== expected.candidate.treeSha ||
    decisionCandidate.baseRef !== expected.candidate.baseRef ||
    decisionCandidate.baseTipSha !== expected.candidate.baseTipSha ||
    decisionCandidate.diffBaseSha !== expected.candidate.diffBaseSha ||
    decisionCandidate.worktreeId !== expected.candidate.worktreeId ||
    !Array.isArray(resolutions) ||
    !Array.isArray(findings) ||
    !Array.isArray(diagnostics) ||
    !Array.isArray(remediation?.machine) ||
    !Array.isArray(remediation.human)
  ) {
    throw new Error(
      "Harness gate decision event failed correlation validation.",
    );
  }

  return {
    invocationId: expected.invocationId,
    invocationMode: "outer",
    parentIdentity: "pr:athena:delivery-run",
    parentStartToken: expected.parentStartToken,
    sequence: sequence as DeliveryRunGateDecisionEvent["sequence"],
    gateId: expected.gateId,
    treeSha: candidate.treeSha as string,
    baseRef: candidate.baseRef as string,
    baseTipSha: candidate.baseTipSha as string,
    diffBaseSha: candidate.diffBaseSha as string,
    worktreeId: candidate.worktreeId as string,
    context: event.context,
    admitted: event.admitted,
    preventedCostClass: event.preventedCostClass,
    resolutionKinds: resolutions.map((resolution) => {
      const value = resolution as Record<string, unknown>;
      const kind = value?.kind;
      if (
        !nonEmpty(kind) ||
        value.gateId !== expected.gateId ||
        !nonEmpty(value.obligationId)
      ) {
        throw new Error("Malformed gate resolution event.");
      }
      return kind;
    }),
    findingCodes: findings.map((finding) => {
      const code = (finding as { code?: unknown })?.code;
      if (!nonEmpty(code)) throw new Error("Malformed gate finding event.");
      return code;
    }),
    timestamp: event.timestamp,
  };
}

function assertAllowedGateEventSequence(
  events: DeliveryRunGateDecisionEvent[],
  providerExitCode: number,
) {
  const sequences = events.map((event) => event.sequence);
  if (
    new Set(sequences).size !== sequences.length ||
    sequences[0] !== "evaluated"
  ) {
    throw new Error(
      "Harness gate decision events have invalid sequence cardinality.",
    );
  }
  const evaluated = events[0];
  const terminal = events[1];
  const valid =
    (providerExitCode === 0 &&
      events.length === 2 &&
      evaluated.admitted &&
      terminal?.sequence === "completed" &&
      terminal.admitted) ||
    (providerExitCode !== 0 &&
      ((!evaluated.admitted && events.length === 1) ||
        (evaluated.admitted &&
          events.length === 2 &&
          (terminal?.sequence === "candidate_changed" ||
            terminal?.sequence === "provider_failed"))));
  if (!valid) {
    throw new Error(
      "Harness gate decision events do not match provider outcome.",
    );
  }
  if (
    terminal &&
    (terminal.context !== evaluated.context ||
      terminal.preventedCostClass !== evaluated.preventedCostClass ||
      terminal.timestamp < evaluated.timestamp)
  ) {
    throw new Error("Harness gate decision terminal event is inconsistent.");
  }
}

export async function consumeHarnessGateDecisionEvents(
  rootDir: string,
  expected: ExpectedGateDecisionEvent,
  providerExitCode: number,
): Promise<DeliveryRunGateDecisionEvent[]> {
  const eventsDir = await resolveDecisionEventsDir(rootDir);
  const consumedDir = path.join(eventsDir, "consumed");
  const prefix = `${expected.invocationId}--`;
  const [availableNames, consumedNames] = await Promise.all([
    readdir(eventsDir).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? [] : Promise.reject(error),
    ),
    readdir(consumedDir).catch((error: NodeJS.ErrnoException) =>
      error.code === "ENOENT" ? [] : Promise.reject(error),
    ),
  ]);
  if (consumedNames.some((name) => name.startsWith(prefix))) {
    throw new Error("Harness gate decision events were already consumed.");
  }
  const names = availableNames.filter(
    (name) => name.startsWith(prefix) && name.endsWith(".json"),
  );
  if (names.length === 0) {
    throw new Error("Harness gate decision event is missing.");
  }
  const parsed = await Promise.all(
    names.map(async (name) => {
      const event = parseGateDecisionEvent(
        JSON.parse(await readFile(path.join(eventsDir, name), "utf8")),
        expected,
      );
      if (name !== `${prefix}${event.sequence}.json`) {
        throw new Error("Harness gate decision event filename is invalid.");
      }
      return { name, event };
    }),
  );
  const order = new Map([
    ["evaluated", 0],
    ["candidate_changed", 1],
    ["provider_failed", 1],
    ["completed", 1],
  ]);
  parsed.sort(
    (left, right) =>
      order.get(left.event.sequence)! - order.get(right.event.sequence)!,
  );
  assertAllowedGateEventSequence(
    parsed.map(({ event }) => event),
    providerExitCode,
  );

  await mkdir(consumedDir, { recursive: true, mode: 0o700 });
  for (const { name } of parsed) {
    await rename(path.join(eventsDir, name), path.join(consumedDir, name));
  }
  return parsed.map(({ event }) => event);
}

async function resolveGateDecisionExpectation(
  rootDir: string,
  invocationId: string,
  parentStartToken: string,
): Promise<ExpectedGateDecisionEvent> {
  const preparation = await evaluatePrAthenaPreparationReceipt(rootDir);
  if (!preparation.prepared) {
    throw new Error(`Cannot correlate gate decision: ${preparation.reason}.`);
  }
  const { worktreeId } = await resolveHarnessObligationStorageContext(
    rootDir,
    {},
  );
  return {
    invocationId,
    parentStartToken,
    gateId: ATHENA_PR_VALIDATION_GATE_ID,
    candidate: {
      treeSha: preparation.candidate.treeSha,
      baseRef: preparation.candidate.baseRef,
      baseTipSha: preparation.candidate.baseTipSha,
      diffBaseSha: preparation.candidate.diffBaseSha,
      worktreeId,
    },
  };
}

async function clearRecordedProof(rootDir: string) {
  try {
    const proofPath = path.resolve(
      rootDir,
      await runGitStdout(rootDir, ["rev-parse", "--git-path", PROOF_GIT_PATH]),
    );
    await rm(proofPath, { force: true });
  } catch {
    // Best-effort cleanup; the nonzero wrapper result is still authoritative.
  }
}

function interruptedExitCode(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "signal" in error &&
    typeof error.signal === "string"
  ) {
    return error.signal === "SIGINT" ? 130 : 1;
  }

  return null;
}

/**
 * Fold the newest review-evidence record's loop telemetry into the ledger so
 * "how many rounds, what got found, what was deferred" survives repo-side
 * instead of living only in Linear comments. Best-effort: records are optional
 * (telemetry is a newer manifest field) and storage may be unresolvable in
 * non-git contexts, so failures degrade to an absent reviewLoop section.
 */
async function resolveReviewLoopSummaryFromRecords(
  rootDir: string,
): Promise<DeliveryRunReviewLoopSummary | undefined> {
  try {
    const { records } = await discoverHarnessObligationRecords(rootDir, {
      gateId: ATHENA_PR_VALIDATION_GATE_ID,
      obligationId: "review.green",
    });
    return records
      .flatMap((record) =>
        record.resolution.kind === "evidence" &&
        record.resolution.reviewLoopTelemetry
          ? [
              {
                providerId: record.resolution.providerId,
                runId: record.resolution.runId,
                finalPassId: record.resolution.finalPassId,
                recordedAt: record.createdAt,
                ...record.resolution.reviewLoopTelemetry,
              },
            ]
          : [],
      )
      .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))
      .at(0);
  } catch {
    return undefined;
  }
}

/**
 * The tracked telemetry corpus wins over the worktree ledger: every ticket
 * starts in a fresh worktree, so the local baseline is empty on a first run and
 * only ever compares runs of the same ticket. A committed record compares this
 * delivery against the last one that landed.
 */
export async function resolveSummaryBaseline(
  rootDir: string,
  options: { currentBranch?: string } = {},
): Promise<{
  baseline: DeliveryRunBaselineLike | null;
  baselineSource?: "tracked" | "worktree";
}> {
  // Records this branch already committed describe this same delivery, so
  // comparing against them would report a near-zero self-delta dressed as a
  // cross-delivery trend.
  const currentBranch = options.currentBranch ?? currentBranchName(rootDir);
  const tracked = await readLatestPassingDeliveryRunTelemetry(rootDir, {
    excludeBranch: currentBranch,
  }).catch(() => null);
  if (tracked) return { baseline: tracked, baselineSource: "tracked" };

  const local = await readDeliveryRunBaseline(rootDir).catch(() => null);
  return local
    ? { baseline: local, baselineSource: "worktree" }
    : { baseline: null };
}

function currentBranchName(rootDir: string) {
  const result = Bun.spawnSync(["git", "branch", "--show-current"], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  // Records written on a detached HEAD are named "detached-head", so the
  // exclusion must use the same name or a run compares against itself.
  const branch = result.exitCode === 0 ? result.stdout.toString().trim() : "";
  return branch || "detached-head";
}

/** Best-effort: a fingerprint failure must not abort a gate run. */
function defaultDeliverableFingerprint(rootDir: string) {
  try {
    return collectDeliverableDiffFingerprint(
      rootDir,
      "origin/main",
      collectChangedPathsForDiff(rootDir, "origin/main"),
    );
  } catch {
    return undefined;
  }
}

function interruptedReason(error: unknown) {
  if (
    error &&
    typeof error === "object" &&
    "signal" in error &&
    typeof error.signal === "string"
  ) {
    return error.signal;
  }

  return error instanceof Error ? error.message : "command interrupted";
}

export async function runPrAthenaDeliveryRun(
  rootDir: string,
  options: PrAthenaDeliveryRunOptions = {},
): Promise<{
  exitCode: number;
  ledger: DeliveryRunLedger;
}> {
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const monotonicMs = options.monotonicMs ?? (() => performance.now());
  const runCommand = options.runCommand ?? runProcess;
  const shouldWriteLedger = options.writeLedger ?? true;
  const commandSpans: DeliveryRunCommandSpan[] = [];

  // Captured before the phases run: this names the tree the gate is about to
  // validate. Recomputing after the run would stamp a tree the run never saw if
  // anything landed mid-run, and the record would then claim a pass for it.
  const deliverableDiffFingerprint = (
    options.resolveDeliverableFingerprint ?? defaultDeliverableFingerprint
  )(rootDir);

  let status: DeliveryRunStatus = "pass";
  let proofState: DeliveryRunProofState = "proof_not_recorded";
  let exitCode = 0;
  let blockedReason: string | undefined;
  let interruptedReasonValue: string | undefined;
  const providerSkippedEvents: DeliveryRunProviderSkippedEvent[] = [];
  const gateDecisionEvents: DeliveryRunGateDecisionEvent[] = [];
  const invocationId = randomUUID();
  const parentStartToken = randomUUID();
  let gateDecisionExpectation: ExpectedGateDecisionEvent | undefined;

  async function runStep(step: PrAthenaPhase) {
    const startedAt = nowIso();
    const startedMs = monotonicMs();
    let commandStatus: DeliveryRunCommandStatus = "pass";
    let commandExitCode: number | null = null;

    try {
      if (step.phase === "validate") {
        gateDecisionExpectation = await (
          options.resolveGateDecisionExpectation ??
          resolveGateDecisionExpectation
        )(rootDir, invocationId, parentStartToken);
      }
      const result = await runCommand(step.command, {
        cwd: rootDir,
        env:
          step.phase === "validate"
            ? {
                ...process.env,
                ATHENA_HARNESS_INVOCATION_ID: invocationId,
                ATHENA_HARNESS_PARENT_START_TOKEN: parentStartToken,
              }
            : process.env,
      });
      providerSkippedEvents.push(...(result.providerSkippedEvents ?? []));
      if (step.phase === "validate") {
        gateDecisionEvents.push(
          ...(await (
            options.consumeGateDecisionEvents ??
            consumeHarnessGateDecisionEvents
          )(rootDir, gateDecisionExpectation!, result.exitCode)),
        );
      }
      commandExitCode = result.exitCode;
      if (result.exitCode !== 0) {
        commandStatus = "fail";
        status = "blocked";
        exitCode = result.exitCode;
        blockedReason = `${step.command.at(-1)} exited with code ${result.exitCode}`;
      }
    } catch (error) {
      const interruptedCode = interruptedExitCode(error);
      commandStatus = interruptedCode === null ? "blocked" : "interrupted";
      commandExitCode = interruptedCode ?? 1;
      status = interruptedCode === null ? "blocked" : "interrupted";
      exitCode = commandExitCode;
      if (status === "interrupted") {
        interruptedReasonValue = interruptedReason(error);
      } else {
        blockedReason = interruptedReason(error);
      }
    }

    const endedMs = monotonicMs();
    commandSpans.push({
      phase: step.phase,
      command: commandToString(step.command),
      startedAt,
      endedAt: nowIso(),
      durationMs: Math.max(0, endedMs - startedMs),
      status: commandStatus,
      exitCode: commandExitCode,
    });

    if (step.phase === "record-proof" && commandStatus === "pass") {
      proofState = "proof_recorded";
    }

    if (
      step.phase !== "record-proof" &&
      commandStatus !== "pass" &&
      proofState === "proof_recorded"
    ) {
      await clearRecordedProof(rootDir);
      proofState = "proof_not_recorded";
    }

    return commandStatus;
  }

  for (const step of PR_ATHENA_PHASES) {
    const commandStatus = await runStep(step);

    if (commandStatus !== "pass") {
      break;
    }
  }

  const reviewLoop = await (
    options.resolveReviewLoopSummary ?? resolveReviewLoopSummaryFromRecords
  )(rootDir);

  let ledger = createDeliveryRunLedger({
    generatedAt: nowIso(),
    status,
    proofState,
    commandSpans,
    providerSkippedEvents,
    gateDecisionEvents,
    blockedReason,
    interruptedReason: interruptedReasonValue,
    reviewLoop,
    ...(deliverableDiffFingerprint ? { deliverableDiffFingerprint } : {}),
  });

  if (shouldWriteLedger) {
    // Preserve the previous passing run as the scorecard's comparison point
    // before this run overwrites latest.json.
    await promotePassingLatestToBaseline(rootDir);
    await writeDeliveryRunLedger(rootDir, ledger);
  }

  if (status === "pass") {
    await runStep(PR_ATHENA_SCORECARD_PHASE);
  }

  ledger = createDeliveryRunLedger({
    generatedAt: nowIso(),
    status,
    proofState,
    commandSpans,
    providerSkippedEvents,
    gateDecisionEvents,
    blockedReason,
    interruptedReason: interruptedReasonValue,
    reviewLoop,
    ...(deliverableDiffFingerprint ? { deliverableDiffFingerprint } : {}),
  });

  if (shouldWriteLedger) {
    await writeDeliveryRunLedger(rootDir, ledger, {
      historyPath: deliveryRunHistoryPath(ledger.generatedAt),
    });
    await pruneDeliveryRunHistory(rootDir);
  }

  return { exitCode, ledger };
}

if (import.meta.main) {
  const [command] = Bun.argv.slice(2);

  if (command === PROVIDER_EVIDENCE_COMMAND) {
    await writePrAthenaProviderEvidence(process.cwd());
    process.exit(0);
  }

  if (command) {
    console.error(
      `Usage: bun scripts/pr-athena-delivery-run.ts [${PROVIDER_EVIDENCE_COMMAND}]`,
    );
    process.exit(1);
  }

  const { exitCode, ledger } = await runPrAthenaDeliveryRun(process.cwd());
  // Observability must never decide the gate: a poisoned tracked record that
  // broke rendering would otherwise turn every later passing run into a crash.
  try {
    const { baseline, baselineSource } = await resolveSummaryBaseline(
      process.cwd(),
    );
    for (
      const line of formatDeliveryRunSummary(ledger, baseline, {
        ...(baselineSource ? { baselineSource } : {}),
      })
    ) {
      console.log(line);
    }
  } catch (error) {
    console.error(
      `[pr:athena] run summary unavailable: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  process.exit(exitCode);
}
