import { mkdir, rm } from "node:fs/promises";
import path from "node:path";

import {
  createDeliveryRunLedger,
  type DeliveryRunProviderSkippedEvent,
  type DeliveryRunCommandSpan,
  type DeliveryRunCommandStatus,
  type DeliveryRunLedger,
  type DeliveryRunProofState,
  type DeliveryRunStatus,
  writeDeliveryRunLedger,
} from "./harness-delivery-run-ledger";

const DEFAULT_PROVIDER_EVIDENCE_PATH =
  "artifacts/harness-delivery-runs/provider-evidence.json";

type CommandResult = {
  exitCode: number;
  providerSkippedEvents?: DeliveryRunProviderSkippedEvent[];
};

type CommandRunner = (command: string[], options: { cwd: string }) => Promise<CommandResult>;

type PrAthenaDeliveryRunOptions = {
  nowIso?: () => string;
  monotonicMs?: () => number;
  runCommand?: CommandRunner;
  writeLedger?: boolean;
};

type PrAthenaPhase = {
  phase: "prepare" | "validate" | "record-proof" | "scorecard";
  command: string[];
};

const PR_ATHENA_PHASES: PrAthenaPhase[] = [
  { phase: "prepare", command: ["bun", "run", "pr:athena:prepare"] },
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
    .map((part) => (/\s/.test(part) ? `'${part.replaceAll("'", "'\\''")}'` : part))
    .join(" ");
}

async function runProcess(command: string[], options: { cwd: string }) {
  const process = Bun.spawn(command, {
    cwd: options.cwd,
    stdout: "pipe",
    stderr: "pipe",
    stdin: "inherit",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (stdout) {
    await Bun.write(Bun.stdout, stdout);
  }
  if (stderr) {
    await Bun.write(Bun.stderr, stderr);
  }
  return { exitCode, providerSkippedEvents: parseProviderSkippedEvents(stdout) };
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
  evidencePath = DEFAULT_PROVIDER_EVIDENCE_PATH
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
        ],
      },
      null,
      2
    )}\n`
  );
}

export function parseProviderSkippedEvents(
  output: string
): DeliveryRunProviderSkippedEvent[] {
  return output
    .split("\n")
    .flatMap((line) => {
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

async function clearRecordedProof(rootDir: string) {
  try {
    const proofPath = path.resolve(
      rootDir,
      await runGitStdout(rootDir, ["rev-parse", "--git-path", PROOF_GIT_PATH])
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
  options: PrAthenaDeliveryRunOptions = {}
): Promise<{
  exitCode: number;
  ledger: DeliveryRunLedger;
}> {
  const nowIso = options.nowIso ?? (() => new Date().toISOString());
  const monotonicMs = options.monotonicMs ?? (() => performance.now());
  const runCommand = options.runCommand ?? runProcess;
  const shouldWriteLedger = options.writeLedger ?? true;
  const commandSpans: DeliveryRunCommandSpan[] = [];

  let status: DeliveryRunStatus = "pass";
  let proofState: DeliveryRunProofState = "proof_not_recorded";
  let exitCode = 0;
  let blockedReason: string | undefined;
  let interruptedReasonValue: string | undefined;
  const providerSkippedEvents: DeliveryRunProviderSkippedEvent[] = [];

  async function runStep(step: PrAthenaPhase) {
    const startedAt = nowIso();
    const startedMs = monotonicMs();
    let commandStatus: DeliveryRunCommandStatus = "pass";
    let commandExitCode: number | null = null;

    try {
      const result = await runCommand(step.command, { cwd: rootDir });
      providerSkippedEvents.push(...(result.providerSkippedEvents ?? []));
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

  let ledger = createDeliveryRunLedger({
    generatedAt: nowIso(),
    status,
    proofState,
    commandSpans,
    providerSkippedEvents,
    blockedReason,
    interruptedReason: interruptedReasonValue,
  });

  if (shouldWriteLedger) {
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
    blockedReason,
    interruptedReason: interruptedReasonValue,
  });

  if (shouldWriteLedger) {
    await writeDeliveryRunLedger(rootDir, ledger);
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
      `Usage: bun scripts/pr-athena-delivery-run.ts [${PROVIDER_EVIDENCE_COMMAND}]`
    );
    process.exit(1);
  }

  const { exitCode } = await runPrAthenaDeliveryRun(process.cwd());
  process.exit(exitCode);
}
