/** Athena artifact policy over the installed product's single run projection. */
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildRunExport, parseRunExport, type DeliveryRunExport } from "../.agent-skills/current/runtime/cli-api.mjs";
import { computeDeliverableIdentity, createRunStore, parseDeliveryRecord, resolveRunStoreLocation, runGitDirect, gitNamespaceClearedEnvironment, type HarnessConfig } from "../.agent-skills/current/runtime/kernel.mjs";
import { importHarnessConfig, wireRepo } from "./delivery-product";
import { collectChangedPathsForDiff } from "./delivery-diff-fingerprint";
export { collectChangedPathsForDiff } from "./delivery-diff-fingerprint";
import { collectSourceLineChanges, DEFAULT_SOURCE_LINE_THRESHOLD, totalConsiderableSourceLineChanges } from "./compound-solution-check";
import { HarnessBlockedError, createHarnessBlocker, runHarnessCliBoundary, HarnessUsageError, type CommandArguments, type HarnessBlockerSource } from "./harness-blockers";
import { withoutGitRepositoryContext } from "./git-environment";

export const DELIVERY_RUN_TELEMETRY_DIR = "telemetry/delivery-runs";
export const DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD = DEFAULT_SOURCE_LINE_THRESHOLD;
export type DeliveryRunTelemetryRecord = DeliveryRunExport;

/** No second schema or counters: the product validates and recomputes its own export. */
export function parseDeliveryRunTelemetry(text: string): DeliveryRunExport | null {
  const parsed = parseRunExport(text);
  return parsed.ok ? parsed.value : null;
}

export async function readCurrentDeliveryRunExport(rootDir: string, options: { runId?: string } = {}): Promise<DeliveryRunExport | null> {
  if (process.env.DELIVERY_HARNESS_RUN_STORE?.trim()) throw new Error("Athena telemetry requires the repository product run store; unset DELIVERY_HARNESS_RUN_STORE.");
  const location = await resolveRunStoreLocation({ cwd: rootDir, run: runGitDirect, env: gitNamespaceClearedEnvironment() });
  if (!location.ok) throw new Error(`Cannot read product run store: ${location.reason}`);
  const store = createRunStore(location.commonDir);
  const current = await store.current(location.worktreeKey);
  if (!current.ok) throw new Error("Cannot read the product current-run pointer.");
  const runId = options.runId ?? current.runId;
  if (!runId) return null;
  const read = await store.read(runId);
  if (!read.ok) throw new Error(`Cannot read product run ${runId}.`);
  const projected = buildRunExport({ runId, events: read.events, rootDir, refusedAppends: await store.readNotes(runId) });
  const parsed = parseRunExport(JSON.stringify(projected));
  if (!parsed.ok) throw new Error(`Product run ${runId} cannot be exported.`);
  return parsed.value;
}

export function deliveryRunTelemetryPath(record: DeliveryRunExport, telemetryDir = DELIVERY_RUN_TELEMETRY_DIR) {
  // runId is validated by the product before any filesystem write.
  return path.join(telemetryDir, `${record.runId}.json`);
}

export async function writeDeliveryRunTelemetryRecord(rootDir: string, record: DeliveryRunExport, telemetryDir = DELIVERY_RUN_TELEMETRY_DIR) {
  const parsed = parseRunExport(JSON.stringify(record));
  if (!parsed.ok) throw new Error("Invalid product run export; regenerate it from the product journal.");
  const relativePath = deliveryRunTelemetryPath(parsed.value, telemetryDir);
  await mkdir(path.dirname(path.join(rootDir, relativePath)), { recursive: true });
  await writeFile(path.join(rootDir, relativePath), `${JSON.stringify(parsed.value, null, 2)}\n`);
  return { path: relativePath };
}

/** Historical Athena schema-v1 ledgers are left untouched and never promoted to current evidence. */
export async function readDeliveryRunTelemetryRecords(rootDir: string, telemetryDir = DELIVERY_RUN_TELEMETRY_DIR): Promise<DeliveryRunExport[]> {
  let names: string[];
  try { names = await readdir(path.join(rootDir, telemetryDir)); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return []; throw error; }
  const records: DeliveryRunExport[] = [];
  for (const name of names.filter(name => name.endsWith(".json"))) {
    try {
      const parsed = parseDeliveryRunTelemetry(await readFile(path.join(rootDir, telemetryDir, name), "utf8"));
      if (parsed) records.push(parsed);
    } catch { /* A trend read skips unreadable history; changed artifact policy below blocks it. */ }
  }
  return records.sort((a, b) => a.summary.lastAt.localeCompare(b.summary.lastAt) || a.runId.localeCompare(b.runId));
}

export async function readLatestPassingDeliveryRunTelemetry(rootDir: string, options: { telemetryDir?: string } = {}) {
  return (await readDeliveryRunTelemetryRecords(rootDir, options.telemetryDir))
    .filter(record => record.summary.gate?.writer === "cli" && record.summary.gate.outcome === "ok").at(-1) ?? null;
}

/** Observability applicability only; actual gate/evidence decisions remain product-owned. */
export async function matchesCurrentGate(rootDir: string, config: HarnessConfig, targetTree: string, record: DeliveryRunExport) {
  const gate = record.events.findLast(event => event.kind === "command.completed" && event.payload.command === "gate");
  if (!gate || gate.actor.role !== "cli" || gate.payload.outcome !== "ok" || typeof gate.payload.digest !== "string") return false;
  const preceding = record.events.slice(0, record.events.indexOf(gate));
  const versionTwoObservationKinds = new Set(["activity.observed", "wait.started", "wait.resolved", "finding.observed", "report.referenced", "artifact.referenced", "finish.step.observed"]);
  const saved = preceding.findLast(event => event.version !== "run-event/2" || !versionTwoObservationKinds.has(event.kind));
  // The wrapper saves the accepted contract immediately before invoking the actual gate.
  // Version-two observations may describe that invocation without advancing the
  // command sequence. A real intervening command or context still breaks attribution.
  if (!saved || saved.kind !== "context.saved" || saved.payload.stage !== "athena-gate" || !saved.candidateTreeSha) return false;
  const projection = { ...config, computingIdentityVersion: "validation-tree/v1", reviewNeutral: config.recordNeutral };
  // The product records the strict projection at gate completion. Its staged
  // tree may never be committed, so a fresh clone cannot look that tree up.
  const current = await computeDeliverableIdentity({ rootDir, treeSha: targetTree, config: projection });
  return gate.payload.digest === current;
}

async function currentCandidate(rootDir: string, config?: HarnessConfig) {
  const resolved = config ?? await importHarnessConfig(rootDir);
  const wiring = await wireRepo(rootDir, resolved);
  const capture = await wiring.captureCandidate();
  if (!capture.ok) throw new Error(`Product candidate capture refused: ${capture.code}`);
  return { config: resolved, treeSha: capture.candidate.treeSha };
}

export async function recordDeliveryRunTelemetry(rootDir: string, options: { runId?: string; baseRef?: string; telemetryDir?: string; config?: HarnessConfig } = {}) {
  const record = await readCurrentDeliveryRunExport(rootDir, options);
  if (!record) throw new Error("No current product run. Start the delivery run before running pr:athena.");
  const candidate = await currentCandidate(rootDir, options.config);
  if (!await matchesCurrentGate(rootDir, candidate.config, candidate.treeSha, record)) {
    throw new Error("The product run has no successful gate observation for the current validation candidate. Run pr:athena first.");
  }
  // The run remains open through the real finish line; do not invent run.ended or whole-run cost.
  return { ...await writeDeliveryRunTelemetryRecord(rootDir, record, options.telemetryDir), record };
}

export type DeliveryRunTelemetryFinding = { code: "telemetry_record_missing" | "telemetry_record_malformed"; message: string };
export type DeliveryRunTelemetryCheckInput = {
  changedPaths: string[];
  sourceLineTotal: number;
  changedRecordContents: Map<string, unknown>;
  trackedPaths: ReadonlySet<string>;
  /** Paths whose successful gate observation matches the product's strict current projection. */
  currentRecordPaths: ReadonlySet<string>;
  localGateCompleted: boolean;
  ciMode: boolean;
  threshold?: number;
};
const isTelemetryRecordPath = (repoPath: string) => repoPath.startsWith(`${DELIVERY_RUN_TELEMETRY_DIR}/`) && repoPath.endsWith(".json");

export function collectDeliveryRunTelemetryFindings(input: DeliveryRunTelemetryCheckInput): DeliveryRunTelemetryFinding[] {
  const findings: DeliveryRunTelemetryFinding[] = [];
  const validTracked = new Set<string>();
  for (const recordPath of input.changedPaths.filter(isTelemetryRecordPath)) {
    if (!input.changedRecordContents.has(recordPath)) continue; // Deleted artifact.
    const value = input.changedRecordContents.get(recordPath);
    const text = JSON.stringify(value) ?? "null";
    if (parseRunExport(text).ok) {
      if (input.trackedPaths.has(recordPath)) validTracked.add(recordPath);
    } else if (!parseDeliveryRecord(text).ok) {
      findings.push({ code: "telemetry_record_malformed", message: `Changed telemetry artifact ${recordPath} is not a valid product run export or delivery record. Regenerate it using the installed product.` });
    }
  }
  if (input.sourceLineTotal < (input.threshold ?? DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD) || (!input.ciMode && !input.localGateCompleted)) return findings;
  if (![...validTracked].some(recordPath => input.currentRecordPaths.has(recordPath))) {
    findings.push({ code: "telemetry_record_missing", message: "Substantial delivery requires a tracked product run export for the current successful gate. Run delivery:telemetry-record after the gate, then stage and commit the export." });
  }
  return findings;
}

export type DeliveryRunTelemetryCheckOptions = { baseRef?: string; ciMode?: boolean; threshold?: number; config?: HarnessConfig };
export async function evaluateDeliveryRunTelemetryCheck(rootDir: string, options: DeliveryRunTelemetryCheckOptions = {}) {
  const baseRef = options.baseRef ?? "origin/main";
  const changedPaths = collectChangedPathsForDiff(rootDir, baseRef);
  const tracked = Bun.spawnSync(["git", "ls-files", "-z", "--", DELIVERY_RUN_TELEMETRY_DIR], { cwd: rootDir, env: withoutGitRepositoryContext(), stdout: "pipe", stderr: "pipe" });
  if (tracked.exitCode !== 0) throw new Error("Cannot read Git tracking for telemetry artifacts.");
  const trackedPaths = new Set(tracked.stdout.toString().split("\0").filter(Boolean));
  const changedRecordContents = new Map<string, unknown>();
  const exports = new Map<string, DeliveryRunExport>();
  for (const recordPath of changedPaths.filter(isTelemetryRecordPath)) {
    const absolute = path.join(rootDir, recordPath);
    if (!existsSync(absolute)) continue;
    try {
      const text = readFileSync(absolute, "utf8");
      changedRecordContents.set(recordPath, JSON.parse(text));
      const parsed = parseDeliveryRunTelemetry(text);
      if (parsed) exports.set(recordPath, parsed);
    } catch { changedRecordContents.set(recordPath, null); }
  }
  const sourceLineTotal = totalConsiderableSourceLineChanges(collectSourceLineChanges(rootDir, baseRef, changedPaths));
  const currentRecordPaths = new Set<string>();
  let localGateCompleted = false;
  if (sourceLineTotal >= (options.threshold ?? DELIVERY_RUN_TELEMETRY_LINE_THRESHOLD)) {
    const candidate = await currentCandidate(rootDir, options.config);
    for (const [recordPath, record] of exports) {
      if (await matchesCurrentGate(rootDir, candidate.config, candidate.treeSha, record)) currentRecordPaths.add(recordPath);
    }
    if (!(options.ciMode ?? Boolean(process.env.CI))) {
      const current = await readCurrentDeliveryRunExport(rootDir);
      localGateCompleted = current !== null && await matchesCurrentGate(rootDir, candidate.config, candidate.treeSha, current);
    }
  }
  const findings = collectDeliveryRunTelemetryFindings({ changedPaths, sourceLineTotal, changedRecordContents, trackedPaths, currentRecordPaths, localGateCompleted, ciMode: options.ciMode ?? Boolean(process.env.CI), threshold: options.threshold });
  return { status: findings.length ? "fail" as const : "pass" as const, findings };
}

export async function assertDeliveryRunTelemetryCheck(rootDir: string, options: DeliveryRunTelemetryCheckOptions = {}) {
  const result = await evaluateDeliveryRunTelemetryCheck(rootDir, options);
  if (result.status === "pass") return;
  throw new HarnessBlockedError(result.findings.map(finding => createHarnessBlocker({ code: finding.code, source: { kind: "command", id: "delivery:telemetry-check" }, summary: finding.message, remediations: [{ id: "record-current-telemetry", kind: "manual_action", summary: "Export the current successful product run, then stage and commit its telemetry artifact." }] })), "Delivery-run telemetry check failed.");
}

export function parseArgs(argv: string[], source: HarnessBlockerSource = { kind: "command", id: "delivery:telemetry-check" }) {
  const [command, ...rest] = argv;
  const usage = { source, validFlags: ["record", "check", "--base <ref>", "--run <run-id>"] };
  if (command !== "record" && command !== "check") throw new HarnessUsageError({ ...usage, message: "Usage: delivery-run-telemetry <record|check> [--base <ref>] [--run <run-id>]" });
  let baseRef = "origin/main"; let runId: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i]; const value = rest[++i];
    if (!value || (flag !== "--base" && (flag !== "--run" || command !== "record"))) throw new HarnessUsageError({ ...usage, message: `Invalid argument: ${flag}.` });
    if (flag === "--base") baseRef = value; else runId = value;
  }
  return { command, baseRef, ...(runId ? { runId } : {}) };
}
export function telemetryCliContract(argv: string[]): { source: HarnessBlockerSource; reproduce: CommandArguments } {
  return argv[0] === "record" ? { source: { kind: "obligation", id: "telemetry.recorded" }, reproduce: ["bun", "run", "delivery:telemetry-record", ...argv.slice(1)] } : { source: { kind: "command", id: "delivery:telemetry-check" }, reproduce: ["bun", "run", "delivery:telemetry-check", ...argv.slice(1)] };
}
if (import.meta.main) {
  const args = process.argv.slice(2); const invocation = telemetryCliContract(args);
  process.exitCode = await runHarnessCliBoundary({ ...invocation, run: async () => {
    const options = parseArgs(args, invocation.source);
    if (options.command === "check") { await assertDeliveryRunTelemetryCheck(process.cwd(), options); console.log("Delivery-run telemetry check passed."); }
    else { const written = await recordDeliveryRunTelemetry(process.cwd(), options); console.log(JSON.stringify({ kind: "delivery_run_telemetry_recorded", path: written.path, runId: written.record.runId })); }
  } });
}
