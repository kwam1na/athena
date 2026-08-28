import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  collectChangedPathsForDiff,
  collectDeliverableDiffFingerprint,
} from "./delivery-diff-fingerprint";
export { collectChangedPathsForDiff } from "./delivery-diff-fingerprint";
import {
  collectSourceLineChanges,
  DEFAULT_SOURCE_LINE_THRESHOLD,
  totalConsiderableSourceLineChanges,
} from "./compound-solution-check";
import { isValidReviewLoopTelemetry } from "./harness-obligation-records";
import {
  DEFAULT_DELIVERY_RUN_LATEST_PATH,
  readDeliveryRunLedger,
  type DeliveryRunLedger,
  type DeliveryRunProofState,
  type DeliveryRunReviewLoopSummary,
  type DeliveryRunStatus,
} from "./harness-delivery-run-ledger";
import {
  runHarnessCliBoundary,
  HarnessUsageError,
  type CommandArguments,
  type HarnessBlockerSource,
} from "./harness-blockers";
import {
  DEFAULT_PORTABLE_SHADOW_PATH,
  isPortableShadowComparison,
  isPortableShadowComparisonRecord,
  readPortableShadowComparison,
  type PortableShadowComparison,
} from "./portable-shadow-observation";

export const DELIVERY_RUN_TELEMETRY_SCHEMA_VERSION = 1 as const;
export const DELIVERY_RUN_TELEMETRY_DIR = "telemetry/delivery-runs";

/**
 * The durable half of delivery-run observability.
 *
 * The ledger under `artifacts/harness-delivery-runs/` is gitignored and lives in
 * one worktree, and obligation records are Git-private per worktree — so with
 * a fresh worktree per ticket, neither can answer "how has delivery cost moved
 * across deliveries?". This record is tracked instead: one small file per
 * recorded run, committed with the delivery, so the trend survives a clone and
 * is readable by anyone with the repo.
 *
 * It is its own artifact rather than a section bolted onto the landed-change
 * report: reports are written for substantial work only, are authored prose, and
 * answer a different question. Telemetry that rides along inside them would be
 * partial by construction and would couple a machine record's lifecycle to a
 * human document's. It lives under `telemetry/` rather than `docs/` for the same
 * reason — `docs/` holds documents written to be read, this is a machine record
 * written to be aggregated.
 *
 * `telemetry/delivery-runs/` is registered as review-neutral and
 * fingerprint-neutral, so
 * committing one of these after the final review pass costs a cheap re-prepare
 * rather than a full re-review, and never stales the landed-change report.
 */
export type DeliveryRunTelemetryRecord = {
  schemaVersion: typeof DELIVERY_RUN_TELEMETRY_SCHEMA_VERSION;
  generatedAt: string;
  branch: string;
  headSha: string;
  /**
   * The deliverable diff this run measured. Committing the record does not
   * move this fingerprint (`telemetry/` is fingerprint-neutral), so it stays
   * valid through its own commit and goes stale exactly when the delivery
   * changes — the same staleness contract the report and solution note use.
   */
  deliverableDiffFingerprint: string;
  status: DeliveryRunStatus;
  proofState: DeliveryRunProofState;
  summary: DeliveryRunLedger["summary"];
  reviewLoop?: DeliveryRunReviewLoopSummary;
  shadowComparison?: PortableShadowComparison;
};

export function buildDeliveryRunTelemetryRecord(
  ledger: DeliveryRunLedger,
  context: {
    branch: string;
    headSha: string;
    deliverableDiffFingerprint: string;
    shadowComparison?: PortableShadowComparison;
  },
): DeliveryRunTelemetryRecord {
  if (
    context.shadowComparison &&
    !isPortableShadowComparison(context.shadowComparison)
  ) {
    throw new Error("Portable shadow comparison is not valid for telemetry.");
  }
  if (
    context.shadowComparison &&
    context.shadowComparison.candidateFingerprint !==
      context.deliverableDiffFingerprint
  ) {
    throw new Error(
      "The portable shadow comparison describes a different deliverable.",
    );
  }
  return {
    schemaVersion: DELIVERY_RUN_TELEMETRY_SCHEMA_VERSION,
    generatedAt: ledger.generatedAt,
    branch: context.branch,
    headSha: context.headSha,
    deliverableDiffFingerprint: context.deliverableDiffFingerprint,
    status: ledger.status,
    proofState: ledger.proofState,
    summary: ledger.summary,
    ...(ledger.reviewLoop ? { reviewLoop: ledger.reviewLoop } : {}),
    ...(context.shadowComparison
      ? {
          shadowComparison: structuredClone(context.shadowComparison),
        }
      : {}),
  };
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

/**
 * One file per run, named by timestamp and branch. Distinct branches never
 * collide, so parallel ticket worktrees can each commit their own record
 * without the merge conflicts an append-only shared ledger would create.
 */
export function deliveryRunTelemetryPath(
  record: DeliveryRunTelemetryRecord,
  telemetryDir = DELIVERY_RUN_TELEMETRY_DIR,
) {
  const stamp = record.generatedAt.replace(/[:.]/g, "-");
  const branch = slugify(record.branch) || "unknown-branch";
  return path.join(telemetryDir, `${stamp}-${branch}.json`);
}

export async function writeDeliveryRunTelemetryRecord(
  rootDir: string,
  record: DeliveryRunTelemetryRecord,
  telemetryDir = DELIVERY_RUN_TELEMETRY_DIR,
) {
  const relativePath = deliveryRunTelemetryPath(record, telemetryDir);
  const absolutePath = path.join(rootDir, relativePath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  return { path: relativePath };
}

const RUN_STATUSES: readonly DeliveryRunStatus[] = [
  "pass",
  "fail",
  "blocked",
  "interrupted",
];
const PROOF_STATES: readonly DeliveryRunProofState[] = [
  "proof_recorded",
  "proof_not_recorded",
  "prepush_reused",
];
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/;
const SUMMARY_NUMERIC_FIELDS = [
  "commandCount",
  "failedCommandCount",
  "duplicateCommandCount",
  "duplicatePackageSuiteCount",
  "providerSkippedCount",
  "gateDecisionCount",
  "totalDurationMs",
] as const;
/**
 * Validated strictly because these records are read back from the tracked tree
 * and rendered into the run summary that delivery handoffs relay verbatim. A
 * loose predicate here turns a hand-authored file into printed output and into
 * the cross-delivery baseline.
 */
function isTelemetryRecord(
  value: unknown,
): value is DeliveryRunTelemetryRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<DeliveryRunTelemetryRecord>;
  const summary = record.summary as Record<string, unknown> | undefined;
  return (
    record.schemaVersion === DELIVERY_RUN_TELEMETRY_SCHEMA_VERSION &&
    typeof record.generatedAt === "string" &&
    ISO_TIMESTAMP.test(record.generatedAt) &&
    typeof record.branch === "string" &&
    record.branch.length > 0 &&
    typeof record.headSha === "string" &&
    record.headSha.length > 0 &&
    typeof record.deliverableDiffFingerprint === "string" &&
    record.deliverableDiffFingerprint.length > 0 &&
    RUN_STATUSES.includes(record.status as DeliveryRunStatus) &&
    PROOF_STATES.includes(record.proofState as DeliveryRunProofState) &&
    Boolean(summary) &&
    typeof summary === "object" &&
    SUMMARY_NUMERIC_FIELDS.every(
      (field) =>
        typeof summary[field] === "number" &&
        Number.isFinite(summary[field] as number),
    ) &&
    // reviewLoop is rendered into the summary, so an unvalidated one from a
    // committed record would reach string operations expecting strings.
    (record.reviewLoop === undefined ||
      isValidReviewLoopTelemetry(record.reviewLoop)) &&
    (record.shadowComparison === undefined ||
      (isPortableShadowComparisonRecord(record.shadowComparison) &&
        record.shadowComparison.candidateFingerprint ===
          record.deliverableDiffFingerprint))
  );
}

/**
 * Malformed or future-schema files are skipped rather than thrown on: a trend
 * read must not become a delivery blocker, and the corpus is append-only from
 * many branches.
 */
export async function readDeliveryRunTelemetryRecords(
  rootDir: string,
  telemetryDir = DELIVERY_RUN_TELEMETRY_DIR,
): Promise<DeliveryRunTelemetryRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(path.join(rootDir, telemetryDir));
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return [];
    }
    throw error;
  }

  const records: DeliveryRunTelemetryRecord[] = [];
  for (const entry of entries.filter((name) => name.endsWith(".json"))) {
    try {
      const parsed = JSON.parse(
        await readFile(path.join(rootDir, telemetryDir, entry), "utf8"),
      );
      if (isTelemetryRecord(parsed)) records.push(parsed);
    } catch {
      continue;
    }
  }

  // Timestamp first, then branch: two parallel worktrees can share a ledger
  // timestamp, and readdir order must not decide which delivery a cost trend is
  // measured against.
  return records.sort(
    (left, right) =>
      left.generatedAt.localeCompare(right.generatedAt) ||
      left.branch.localeCompare(right.branch),
  );
}

export async function readLatestPassingDeliveryRunTelemetry(
  rootDir: string,
  options: { telemetryDir?: string; excludeBranch?: string } = {},
) {
  const records = await readDeliveryRunTelemetryRecords(
    rootDir,
    options.telemetryDir ?? DELIVERY_RUN_TELEMETRY_DIR,
  );
  return (
    records
      .filter(
        (record) =>
          record.status === "pass" &&
          (!options.excludeBranch || record.branch !== options.excludeBranch),
      )
      .at(-1) ?? null
  );
}

async function gitStdout(rootDir: string, args: string[]) {
  const process = Bun.spawn(["git", ...args], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed`);
  }
  return stdout.trim();
}

/**
 * Promotes the worktree ledger into the tracked corpus. Deliberately a separate
 * command rather than a step inside `pr:athena`: the gate records a proof over
 * the tree it validated, so writing a tracked file mid-run would invalidate that
 * proof against the very run that produced it. The agent runs this after the
 * gate passes and commits the record with the delivery.
 */
export async function recordDeliveryRunTelemetry(
  rootDir: string,
  options: {
    ledgerPath?: string;
    shadowPath?: string;
    telemetryDir?: string;
    baseRef?: string;
  } = {},
) {
  const ledger = await readDeliveryRunLedger(
    rootDir,
    options.ledgerPath ?? DEFAULT_DELIVERY_RUN_LATEST_PATH,
  );
  if (!ledger) {
    throw new Error(
      "No delivery-run ledger to record. Run `bun run pr:athena` first.",
    );
  }
  const baseRef = options.baseRef ?? "origin/main";
  if (ledger.status !== "pass") {
    throw new Error(
      `The newest delivery-run ledger describes a ${ledger.status} run` +
        `${ledger.blockedReason ? ` (${ledger.blockedReason})` : ""}. ` +
        "Record telemetry from a passing `bun run pr:athena` run, so the corpus " +
        "describes the delivery that actually shipped.",
    );
  }
  const currentFingerprint = collectDeliverableDiffFingerprint(
    rootDir,
    baseRef,
    collectChangedPathsForDiff(rootDir, baseRef),
  );
  // Without this the recorder would stamp the *current* deliverable onto a run
  // of an older one: pass the gate, edit source, record, and the record claims a
  // tree it never measured — the exact falsification the freshness rule exists
  // to prevent.
  if (ledger.deliverableDiffFingerprint !== currentFingerprint) {
    throw new Error(
      "The newest delivery-run ledger measured a different deliverable than the " +
        "current one. Re-run `bun run pr:athena` so the record describes the tree " +
        "that actually passed.",
    );
  }
  const [branch, headSha, shadowComparison] = await Promise.all([
    gitStdout(rootDir, ["branch", "--show-current"]),
    gitStdout(rootDir, ["rev-parse", "HEAD"]),
    readPortableShadowComparison(
      rootDir,
      options.shadowPath ?? DEFAULT_PORTABLE_SHADOW_PATH,
    ),
  ]);
  if (
    shadowComparison &&
    shadowComparison.candidateFingerprint !== currentFingerprint
  ) {
    throw new Error(
      "The portable shadow artifact describes a different deliverable than the current passing gate.",
    );
  }
  const record = buildDeliveryRunTelemetryRecord(ledger, {
    branch: branch || "detached-head",
    headSha,
    deliverableDiffFingerprint: currentFingerprint,
    ...(shadowComparison ? { shadowComparison } : {}),
  });
  const written = await writeDeliveryRunTelemetryRecord(
    rootDir,
    record,
    options.telemetryDir ?? DELIVERY_RUN_TELEMETRY_DIR,
  );
  return { ...written, record };
}

/**
 * Shares `compound:check`'s solution-note threshold rather than restating the
 * number, so the two durable delivery artifacts agree on what counts as
 * substantial. (The path set feeding the count is still collected separately
 * here; only the threshold is shared.) Telemetry is demanded on the same terms the solution
 * note is: scaled to the delivery, never for a one-line fix.
 */
export const DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD =
  DEFAULT_SOURCE_LINE_THRESHOLD;

export type DeliveryRunTelemetryFindingCode =
  "telemetry_record_missing" | "telemetry_record_malformed";

export type DeliveryRunTelemetryFinding = {
  code: DeliveryRunTelemetryFindingCode;
  message: string;
};

export type DeliveryRunTelemetryCheckInput = {
  /** Paths changed on the branch (committed vs base + working tree + untracked). */
  changedPaths: string[];
  /** Considerable source lines changed, counted exactly as `compound:check` counts them. */
  sourceLineTotal: number;
  /** Parse result for each changed telemetry record, keyed by path. */
  changedRecordContents: Map<string, unknown>;
  /**
   * Record paths git tracks. Only tracked records may satisfy the obligation;
   * an untracked one does not survive the worktree, which is the whole point.
   */
  trackedPaths: ReadonlySet<string>;
  /** Fingerprint of the current deliverable diff, for record staleness. */
  deliverableDiffFingerprint: string;
  /**
   * The deliverable fingerprint of the newest local gate run, when one exists.
   * A record is only producible once a run has completed against the *current*
   * deliverable, so this — not the mere existence of a ledger — is what makes
   * the local demand satisfiable.
   */
  localLedgerFingerprint: string | null;
  /**
   * CI is the merge authority and enforces unconditionally. The local mode's
   * leniency breaks a bootstrap cycle: this check runs inside the gate, and the
   * record it demands can only come from a completed run of that same gate.
   * Demanding a record before such a run exists would block the run that would
   * produce it, and the only escape would be recording a stale ledger under the
   * current fingerprint — precisely the misreported telemetry the freshness
   * rule exists to prevent.
   */
  ciMode: boolean;
  threshold?: number;
};

function isTelemetryRecordPath(repoPath: string) {
  return (
    repoPath.startsWith(`${DELIVERY_RUN_TELEMETRY_DIR}/`) &&
    repoPath.endsWith(".json")
  );
}

export function collectDeliveryRunTelemetryFindings(
  input: DeliveryRunTelemetryCheckInput,
): DeliveryRunTelemetryFinding[] {
  const threshold = input.threshold ?? DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD;
  const findings: DeliveryRunTelemetryFinding[] = [];
  const recordPaths = input.changedPaths.filter(isTelemetryRecordPath);

  const records: DeliveryRunTelemetryRecord[] = [];
  for (const recordPath of recordPaths) {
    const parsed = input.changedRecordContents.get(recordPath);
    if (parsed === undefined) continue;
    if (isTelemetryRecord(parsed)) {
      if (input.trackedPaths.has(recordPath)) records.push(parsed);
    } else {
      findings.push({
        code: "telemetry_record_malformed",
        message:
          `Changed telemetry record ${recordPath} is not a valid ` +
          `schema-v${DELIVERY_RUN_TELEMETRY_SCHEMA_VERSION} delivery-run record. ` +
          `Regenerate it with \`bun run delivery:telemetry-record\` instead of editing by hand.`,
      });
    }
  }

  if (input.sourceLineTotal < threshold) return findings;
  if (
    !input.ciMode &&
    input.localLedgerFingerprint !== input.deliverableDiffFingerprint
  ) {
    return findings;
  }

  const currentRecords = records.filter(
    (record) =>
      record.deliverableDiffFingerprint === input.deliverableDiffFingerprint,
  );
  // A record of a run that did not pass proves the gate ran, not that it
  // passed, so it cannot stand as this delivery's telemetry.
  const passingCurrentRecords = currentRecords.filter(
    (record) => record.status === "pass",
  );
  if (passingCurrentRecords.length > 0) return findings;
  if (currentRecords.length > 0) {
    findings.push({
      code: "telemetry_record_missing",
      message:
        `Substantial delivery detected (${input.sourceLineTotal} changed source lines, threshold ` +
        `${threshold}) but every current ${DELIVERY_RUN_TELEMETRY_DIR}/ record describes a run that ` +
        `did not pass. Re-run \`bun run pr:athena\` to a pass, then \`bun run delivery:telemetry-record\`.`,
    });
    return findings;
  }

  findings.push({
    code: "telemetry_record_missing",
    message:
      records.length > 0
        ? `Substantial delivery detected (${input.sourceLineTotal} changed source lines, threshold ` +
          `${threshold}) but every ${DELIVERY_RUN_TELEMETRY_DIR}/ record on this branch describes an ` +
          `older deliverable diff. Re-run \`bun run pr:athena\`, then \`bun run delivery:telemetry-record\`, ` +
          `and commit the refreshed record so the telemetry describes what actually merges.`
        : `Substantial delivery detected (${input.sourceLineTotal} changed source lines, threshold ` +
          `${threshold}) without a ${DELIVERY_RUN_TELEMETRY_DIR}/ record on this branch. After a passing ` +
          `\`bun run pr:athena\`, run \`bun run delivery:telemetry-record\` and commit the record ` +
          `so the run's telemetry survives this worktree.`,
  });
  return findings;
}

export type DeliveryRunTelemetryCheckOptions = {
  baseRef?: string;
  ciMode?: boolean;
  ledgerPath?: string;
  threshold?: number;
};

function gitLines(rootDir: string, args: string[]) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`,
    );
  }
  return result.stdout
    .toString()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * Only a *passing* run makes the demand satisfiable, because the recorder
 * refuses a non-passing ledger. Keying on any terminal status would deadlock a
 * non-interactive agent: a blocked run stamps the current fingerprint, the
 * sensor starts enforcing, and nothing can produce the record it asks for.
 */
function readLocalLedgerFingerprint(rootDir: string, ledgerPath: string) {
  try {
    const ledger = JSON.parse(
      readFileSync(path.join(rootDir, ledgerPath), "utf8"),
    ) as Partial<DeliveryRunLedger>;
    return ledger.status === "pass" &&
      typeof ledger.deliverableDiffFingerprint === "string"
      ? ledger.deliverableDiffFingerprint
      : null;
  } catch {
    return null;
  }
}

export function evaluateDeliveryRunTelemetryCheck(
  rootDir: string,
  options: DeliveryRunTelemetryCheckOptions = {},
) {
  const baseRef = options.baseRef ?? "origin/main";
  const changedPaths = collectChangedPathsForDiff(rootDir, baseRef);
  // Untracked files are still parsed for the malformed-shape diagnostic, but
  // only tracked content can satisfy the obligation: a record that exists only
  // in this worktree is exactly what the obligation says must not happen.
  const trackedPaths = new Set(
    gitLines(rootDir, ["ls-files", DELIVERY_RUN_TELEMETRY_DIR]),
  );

  const changedRecordContents = new Map<string, unknown>();
  for (const repoPath of changedPaths.filter(isTelemetryRecordPath)) {
    const absolutePath = path.join(rootDir, repoPath);
    // A record deleted on this branch is a removal, not a corruption.
    if (!existsSync(absolutePath)) continue;
    try {
      changedRecordContents.set(
        repoPath,
        JSON.parse(readFileSync(absolutePath, "utf8")),
      );
    } catch {
      changedRecordContents.set(repoPath, null);
    }
  }

  const findings = collectDeliveryRunTelemetryFindings({
    changedPaths,
    sourceLineTotal: totalConsiderableSourceLineChanges(
      collectSourceLineChanges(rootDir, baseRef, changedPaths),
    ),
    changedRecordContents,
    trackedPaths,
    deliverableDiffFingerprint: collectDeliverableDiffFingerprint(
      rootDir,
      baseRef,
      changedPaths,
    ),
    localLedgerFingerprint: readLocalLedgerFingerprint(
      rootDir,
      options.ledgerPath ?? DEFAULT_DELIVERY_RUN_LATEST_PATH,
    ),
    ciMode: options.ciMode ?? Boolean(process.env.CI),
    ...(options.threshold === undefined
      ? {}
      : { threshold: options.threshold }),
  });

  return {
    status: findings.length === 0 ? ("pass" as const) : ("fail" as const),
    findings,
  };
}

export function assertDeliveryRunTelemetryCheck(
  rootDir: string,
  options: DeliveryRunTelemetryCheckOptions = {},
) {
  const result = evaluateDeliveryRunTelemetryCheck(rootDir, options);
  if (result.status === "pass") return;
  throw new Error(
    `Delivery-run telemetry check failed:\n${result.findings
      .map((finding) => `- ${finding.message}`)
      .join("\n")}`,
  );
}

export function parseArgs(
  argv: string[],
  source: HarnessBlockerSource = {
    kind: "command",
    id: "delivery:telemetry-check",
  },
) {
  const [command, ...rest] = argv;
  const usage = {
    source,
    validFlags: ["record", "check", "--base <ref>"],
  };
  if (command !== "record" && command !== "check") {
    throw new HarnessUsageError({
      ...usage,
      message:
        "Usage: bun scripts/delivery-run-telemetry.ts <record|check> [--base <ref>]",
    });
  }
  let baseRef = "origin/main";
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === "--base") {
      baseRef = rest[++index] ?? "";
      if (!baseRef) {
        throw new HarnessUsageError({
          ...usage,
          message: "Missing value for --base.",
        });
      }
      continue;
    }
    throw new HarnessUsageError({
      ...usage,
      message: `Unknown argument: ${rest[index]}.`,
    });
  }
  return { command, baseRef };
}

/**
 * One boundary serves both subcommands, so each blocking exit names the source
 * that actually owns it: the live telemetry sensor command for `check`, and the
 * obligation the record step exists to satisfy for `record`.
 */
export function telemetryCliContract(argv: string[]): {
  source: HarnessBlockerSource;
  reproduce: CommandArguments;
} {
  if (argv[0] === "record") {
    return {
      source: { kind: "obligation", id: "telemetry.recorded" },
      reproduce: [
        "bun",
        "run",
        "delivery:telemetry-record",
        ...argv.slice(1),
      ] as const,
    };
  }
  return {
    source: { kind: "command", id: "delivery:telemetry-check" },
    reproduce: [
      "bun",
      "run",
      "delivery:telemetry-check",
      ...argv.slice(1),
    ] as const,
  };
}

if (import.meta.main) {
  const invocation = telemetryCliContract(process.argv.slice(2));
  process.exitCode = await runHarnessCliBoundary({
    ...invocation,
    run: async () => {
      const { command, baseRef } = parseArgs(
        process.argv.slice(2),
        invocation.source,
      );
      if (command === "check") {
        assertDeliveryRunTelemetryCheck(process.cwd(), { baseRef });
        console.log("Delivery-run telemetry check passed.");
        return;
      }
      const written = await recordDeliveryRunTelemetry(process.cwd(), {
        baseRef,
      });
      console.log(
        JSON.stringify({
          kind: "delivery_run_telemetry_recorded",
          path: written.path,
          status: written.record.status,
          generatedAt: written.record.generatedAt,
        }),
      );
    },
  });
}
