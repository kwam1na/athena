// packages/cli/src/main.ts
import { realpathSync } from "node:fs";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

// packages/cli/src/commands/check.ts
import path from "node:path";
import { resolveRecordStorage, BlockedError } from "./kernel.mjs";
var PROBE_FILE = ".delivery-harness-write-probe";
var checkCommand = {
  name: "check",
  sourceId: "delivery-harness.cli.check",
  summary: "Confirm the config loads and the evidence store is usable.",
  async run(context) {
    try {
      const storage = await resolveRecordStorage(context.rootDir, { storageNamespace: context.config.storageNamespace });
      const probe = path.join(storage.storageDir, PROBE_FILE);
      await context.artifacts.writeTextFile(probe, "probe\n", { mode: 384 });
      await context.artifacts.removeFile(probe);
      return {
        kind: "ok",
        summary: [
          `ok: gate ${context.config.gateId}`,
          `  ${context.config.obligations.length} obligation(s), ${context.config.providers.length} provider(s)`,
          `  store ${storage.storageDir} (writable)`,
          `  delivery record path ${context.config.deliveryRecordPath} (base movement: ${context.config.deliveryRecordVerification.baseMovement})`
        ].join("\n")
      };
    } catch (error) {
      if (error instanceof BlockedError) {
        return { kind: "blocked", blockers: [...error.blockers] };
      }
      throw error;
    }
  }
};

// packages/cli/src/commands/emit.ts
import {
  RUN_STORE_ID,
  reduceToProviderId
} from "./kernel.mjs";

// packages/cli/src/run-surface.ts
import { lstatSync } from "node:fs";
import path2 from "node:path";
import {
  createBlocker,
  createRunStore,
  sha256Hex,
  evaluateRunJournal,
  gitNamespaceClearedEnvironment,
  neutralizeForDisplay,
  resolveRunStoreLocation,
  runGitDirect
} from "./kernel.mjs";
var RUN_SURFACE_SOURCE = "delivery-harness.cli.run-surface";
var RUN_STORE_OVERRIDE = "DELIVERY_HARNESS_RUN_STORE";
function storeRootFor(commonDir, override) {
  const named = override?.trim() ?? "";
  if (named.length === 0) return { ok: true, root: commonDir };
  if (!path2.isAbsolute(named)) {
    return { ok: false, reason: `${RUN_STORE_OVERRIDE} must name an absolute directory` };
  }
  return { ok: true, root: path2.join(named, sha256Hex(commonDir)) };
}
async function resolveRunSurface(cwd) {
  const location = await resolveRunStoreLocation({
    cwd,
    run: runGitDirect,
    env: gitNamespaceClearedEnvironment()
  });
  if (!location.ok) return { ok: false, reason: location.reason };
  const rooted = storeRootFor(location.commonDir, process.env[RUN_STORE_OVERRIDE]);
  if (!rooted.ok) return { ok: false, reason: rooted.reason };
  const store = createRunStore(rooted.root);
  return {
    ok: true,
    surface: {
      store,
      commonDir: location.commonDir,
      runsDir: store.runsDir,
      worktreeKey: location.worktreeKey
    }
  };
}
async function resolveWorktreeRoot(cwd) {
  const outcome = await runGitDirect({
    cwd,
    args: ["rev-parse", "--path-format=absolute", "--show-toplevel"],
    env: gitNamespaceClearedEnvironment()
  });
  const root = outcome.stdout.trim();
  if (outcome.code !== 0 || root.length === 0) return { ok: false, reason: `not a git worktree: ${cwd}` };
  return { ok: true, root };
}
function runInstant() {
  return `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 19)}Z`;
}
var MIRRORED = ["ticket", "candidateTreeSha"];
function buildRunEvent(input) {
  const payload = typeof input.payload === "object" && input.payload !== null ? input.payload : void 0;
  const mirrored = {};
  if (payload !== void 0) {
    for (const member of MIRRORED) {
      if (Object.prototype.hasOwnProperty.call(payload, member) && payload[member] !== void 0) {
        mirrored[member] = payload[member];
      }
    }
  }
  return {
    version: "run-event/1",
    runId: input.runId,
    at: runInstant(),
    repo: { commonDir: input.commonDir },
    kind: input.kind,
    actor: { role: input.role },
    ...mirrored,
    attestation: "self",
    payload: input.payload ?? null
  };
}
function oneLine(value, maximum = 240) {
  const collapsed = neutralizeForDisplay(value).replace(/\s+/g, " ").trim();
  return collapsed.length <= maximum ? collapsed : `${collapsed.slice(0, Math.max(maximum - 1, 0))}\u2026`;
}
function oneLineOf(value, maximum = 240) {
  if (typeof value === "string") return oneLine(value, maximum);
  if (value === void 0) return "";
  return oneLine(JSON.stringify(value) ?? String(value), maximum);
}
var RUN_JOURNAL_ROW_LABELS = "self-attested; observability, not evidence; bound to the record";
var ABSENT = { status: "absent", missing: [], attestation: "self" };
async function resolveRunJournalRow(input) {
  const resolved = await resolveRunSurface(input.cwd);
  if (!resolved.ok) return ABSENT;
  const match = await resolved.surface.store.findByCandidateTreeSha(input.treeSha);
  if (match === void 0) return ABSENT;
  const read = await resolved.surface.store.read(match.runId);
  if (!read.ok) return ABSENT;
  const evaluation = evaluateRunJournal(read.events, input.treeSha, input.mandatedLensIds);
  return {
    runId: match.runId,
    ...match.alsoMatching.length === 0 ? {} : { alsoMatching: match.alsoMatching },
    status: evaluation.status,
    missing: evaluation.missing,
    ...evaluation.violations.length === 0 ? {} : { violations: evaluation.violations },
    attestation: "self"
  };
}
function runJournalRows(row) {
  const rows = [`  run journal: ${oneLine(row.status, 64)}  (${RUN_JOURNAL_ROW_LABELS})`];
  if (row.runId !== void 0) rows.push(`    run: ${oneLine(row.runId, 128)}`);
  if (row.alsoMatching !== void 0 && row.alsoMatching.length > 0) {
    rows.push(`    also matching: ${row.alsoMatching.map((id) => oneLine(id, 128)).join(", ")}`);
  }
  rows.push(`    missing: ${row.missing.length === 0 ? "(none)" : row.missing.map((entry) => oneLine(entry, 64)).join(", ")}`);
  if (row.violations !== void 0 && row.violations.length > 0) {
    rows.push(`    violations: ${row.violations.map((entry) => oneLine(entry, 64)).join(", ")}`);
  }
  return rows;
}
function runSurfaceBlocker(input) {
  return createBlocker({
    code: input.code,
    source: { kind: "command", id: RUN_SURFACE_SOURCE },
    summary: input.summary,
    ...input.details === void 0 ? {} : { details: input.details },
    remediations: [{ id: input.remediation.id, kind: "manual_action", summary: input.remediation.summary }]
  });
}
function harnessConfigPresentAt(rootDir) {
  try {
    return lstatSync(path2.join(rootDir, "harness.config.ts")).isFile();
  } catch {
    return false;
  }
}

// packages/cli/src/commands/emit.ts
var USAGE = "Usage: delivery-harness emit <kind> [--run <id>] [--json <payload>] [--force]";
function parseArgs(args) {
  let kind;
  let run;
  let json;
  let force = false;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--force") {
      force = true;
      continue;
    }
    if (token === "--run" || token === "--json") {
      const value = args[index + 1];
      if (value === void 0) return { ok: false, message: `${token} needs a value.
${USAGE}` };
      if (token === "--run") run = value;
      else json = value;
      index += 1;
      continue;
    }
    if (token.startsWith("--")) return { ok: false, message: `Unknown flag ${oneLine(token, 64)}.
${USAGE}` };
    if (kind !== void 0) return { ok: false, message: `emit takes one kind.
${USAGE}` };
    kind = token;
  }
  if (kind === void 0) return { ok: false, message: `emit needs a kind.
${USAGE}` };
  return { ok: true, args: { kind, force, ...run === void 0 ? {} : { run }, ...json === void 0 ? {} : { json } } };
}
function parsePayload(text) {
  const trimmed = text.trim();
  if (trimmed.length === 0) return {};
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}
var noRun = (details) => runSurfaceBlocker({
  code: "run_unresolvable",
  summary: "There is no current run to emit against.",
  details,
  remediation: {
    id: "start-a-run",
    summary: "Run `delivery-harness emit run.started` in this worktree, or name an existing run with --run."
  }
});
async function resolveRun(store, surface, named) {
  if (named !== void 0) {
    if (named.length > 128 || !RUN_STORE_ID.test(named)) return void 0;
    const read = await store.read(named);
    return read.ok ? named : void 0;
  }
  const current = await store.current(surface.worktreeKey);
  return current.ok ? current.runId : void 0;
}
var emitCommand = {
  name: "emit",
  sourceId: "delivery-harness.cli.emit",
  summary: "Append one run event to the current delivery run's journal.",
  configFree: true,
  async run(context) {
    const parsed = parseArgs(context.args);
    if (!parsed.ok) return { kind: "usage", message: parsed.message };
    const { kind, run: named, force } = parsed.args;
    const resolved = await resolveRunSurface(context.rootDir);
    if (!resolved.ok) {
      return {
        kind: "blocked",
        blockers: [
          runSurfaceBlocker({
            code: "run_store_unresolvable",
            summary: "The run store could not be resolved.",
            details: oneLine(resolved.reason, 200),
            remediation: {
              id: "run-inside-a-repository",
              summary: "Run this command inside a git repository; the run store lives under its common directory."
            }
          })
        ]
      };
    }
    const surface = resolved.surface;
    const store = surface.store;
    if (kind === "run.started") {
      return startRun(surface, force, parsePayload(parsed.args.json ?? await context.readStdin()));
    }
    const runId = await resolveRun(store, surface, named);
    if (runId === void 0) {
      return {
        kind: "blocked",
        blockers: [
          noRun(
            named === void 0 ? "no current run is pointed at from this worktree, and no --run was given" : `--run ${oneLine(named, 128)} names no readable journal in this store`
          )
        ]
      };
    }
    const payload = parsePayload(parsed.args.json ?? await context.readStdin());
    const event = buildRunEvent({ runId, commonDir: surface.commonDir, kind, role: "executor", payload });
    if (kind === "command.completed") {
      await store.noteRefusal(runId, event, {
        code: "unsupported_combination",
        pointer: "/kind",
        message: "command.completed is written by the CLI; emit may not write it"
      });
      return {
        kind: "blocked",
        blockers: [
          runSurfaceBlocker({
            code: "run_event_refused",
            summary: "command.completed is written by the CLI, never by emit.",
            details: `run ${runId}: the product's own commands append their completions; an executor reports a non-product gate with gate.reported`,
            remediation: {
              id: "use-gate-reported",
              summary: "Emit gate.reported when the repository's gate is not a product command."
            }
          })
        ]
      };
    }
    const appended = await store.append(runId, event);
    if (!appended.ok) {
      const first = appended.rejections[0];
      return {
        kind: "blocked",
        blockers: [
          runSurfaceBlocker({
            code: "run_event_refused",
            // The rejected kind is echoed reduced to the bound the note records
            // it at, so the diagnostic and the durable line say the same thing
            // and neither can carry an escape sequence to the terminal.
            summary: `The run event was refused: ${reduceToProviderId(kind)}`,
            details: `run ${runId}: ${first === void 0 ? "the store refused the append" : `${first.code} at ${oneLine(first.pointer, 64) || "/"}: ${oneLine(first.message, 200)}`}`,
            remediation: {
              id: "correct-the-event",
              summary: "Correct the kind or the payload against the run-event/1 contract and emit again."
            }
          })
        ]
      };
    }
    if (kind === "run.ended") await store.clearCurrent(surface.worktreeKey, runId);
    return { kind: "ok", summary: `emitted ${appended.event.kind} seq ${appended.event.seq} to run ${runId}` };
  }
};
async function startRun(surface, force, supplied) {
  const store = surface.store;
  const existing = await store.current(surface.worktreeKey);
  const displaced = existing.ok ? existing.runId : void 0;
  if (displaced !== void 0 && !force) {
    return {
      kind: "blocked",
      blockers: [
        runSurfaceBlocker({
          code: "run_already_current",
          summary: "A run is already current for this worktree.",
          details: `run ${displaced} is current; --force displaces it and records it as displacedRunId`,
          remediation: {
            id: "end-or-force",
            summary: "End the current run with `emit run.ended`, or start this one with --force."
          }
        })
      ]
    };
  }
  const allocated = await store.allocate();
  if (!allocated.ok) {
    return {
      kind: "blocked",
      blockers: [
        runSurfaceBlocker({
          code: "run_not_allocated",
          summary: "A run journal could not be allocated.",
          details: oneLine(allocated.rejections[0]?.message ?? "the store refused to allocate", 200),
          remediation: { id: "check-the-store", summary: "Check that the repository's git common directory is writable." }
        })
      ]
    };
  }
  const runId = allocated.runId;
  const payload = typeof supplied === "object" && supplied !== null && displaced !== void 0 ? { ...supplied, displacedRunId: displaced } : supplied;
  const appended = await store.append(
    runId,
    buildRunEvent({ runId, commonDir: surface.commonDir, kind: "run.started", role: "executor", payload })
  );
  if (!appended.ok) {
    const first = appended.rejections[0];
    await store.discard(runId);
    return {
      kind: "blocked",
      blockers: [
        runSurfaceBlocker({
          code: "run_event_refused",
          summary: "The run event was refused: run.started",
          details: `run ${runId}: ${first === void 0 ? "the store refused the append" : `${first.code} at ${oneLine(first.pointer, 64) || "/"}: ${oneLine(first.message, 200)}`}`,
          remediation: {
            id: "correct-the-event",
            summary: "Correct the payload against the run-event/1 contract and emit again."
          }
        })
      ]
    };
  }
  let pointed = await store.setCurrent(surface.worktreeKey, runId, { force });
  let displacedStale = false;
  if (!pointed.ok && !force) {
    const recheck = await store.current(surface.worktreeKey);
    if (recheck.ok && recheck.runId === void 0) {
      pointed = await store.setCurrent(surface.worktreeKey, runId, { force: true });
      displacedStale = pointed.ok;
    }
  }
  if (!pointed.ok) {
    await store.discard(runId);
    return {
      kind: "blocked",
      blockers: [
        runSurfaceBlocker({
          code: "run_pointer_refused",
          summary: "The worktree pointer could not be written.",
          details: `run ${runId}: ${oneLine(pointed.rejections[0]?.message ?? "the pointer was refused", 200)}`,
          // `--run` cannot help here: `run.started` allocates rather than
          // resolves, so it never reads that flag. `--force` is the one thing
          // that displaces a pointer this command refused to overwrite.
          remediation: { id: "force-the-start", summary: "Start the run with --force to displace the pointer that is already current." }
        })
      ]
    };
  }
  return {
    kind: "ok",
    summary: `started run ${runId}${displaced === void 0 ? displacedStale ? " (displaced a stale pointer naming no readable run; the run store may need attention)" : "" : ` (displaced ${displaced})`}`
  };
}

// packages/cli/src/declared-checks.ts
import { randomUUID } from "node:crypto";
import path3 from "node:path";
import { captureCheckBindings, captureCheckOutputSnapshots, digestCanonical, classifyCandidateDrift, computeCheckWiringFingerprint, createBlocker as createBlocker2, createExecPort, sha256Hex as sha256Hex2, submitManifest } from "./kernel.mjs";
async function runDeclaredCheck(context, provider, obligationIds, before) {
  const check = provider.check;
  const wiring = await context.wire();
  const fail = (code, summary, details) => [createBlocker2({
    code,
    source: { kind: "command", id: "delivery-harness.cli.gate" },
    summary,
    ...details === void 0 ? {} : { details },
    remediations: [{ id: "repair-declared-check", kind: "manual_action", summary: "Fix the declared check or its inputs, prepare the stable candidate and run gate again." }]
  })];
  const start = await wiring.captureCandidate();
  if (!start.ok) return start.blockers;
  if (classifyCandidateDrift(before, start.candidate).length) return fail("check_candidate_changed", "The candidate changed after review admission and before the check started.");
  const fingerprint = await computeCheckWiringFingerprint(context.rootDir, context.config, wiring.storageOptions);
  context.write(`checking ${provider.id}`);
  const result = await createExecPort().run({
    command: check.command[0],
    args: check.command.slice(1),
    cwd: context.rootDir,
    env: Object.fromEntries(Object.entries(context.env).filter((entry) => entry[1] !== void 0)),
    timeoutMs: check.timeoutMs,
    maxBuffer: 1024 * 1024,
    ...context.signal === void 0 ? {} : { signal: context.signal }
  });
  if (result.code !== 0 || context.signal?.aborted) return fail("check_command_failed", `Declared check ${provider.id} did not complete successfully.`, `exit ${result.code}${result.errorCode === void 0 ? "" : ` (${result.errorCode})`}
${`${result.stdout}
${result.stderr}`.slice(-4e3)}`);
  const captured = await wiring.captureCandidate();
  if (!captured.ok) return captured.blockers;
  if (classifyCandidateDrift(before, captured.candidate).length || start.candidate.headSha !== captured.candidate.headSha || fingerprint !== await computeCheckWiringFingerprint(context.rootDir, context.config, wiring.storageOptions)) return fail("check_candidate_changed", "The candidate, base or wiring changed while the check ran.");
  const binding = (await captureCheckBindings(context.rootDir, context.config, captured.candidate, wiring.storageOptions))[provider.id];
  if (binding === void 0) return fail("check_output_missing", `Declared check ${provider.id} has a missing, unreadable, oversized or escaped output.`);
  const runId = randomUUID(), finalPassId = "pass-1";
  const allocation = await context.artifacts.allocateRunRoot({ providerId: provider.id, runId });
  if (!allocation.ok) return fail("check_artifact_unavailable", "Cannot allocate the declared check evidence root.");
  const snapshots = await captureCheckOutputSnapshots(context.rootDir, check.outputs ?? []);
  if (snapshots === void 0 || digestCanonical(snapshots.map(({ path: path13, sha256 }) => ({ path: path13, sha256 }))) !== binding.outputsDigest) return fail("check_output_missing", "Declared outputs changed before evidence retention.");
  const outputArtifacts = [];
  for (const [index, output] of snapshots.entries()) {
    const contents = JSON.stringify({ path: output.path, base64: output.base64 });
    const artifactPath = `check-output-${index}.json`;
    await context.artifacts.writeTextFile(path3.join(allocation.runRoot.path, artifactPath), contents);
    outputArtifacts.push({ path: artifactPath, sha256: sha256Hex2(contents), role: "check-output" });
  }
  const payload = { verdict: "green", exitCode: 0, binding };
  const terminal = JSON.stringify({ providerId: provider.id, runId, finalPassId, ...payload });
  await context.artifacts.writeTextFile(path3.join(allocation.runRoot.path, "check-result.json"), terminal);
  const candidate = captured.candidate;
  const manifest = {
    spec: "delivery-evidence/1",
    provider: { id: provider.id, runId, finalPassId },
    candidate: { vcs: "git", treeSha: candidate.treeSha, headSha: candidate.headSha, deliverable: candidate.deliverable, base: candidate.base, workspaceId: candidate.workspaceId },
    runHistory: [{ preparedTreeSha: candidate.treeSha, evaluatedInPassId: finalPassId }],
    artifacts: [{ path: "check-result.json", sha256: sha256Hex2(terminal), role: "check-result" }, ...outputArtifacts],
    attestation: { level: "self", signatures: [] },
    recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
    claims: obligationIds.map((obligation) => ({ obligation, payloadSpec: "checks.passed/1", payload }))
  };
  const manifestPath = path3.join(allocation.runRoot.path, "manifest.json");
  await context.artifacts.writeTextFile(manifestPath, JSON.stringify(manifest));
  const outcome = await submitManifest({ rootDir: context.rootDir, config: context.config, manifestPath }, { captureCandidate: wiring.captureCandidate, artifacts: context.artifacts, ...wiring.storageOptions });
  return outcome.status === "accepted" ? [] : outcome.blockers;
}

// packages/cli/src/commands/gate.ts
import { computeDeliverableIdentity, runAdmission } from "./kernel.mjs";

// packages/cli/src/boundary.ts
import path4 from "node:path";
import { randomUUID as randomUUID2 } from "node:crypto";
import { pathToFileURL } from "node:url";
import {
  BlockedError as BlockedError2,
  classifyExecutionContext,
  createArtifactsPort,
  createBlocker as createBlocker3,
  createCandidateCapture,
  createInternalErrorBlocker,
  evaluateCandidateActivation,
  renderBlockers,
  resolveRecordStorage as resolveRecordStorage2,
  submitManifest as submitManifest2,
  validateHarnessConfig,
  withDeliverableIdentity
} from "./kernel.mjs";

// packages/cli/src/provider-rails.ts
import {
  DELIVERY_PROVIDER_RAILS_VERSION,
  consumeProviderRailMessages,
  openProviderRailProcess,
  invokeProviderRail
} from "./kernel.mjs";

// packages/cli/src/boundary.ts
var EXIT_OK = 0;
var EXIT_POLICY = 1;
var EXIT_USAGE = 2;
var EXIT_INTERRUPTED = 130;
var CliInterruption = class extends Error {
  constructor(message = "Interrupted.") {
    super(message);
    this.name = "CliInterruption";
  }
};
function isConfigFreeCommand(descriptor) {
  return descriptor.configFree === true;
}
function commandBlocker(input) {
  return createBlocker3({
    code: input.code,
    source: { kind: "command", id: input.sourceId },
    summary: input.summary,
    ...input.details === void 0 ? {} : { details: input.details },
    remediations: input.remediations
  });
}
async function importHarnessConfig(rootDir) {
  const configPath = path4.join(rootDir, "harness.config.ts");
  let loaded;
  try {
    const module = await import(pathToFileURL(configPath).href);
    loaded = module.default;
  } catch (error) {
    throw new BlockedError2([
      commandBlocker({
        code: "config_unloadable",
        sourceId: "delivery-harness.cli.config",
        summary: "The harness configuration could not be loaded.",
        details: `${configPath}: ${error instanceof Error ? error.message : String(error)}`,
        remediations: [
          {
            id: "create-harness-config",
            kind: "manual_action",
            summary: "Provide a valid harness.config.ts at the repository root."
          }
        ]
      })
    ]);
  }
  const validation = validateHarnessConfig(loaded);
  if (!validation.ok) {
    throw new BlockedError2(validation.blockers);
  }
  return validation.config;
}
async function wireRepo(rootDir, config) {
  const storageOptions = { storageNamespace: config.storageNamespace };
  const storage = await resolveRecordStorage2(rootDir, storageOptions);
  const captureCandidate = createCandidateCapture({
    rootDir,
    config,
    workspaceId: storage.workspaceId,
    computeIdentity: withDeliverableIdentity()
  });
  const projectActivation = (candidate) => evaluateCandidateActivation({ rootDir, candidate, config });
  return { rootDir, workspaceId: storage.workspaceId, captureCandidate, projectActivation, storageOptions };
}
var USAGE2 = (commands) => [
  "Usage: delivery-harness <command> [options]",
  "",
  "Commands:",
  ...commands.map((command) => `  ${command.name.padEnd(16)}${command.summary}`)
].join("\n");
var COMPLETION_WRAPPED_COMMANDS = [
  "check",
  "prepare",
  "review-context",
  "emit-review-evidence",
  "submit-evidence",
  "gate",
  "record",
  "verify"
];
function outcomeOfExit(code) {
  if (code === EXIT_OK) return "ok";
  if (code === EXIT_USAGE) return "usage";
  if (code === EXIT_INTERRUPTED) return "interrupted";
  return "policy";
}
async function recordCommandCompletion(input) {
  try {
    const resolved = await resolveRunSurface(input.cwd);
    if (!resolved.ok) return;
    const { store, commonDir, worktreeKey } = resolved.surface;
    const current = await store.current(worktreeKey);
    if (!current.ok || current.runId === void 0) return;
    await store.append(
      current.runId,
      buildRunEvent({
        runId: current.runId,
        commonDir,
        kind: "command.completed",
        role: "cli",
        payload: {
          command: input.command,
          outcome: outcomeOfExit(input.exitCode),
          durationMs: input.durationMs,
          ...input.exitCode === EXIT_OK && input.digest !== void 0 ? { digest: input.digest } : {}
        }
      })
    );
  } catch {
  }
}
async function runCliBoundary(argv, commands, runtime) {
  const [commandName, ...args] = argv;
  if (commandName === void 0 || commandName === "--help" || commandName === "-h" || commandName === "help") {
    runtime.stdout(`${USAGE2(commands)}
`);
    return commandName === void 0 ? EXIT_USAGE : EXIT_OK;
  }
  const descriptor = commands.find((command) => command.name === commandName);
  if (descriptor === void 0) {
    runtime.stderr(`Unknown command: ${commandName}

${USAGE2(commands)}
`);
    return EXIT_USAGE;
  }
  if (isConfigFreeCommand(descriptor)) {
    return runConfigFreeCommand(descriptor, args, runtime);
  }
  const prepareHelp = descriptor.name === "prepare" && args.length === 1 && ["--help", "-h"].includes(args[0]);
  const startedAt = Date.now();
  let digest;
  const code = await runConfiguredCommand(descriptor, args, runtime, (value) => {
    digest = value;
  });
  if (!prepareHelp && COMPLETION_WRAPPED_COMMANDS.includes(descriptor.name)) {
    await recordCommandCompletion({
      cwd: runtime.cwd,
      command: descriptor.name,
      exitCode: code,
      durationMs: Date.now() - startedAt,
      ...digest === void 0 ? {} : { digest }
    });
  }
  return code;
}
async function runConfigFreeCommand(descriptor, args, runtime) {
  try {
    const result = await descriptor.run({
      rootDir: runtime.cwd,
      env: runtime.env,
      args,
      readStdin: runtime.readStdin ?? (async () => ""),
      write: (text) => runtime.stdout(`${text}
`),
      ...runtime.signal === void 0 ? {} : { signal: runtime.signal }
    });
    if (result.kind === "ok") {
      if (result.summary !== void 0 && result.summary !== "") runtime.stdout(`${result.summary}
`);
      return EXIT_OK;
    }
    if (result.kind === "usage") {
      runtime.stderr(`${result.message}
`);
      return EXIT_USAGE;
    }
    runtime.stderr(`${renderBlockers(result.blockers)}
`);
    return EXIT_POLICY;
  } catch (error) {
    if (error instanceof CliInterruption) {
      runtime.stderr(`${error.message}
`);
      return EXIT_INTERRUPTED;
    }
    if (error instanceof BlockedError2) {
      runtime.stderr(`${renderBlockers(error.blockers)}
`);
      return EXIT_POLICY;
    }
    const blocker = createInternalErrorBlocker({
      source: { kind: "command", id: descriptor.sourceId },
      error,
      reproduce: ["delivery-harness", descriptor.name]
    });
    runtime.stderr(`${renderBlockers([blocker])}
`);
    return EXIT_POLICY;
  }
}
async function runConfiguredCommand(descriptor, args, runtime, observeDigest) {
  const loadConfig = runtime.loadConfig ?? importHarnessConfig;
  const artifacts = runtime.artifacts ?? createArtifactsPort();
  try {
    const config = await loadConfig(runtime.cwd);
    let wiringPromise;
    const wire = () => {
      wiringPromise ??= wireRepo(runtime.cwd, config);
      return wiringPromise;
    };
    const context = {
      rootDir: runtime.cwd,
      config,
      ...runtime.policyBinding === void 0 ? {} : { policyBinding: runtime.policyBinding },
      env: runtime.env,
      stdinIsTTY: runtime.stdinIsTTY,
      stdoutIsTTY: runtime.stdoutIsTTY,
      args,
      wire,
      readStdin: runtime.readStdin ?? (async () => ""),
      artifacts,
      ...runtime.signal === void 0 ? {} : { signal: runtime.signal },
      // The waiver prompt is offered only under a real TTY. A non-interactive
      // invocation never prompts — it blocks — no matter what the run wired.
      ...runtime.stdinIsTTY && runtime.stdoutIsTTY && runtime.promptForWaiver !== void 0 ? { promptForWaiver: runtime.promptForWaiver } : {},
      ...runtime.liveResults === void 0 ? {} : { liveResults: runtime.liveResults },
      invokeProvider: async ({ providerId, payload, requiresEvidence }) => {
        const provider = config.providers.find((registration) => registration.id === providerId);
        if (provider?.command === void 0) return void 0;
        const command = provider.command;
        const requestId = randomUUID2();
        const allocation = await artifacts.allocateRunRoot({ providerId, runId: requestId });
        if (!allocation.ok) {
          throw new BlockedError2([
            commandBlocker({
              code: "provider_rail_run_root_refused",
              sourceId: "delivery-harness.cli.provider-rails",
              summary: "The provider run root could not be allocated.",
              details: `${providerId}/${requestId}: ${allocation.reason}`,
              remediations: [
                {
                  id: "check-provider-identity",
                  kind: "code_change",
                  summary: "Correct the provider id or restore the harness run-root location, then retry."
                }
              ]
            })
          ]);
        }
        const wiring = await wire();
        const interruptController = runtime.signal === void 0 ? new AbortController() : void 0;
        const onInterrupt = () => interruptController?.abort();
        if (interruptController !== void 0) process.once("SIGINT", onInterrupt);
        try {
          return await invokeProviderRail(
            {
              providerId,
              requestId,
              idempotencyKey: randomUUID2(),
              payload: { ...payload, runId: requestId, runRoot: allocation.runRoot.path },
              requiresEvidence
            },
            {
              open: () => runtime.openProviderRail === void 0 ? openProviderRailProcess({ command, cwd: runtime.cwd, env: { ...runtime.env } }) : runtime.openProviderRail({ providerId, command, cwd: runtime.cwd, env: runtime.env }),
              publishManifest: (manifestPath) => submitManifest2(
                { rootDir: runtime.cwd, config, manifestPath },
                {
                  captureCandidate: wiring.captureCandidate,
                  artifacts,
                  expectedProviderAttempt: { providerId, runId: requestId, runRootPath: allocation.runRoot.path },
                  ...wiring.storageOptions
                }
              ),
              signal: runtime.signal ?? interruptController?.signal,
              cancellationId: randomUUID2()
            }
          );
        } finally {
          if (interruptController !== void 0) process.off("SIGINT", onInterrupt);
        }
      },
      write: (text) => runtime.stdout(`${text}
`),
      classifyContext: () => classifyExecutionContext({
        config,
        env: runtime.env,
        stdinIsTTY: runtime.stdinIsTTY,
        stdoutIsTTY: runtime.stdoutIsTTY
      })
    };
    const result = await descriptor.run(context);
    if (runtime.signal?.aborted) throw new CliInterruption();
    if (result.kind === "ok") {
      observeDigest(result.digest);
      if (result.summary !== void 0 && result.summary !== "") runtime.stdout(`${result.summary}
`);
      return EXIT_OK;
    }
    if (result.kind === "usage") {
      runtime.stderr(`${result.message}
`);
      return EXIT_USAGE;
    }
    runtime.stderr(`${renderBlockers(result.blockers)}
`);
    return EXIT_POLICY;
  } catch (error) {
    if (error instanceof CliInterruption) {
      runtime.stderr(`${error.message}
`);
      return EXIT_INTERRUPTED;
    }
    if (error instanceof BlockedError2) {
      runtime.stderr(`${renderBlockers(error.blockers)}
`);
      return EXIT_POLICY;
    }
    const blocker = createInternalErrorBlocker({
      source: { kind: "command", id: descriptor.sourceId },
      error,
      reproduce: ["delivery-harness", descriptor.name]
    });
    runtime.stderr(`${renderBlockers([blocker])}
`);
    return EXIT_POLICY;
  }
}

// packages/cli/src/commands/gate.ts
async function runProviderBackedAdmission(context, options) {
  const wiring = await context.wire();
  const admissionOptions = {
    captureCandidate: wiring.captureCandidate,
    projectActivation: wiring.projectActivation,
    ...wiring.storageOptions
  };
  const input = {
    rootDir: context.rootDir,
    config: context.config,
    context: context.classifyContext(),
    ...options.includeInjectedLiveResults && context.liveResults !== void 0 ? { liveResults: context.liveResults } : {}
  };
  const finalAdmissionOptions = {
    ...admissionOptions,
    ...options.allowPrompt && context.promptForWaiver !== void 0 ? { promptForWaiver: context.promptForWaiver } : {}
  };
  if (!context.config.providers.some((provider) => provider.command !== void 0 || provider.check !== void 0)) {
    return runAdmission(input, finalAdmissionOptions);
  }
  const liveResults = options.includeInjectedLiveResults ? [...context.liveResults ?? []] : [];
  const attempted = /* @__PURE__ */ new Set();
  const attemptBlockers = [];
  let admission = await runAdmission(input, admissionOptions);
  while (!admission.admitted && admission.decision !== void 0 && admission.candidate !== void 0) {
    const requested = /* @__PURE__ */ new Map();
    for (const resolution of admission.decision.resolutions) {
      if (resolution.kind !== "blocked") continue;
      const obligation = context.config.obligations.find((entry) => entry.id === resolution.obligationId);
      if (obligation === void 0) continue;
      const missingCode = obligation.freshness === "live" ? "live_provider_missing" : "review_evidence_missing";
      for (const finding of resolution.providerFindings ?? []) {
        if (finding.code !== missingCode || finding.providerId === void 0 || attempted.has(finding.providerId)) continue;
        const registration2 = context.config.providers.find((provider) => provider.id === finding.providerId);
        if (registration2 === void 0 || registration2.command === void 0 && registration2.check === void 0 || !obligation.providers.includes(registration2.id)) continue;
        if (registration2.check !== void 0 && (obligation.freshness !== "exact_candidate" || !obligation.acceptedPayloadSpecs.includes("checks.passed/1") || admission.decision.resolutions.some((resolution2) => resolution2.kind !== "satisfied_evidence" && resolution2.kind !== "not_applicable" && resolution2.kind !== "waived" && context.config.obligations.find((entry2) => entry2.id === resolution2.obligationId)?.acceptedPayloadSpecs.includes("review.green/1")))) continue;
        const entry = requested.get(registration2.id) ?? { obligationIds: [], requiresEvidence: false, needsLiveResult: false };
        entry.obligationIds.push(obligation.id);
        entry.requiresEvidence ||= obligation.freshness === "exact_candidate";
        entry.needsLiveResult ||= obligation.freshness === "live";
        requested.set(registration2.id, entry);
      }
    }
    const next = requested.entries().next().value;
    if (next === void 0) break;
    const [providerId, request] = next;
    attempted.add(providerId);
    const registration = context.config.providers.find((provider) => provider.id === providerId);
    if (registration.check !== void 0) {
      attemptBlockers.push(...await runDeclaredCheck(context, registration, request.obligationIds, admission.candidate));
      admission = await runAdmission({ ...input, ...liveResults.length === 0 ? {} : { liveResults } }, admissionOptions);
      continue;
    }
    const result = await context.invokeProvider?.({
      providerId,
      requiresEvidence: request.requiresEvidence,
      payload: {
        gateId: context.config.gateId,
        providerId,
        obligationIds: [...new Set(request.obligationIds)].sort(),
        candidate: admission.candidate
      }
    });
    if (result === void 0) continue;
    if (result.kind === "interrupted") throw new CliInterruption("Provider invocation interrupted before a trustworthy terminal outcome.");
    if (result.kind === "blocked") {
      attemptBlockers.push(...result.blockers);
      if (request.needsLiveResult) {
        liveResults.push({ providerId, runId: result.runId, status: "failed", findings: [] });
      }
    } else if (request.needsLiveResult) {
      liveResults.push(result.liveResult);
    }
    admission = await runAdmission(
      { ...input, ...liveResults.length === 0 ? {} : { liveResults } },
      admissionOptions
    );
  }
  if (admission.admitted) return { ...admission, observedLiveResults: liveResults };
  const final = await runAdmission(
    { ...input, ...liveResults.length === 0 ? {} : { liveResults } },
    finalAdmissionOptions
  );
  return attemptBlockers.length === 0 || final.admitted ? { ...final, observedLiveResults: liveResults } : { ...final, observedLiveResults: liveResults, blockers: [...attemptBlockers, ...final.blockers] };
}
var gateCommand = {
  name: "gate",
  sourceId: "delivery-harness.cli.gate",
  summary: "Evaluate the delivery gate for the current candidate.",
  async run(context) {
    const result = await runProviderBackedAdmission(context, { allowPrompt: true, includeInjectedLiveResults: true });
    if (result.admitted) {
      const waiverNote = result.waiver === "accepted" ? ` (waived: ${result.waivedObligationIds.join(", ")})` : "";
      const kinds = (result.decision?.resolutions ?? []).map((resolution) => `${resolution.obligationId}=${resolution.kind}`);
      let digest;
      if (result.candidate !== void 0) {
        try {
          digest = await computeDeliverableIdentity({
            rootDir: context.rootDir,
            treeSha: result.candidate.treeSha,
            config: { ...context.config, computingIdentityVersion: "validation-tree/v1", reviewNeutral: context.config.recordNeutral }
          });
        } catch {
        }
      }
      return { kind: "ok", summary: `admitted${waiverNote}: ${kinds.join(", ")}`, ...digest === void 0 ? {} : { digest } };
    }
    return { kind: "blocked", blockers: [...result.blockers] };
  }
};

// packages/cli/src/commands/maintain.ts
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path5 from "node:path";
import { compiledAdopterPolicyBindingDigest, createManagedDeliveryFacade } from "./kernel.mjs";
var SOURCE_ID = "delivery-harness.cli.maintain";
var MAINTAIN_OPERATIONS = Object.freeze([
  "update",
  "rollback",
  "pin",
  "revoke",
  "unrevoke",
  "advance-high-water-mark"
]);
var blocked = (code, summary, remediation) => ({
  kind: "blocked",
  blockers: [
    commandBlocker({
      code,
      sourceId: SOURCE_ID,
      summary,
      remediations: [{ id: `${code.replaceAll("_", "-")}-remediation`, kind: "manual_action", summary: remediation }]
    })
  ]
});
var gitCommonDir = (cwd) => new Promise((resolve) => {
  execFile("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" }, (error, stdout) => {
    resolve(error === null ? stdout.trim() : void 0);
  });
});
var flag = (args, name) => {
  const index = args.indexOf(name);
  return index === -1 ? void 0 : args[index + 1];
};
function nowInstant() {
  return `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 19)}Z`;
}
async function resolveFacade(context) {
  const common = await gitCommonDir(context.rootDir);
  if (common === void 0) {
    return blocked("not_a_repository", "The working directory is not a git repository.", "Run from the repository the product is installed for.");
  }
  let pointer;
  try {
    pointer = JSON.parse(await readFile(path5.join(common, "managed-delivery", "facade.json"), "utf8"));
  } catch {
    return blocked(
      "no_managed_installation",
      "No managed installation is registered for this repository.",
      "Install the composition and register a delivery first."
    );
  }
  let policyBinding = context.policyBinding;
  if (policyBinding === void 0) {
    try {
      policyBinding = JSON.parse(await readFile(path5.join(common, "managed-delivery", "policy-binding.json"), "utf8"));
    } catch {
      return blocked(
        "policy_binding_missing",
        "No compiled adopter policy binding is retained for this installation.",
        "Register a delivery through an adopter binding, or pass one through the embedding runtime."
      );
    }
  }
  if (pointer.policyBindingDigest !== compiledAdopterPolicyBindingDigest(policyBinding)) {
    return blocked(
      "policy_binding_mismatch",
      "The retained compiled adopter policy binding does not match the product namespace pointer.",
      "Restore the exact binding captured at registration; drift requires a new owner-approved delivery."
    );
  }
  return createManagedDeliveryFacade({
    repoDir: context.rootDir,
    policyBinding,
    installation: { installationPath: pointer.installationPath, receiptDir: pointer.receiptDir },
    hostVersion: pointer.hostVersion
  });
}
var isCommandResult = (value) => "kind" in value;
var maintainCommand = {
  name: "maintain",
  sourceId: SOURCE_ID,
  summary: "Maintain the product installation (update, rollback, trust-state pin/revoke/unrevoke/high-water-mark).",
  async run(context) {
    const [operation, ...rest] = context.args;
    if (operation === void 0) {
      return { kind: "usage", message: `maintain requires an operation: ${MAINTAIN_OPERATIONS.join(" | ")}` };
    }
    if (!MAINTAIN_OPERATIONS.includes(operation)) {
      return { kind: "usage", message: `Unknown maintain operation: ${operation}.` };
    }
    const resolved = await resolveFacade(context);
    if (isCommandResult(resolved)) return resolved;
    const facade = resolved;
    const now = nowInstant();
    const emit = (value) => context.write(`${JSON.stringify(value, null, 2)}
`);
    switch (operation) {
      case "update": {
        const packedDir = flag(rest, "--packed");
        if (packedDir === void 0) {
          return { kind: "usage", message: "update requires --packed <dir> naming the verified packed generation to install." };
        }
        const outcome = await facade.updateComposition({ packedDir: path5.resolve(context.rootDir, packedDir), now });
        if (!outcome.ok) return { kind: "blocked", blockers: [...outcome.blockers] };
        emit(outcome);
        return {
          kind: "ok",
          summary: outcome.noOp ? `already at ${outcome.generationDigest}` : `updated ${outcome.priorGenerationDigest} -> ${outcome.generationDigest}`
        };
      }
      case "rollback": {
        const target = flag(rest, "--generation");
        if (target === void 0) {
          return { kind: "usage", message: "rollback requires --generation <digest> naming a previously accepted generation." };
        }
        const outcome = await facade.rollbackComposition({ targetGenerationDigest: target, now });
        if (!outcome.ok) return { kind: "blocked", blockers: [...outcome.blockers] };
        return { kind: "ok", summary: `rolled back to ${outcome.generationDigest}` };
      }
      case "pin":
      case "revoke":
      case "unrevoke": {
        const generationDigest = flag(rest, "--generation");
        if (generationDigest === void 0) {
          return { kind: "usage", message: `${operation} requires --generation <digest>.` };
        }
        const outcome = await facade.maintainTrustState({ operation, generationDigest, now });
        if (!outcome.ok) return { kind: "blocked", blockers: [...outcome.blockers] };
        emit(outcome.state);
        return { kind: "ok", summary: `${operation} recorded at revocation epoch ${outcome.state.revocationEpoch}` };
      }
      case "advance-high-water-mark": {
        const raw = flag(rest, "--to");
        const highWaterMark = raw === void 0 ? Number.NaN : Number.parseInt(raw, 10);
        if (!Number.isInteger(highWaterMark)) {
          return { kind: "usage", message: "advance-high-water-mark requires --to <integer>." };
        }
        const outcome = await facade.maintainTrustState({ operation: "advance-high-water-mark", highWaterMark, now });
        if (!outcome.ok) return { kind: "blocked", blockers: [...outcome.blockers] };
        emit(outcome.state);
        return { kind: "ok", summary: `high-water mark is ${outcome.state.highWaterMark}` };
      }
      default:
        return { kind: "usage", message: `Unknown maintain operation: ${operation}.` };
    }
  }
};

// packages/cli/src/commands/managed.ts
import { execFile as execFile2 } from "node:child_process";
import { readFile as readFile2, readdir, realpath } from "node:fs/promises";
import path6 from "node:path";
import {
  FACADE_OPERATIONS,
  compiledAdopterPolicyBindingDigest as compiledAdopterPolicyBindingDigest2,
  createManagedDeliveryFacade as createManagedDeliveryFacade2
} from "./kernel.mjs";
var SOURCE_ID2 = "delivery-harness.cli.managed";
var MANAGED_OPERATIONS = Object.freeze([
  "status",
  "next",
  "operations",
  "blockers",
  "explain-blocker",
  "submit-plan",
  "checkpoint",
  "run-sensor",
  "reduce-review",
  "compound",
  "admit",
  "prepare-record",
  "confirm-record",
  "finish",
  "propose-approval",
  "request-cancellation",
  "finalize-cancellation",
  "recover",
  "export",
  "delete"
]);
var blocked2 = (code, summary, remediation) => ({
  kind: "blocked",
  blockers: [
    commandBlocker({
      code,
      sourceId: SOURCE_ID2,
      summary,
      remediations: [{ id: `${code.replaceAll("_", "-")}-remediation`, kind: "manual_action", summary: remediation }]
    })
  ]
});
var gitCommonDir2 = (cwd) => new Promise((resolve) => {
  execFile2("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd, encoding: "utf8" }, (error, stdout) => {
    resolve(error === null ? stdout.trim() : void 0);
  });
});
function nowInstant2() {
  return `${(/* @__PURE__ */ new Date()).toISOString().slice(0, 19)}Z`;
}
var flag2 = (args, name) => {
  const index = args.indexOf(name);
  return index === -1 ? void 0 : args[index + 1];
};
async function resolveManaged(context, requested) {
  const common = await gitCommonDir2(context.rootDir);
  if (common === void 0) {
    return blocked2("not_a_repository", "The working directory is not a git repository.", "Run from the delivery worktree.");
  }
  const namespace = path6.join(common, "managed-delivery");
  let pointer;
  try {
    pointer = JSON.parse(await readFile2(path6.join(namespace, "facade.json"), "utf8"));
  } catch {
    return blocked2(
      "no_managed_delivery",
      "No managed delivery is registered for this repository.",
      "Register a delivery through the facade's contract handoff first."
    );
  }
  let deliveries;
  try {
    deliveries = (await readdir(path6.join(namespace, "deliveries"))).sort();
  } catch {
    deliveries = [];
  }
  const active = [];
  for (const candidate of deliveries) {
    try {
      const journal = await readFile2(path6.join(namespace, "deliveries", candidate, "journal.jsonl"), "utf8");
      const terminal = journal.split("\n").filter((line) => line.length > 0).some((line) => {
        try {
          const entry = JSON.parse(line);
          return entry.kind === "transition.committed" && ["completed", "cancelled", "failed"].includes(entry.payload?.to ?? "");
        } catch {
          return false;
        }
      });
      if (!terminal) active.push(candidate);
    } catch {
      active.push(candidate);
    }
  }
  let deliveryId;
  if (requested !== void 0) {
    if (!deliveries.includes(requested)) {
      return blocked2(
        "delivery_unresolved",
        `No delivery ${requested} is registered for this repository.`,
        "Name a delivery this repository registered; `managed status` reports the current one."
      );
    }
    deliveryId = requested;
  } else {
    deliveryId = active[0] ?? deliveries[deliveries.length - 1];
    if (deliveryId === void 0 || active.length > 1) {
      return blocked2(
        "delivery_unresolved",
        active.length > 1 ? "Several deliveries are in flight; the skeleton drives one." : "No registered delivery exists.",
        "Register exactly one delivery for this repository, or name one with --delivery for export and delete."
      );
    }
  }
  let policyBinding = context.policyBinding;
  if (policyBinding === void 0) {
    try {
      policyBinding = JSON.parse(await readFile2(path6.join(namespace, "policy-binding.json"), "utf8"));
    } catch {
      return blocked2(
        "policy_binding_missing",
        "No compiled adopter policy binding is retained for this delivery.",
        "Register the delivery through an adopter binding, or pass one through the embedding runtime."
      );
    }
  }
  if (pointer.policyBindingDigest !== compiledAdopterPolicyBindingDigest2(policyBinding)) {
    return blocked2(
      "policy_binding_mismatch",
      "The retained compiled adopter policy binding does not match the product namespace pointer.",
      "Restore the exact binding captured at registration; drift requires a new owner-approved delivery."
    );
  }
  const facade = createManagedDeliveryFacade2({
    repoDir: context.rootDir,
    policyBinding,
    installation: { installationPath: pointer.installationPath, receiptDir: pointer.receiptDir },
    hostVersion: pointer.hostVersion
  });
  let fence;
  try {
    const workspace = JSON.parse(
      await readFile2(path6.join(namespace, "deliveries", deliveryId, "workspace.json"), "utf8")
    );
    if (typeof workspace.worktreeDir === "string" && typeof workspace.fence === "number") {
      const [boundReal, hereReal] = await Promise.all([realpath(workspace.worktreeDir), realpath(context.rootDir)]);
      if (boundReal === hereReal) fence = workspace.fence;
    }
  } catch {
    fence = void 0;
  }
  return { facade, deliveryId, fence };
}
var isCommandResult2 = (value) => "kind" in value;
var managedCommand = {
  name: "managed",
  sourceId: SOURCE_ID2,
  summary: "Drive the managed delivery's next checkpoint (status, stages, sensor, review, admission, record, finish).",
  async run(context) {
    const [operation, ...rest] = context.args;
    if (operation === void 0) {
      return {
        kind: "usage",
        message: `managed requires an operation: ${MANAGED_OPERATIONS.join(" | ")}`
      };
    }
    if (!MANAGED_OPERATIONS.includes(operation)) {
      return { kind: "usage", message: `Unknown managed operation: ${operation}.` };
    }
    if (operation === "operations") {
      context.write(`${JSON.stringify(FACADE_OPERATIONS, null, 2)}
`);
      return { kind: "ok", summary: `${FACADE_OPERATIONS.length} facade operations` };
    }
    const RETENTION_OPERATIONS = ["export", "delete"];
    if (rest.some((argument) => argument.startsWith("--delivery="))) {
      return { kind: "usage", message: "--delivery takes its value as a separate argument: --delivery <id>." };
    }
    const namesDelivery = rest.includes("--delivery");
    if (namesDelivery && !RETENTION_OPERATIONS.includes(operation)) {
      return { kind: "usage", message: `--delivery is accepted only by: ${RETENTION_OPERATIONS.join(", ")}.` };
    }
    const requestedDelivery = RETENTION_OPERATIONS.includes(operation) ? flag2(rest, "--delivery") : void 0;
    if (namesDelivery && requestedDelivery === void 0) {
      return { kind: "usage", message: "--delivery requires a delivery id." };
    }
    const resolved = await resolveManaged(context, requestedDelivery);
    if (isCommandResult2(resolved)) return resolved;
    const { facade, deliveryId, fence } = resolved;
    const requireFence = () => fence ?? blocked2(
      "workspace_superseded",
      "This worktree is not the delivery's currently bound workspace, so it carries no invocation fence.",
      "Drive checkpoints from the bound worktree; a superseded task's outputs are permanently rejected."
    );
    const emit = (value) => context.write(`${JSON.stringify(value, null, 2)}
`);
    const resultFileArg = async (operation2) => {
      const file = flag2(rest, "--result-file");
      if (file === void 0) {
        return {
          kind: "usage",
          message: `${operation2} requires --result-file <path> containing a typed workflow-stage-result/1 document; prose cannot advance a checkpoint.`
        };
      }
      try {
        return await readFile2(path6.resolve(context.rootDir, file), "utf8");
      } catch (error) {
        return { kind: "usage", message: `${operation2} could not read ${file}: ${error instanceof Error ? error.message : String(error)}` };
      }
    };
    switch (operation) {
      case "status": {
        const status = await facade.status({ deliveryId, observedAt: nowInstant2() });
        if (!status.ok) return { kind: "blocked", blockers: [...status.blockers] };
        emit(status.status);
        return {
          kind: "ok",
          summary: `state ${status.status.delivery.state}; host ${status.status.hostActivity}; next ${status.status.nextCheckpoint.kind}`
        };
      }
      case "blockers": {
        const inventory = await facade.blockerInventory({ deliveryId });
        if (!inventory.ok) return { kind: "blocked", blockers: [...inventory.blockers] };
        emit(inventory.entries);
        return { kind: "ok", summary: `${inventory.entries.length} blocker(s) journaled` };
      }
      case "propose-approval": {
        const requestKind = flag2(rest, "--kind");
        const criterionId = flag2(rest, "--criterion");
        const actorId = flag2(rest, "--actor");
        const reason = flag2(rest, "--reason");
        if (requestKind !== "waiver" && requestKind !== "amendment" || criterionId === void 0 || actorId === void 0 || reason === void 0) {
          return {
            kind: "usage",
            message: "propose-approval requires --kind <waiver|amendment> --criterion <id> --actor <id> --reason <text>."
          };
        }
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const proposed = await facade.recordApprovalRequest({
          deliveryId,
          requestKind,
          criterionId,
          actorId,
          reason,
          fence: invokingFence
        });
        if (!proposed.ok) return { kind: "blocked", blockers: [...proposed.blockers] };
        return { kind: "ok", summary: `${requestKind} proposed for ${criterionId}; delivery is ${proposed.state}` };
      }
      case "request-cancellation": {
        const requested = await facade.requestCancellation({ deliveryId });
        if (!requested.ok) return { kind: "blocked", blockers: [...requested.blockers] };
        return { kind: "ok", summary: `cancellation requested; delivery is ${requested.state}` };
      }
      case "finalize-cancellation": {
        const finalized = await facade.finalizeCancellation({ deliveryId });
        if (!finalized.ok) return { kind: "blocked", blockers: [...finalized.blockers] };
        return { kind: "ok", summary: `prior workspace quarantined; delivery is ${finalized.state}` };
      }
      case "export": {
        const exported = await facade.exportDelivery({ deliveryId });
        if (!exported.ok) return { kind: "blocked", blockers: [...exported.blockers] };
        emit({ exportPath: exported.exportPath, artifactDigest: exported.artifactDigest });
        return { kind: "ok", summary: `exported to ${exported.exportPath}` };
      }
      case "delete": {
        const deleted = await facade.deleteDelivery({ deliveryId });
        if (!deleted.ok) return { kind: "blocked", blockers: [...deleted.blockers] };
        emit({ preservedAuditRecords: deleted.preservedAuditRecords });
        return { kind: "ok", summary: `deleted; ${deleted.preservedAuditRecords.length} audit record(s) preserved` };
      }
      case "recover": {
        const target = flag2(rest, "--generation");
        const recovered = await facade.recoverSecurityBlocked({
          deliveryId,
          now: nowInstant2(),
          ...target === void 0 ? {} : { targetGenerationDigest: target }
        });
        if (!recovered.ok) return { kind: "blocked", blockers: [...recovered.blockers] };
        return { kind: "ok", summary: `${recovered.mode}; delivery is ${recovered.state}` };
      }
      case "next": {
        const next = await facade.nextCheckpoint({ deliveryId });
        if (!next.ok) return { kind: "blocked", blockers: [...next.blockers] };
        emit(next.checkpoint);
        return { kind: "ok", summary: `next checkpoint: ${next.checkpoint.kind}` };
      }
      case "submit-plan": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const resultBytes = await resultFileArg("submit-plan");
        if (typeof resultBytes !== "string") return resultBytes;
        const submitted = await facade.submitStageResult({ deliveryId, stageId: "plan", resultBytes, fence: invokingFence });
        if (!submitted.ok) return { kind: "blocked", blockers: [...submitted.blockers] };
        return { kind: "ok", summary: `plan accepted; delivery is ${submitted.state}` };
      }
      case "checkpoint": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const resultBytes = await resultFileArg("checkpoint");
        if (typeof resultBytes !== "string") return resultBytes;
        const checkpointed = await facade.checkpointCandidate({ deliveryId, resultBytes, fence: invokingFence });
        if (!checkpointed.ok) return { kind: "blocked", blockers: [...checkpointed.blockers] };
        return { kind: "ok", summary: `candidate ${checkpointed.treeSha} checkpointed; delivery is ${checkpointed.state}` };
      }
      case "run-sensor": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const sensed = await facade.runSensor({ deliveryId, fence: invokingFence });
        if (!sensed.ok) return { kind: "blocked", blockers: [...sensed.blockers] };
        return { kind: "ok", summary: `sensor ${sensed.outcome}; delivery is ${sensed.state}` };
      }
      case "reduce-review": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const reduced = await facade.reduceReview({ deliveryId, fence: invokingFence });
        if (!reduced.ok) return { kind: "blocked", blockers: [...reduced.blockers] };
        return { kind: "ok", summary: `review reduced; delivery is ${reduced.state}` };
      }
      case "compound": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const resultBytes = await resultFileArg("compound");
        if (typeof resultBytes !== "string") return resultBytes;
        const compounded = await facade.submitStageResult({ deliveryId, stageId: "compound", resultBytes, fence: invokingFence });
        if (!compounded.ok) return { kind: "blocked", blockers: [...compounded.blockers] };
        return { kind: "ok", summary: `compound recorded; delivery is ${compounded.state}` };
      }
      case "admit": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const admitted = await facade.admit({ deliveryId, recordedAtInstant: nowInstant2(), env: context.env, fence: invokingFence });
        if (!admitted.ok) return { kind: "blocked", blockers: [...admitted.blockers] };
        return { kind: "ok", summary: `admitted; delivery is ${admitted.state}` };
      }
      case "prepare-record": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const prepared = await facade.prepareTrackedRecord({ deliveryId, env: context.env, fence: invokingFence });
        if (!prepared.ok) return { kind: "blocked", blockers: [...prepared.blockers] };
        return { kind: "ok", summary: `tracked record written at ${prepared.relativePath}; commit it through native git tooling` };
      }
      case "confirm-record": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const confirmed = await facade.confirmTrackedRecord({ deliveryId, fence: invokingFence });
        if (!confirmed.ok) return { kind: "blocked", blockers: [...confirmed.blockers] };
        return { kind: "ok", summary: `tracked record verified; delivery is ${confirmed.state}` };
      }
      case "finish": {
        const invokingFence = requireFence();
        if (typeof invokingFence !== "number") return invokingFence;
        const finished = await facade.completeFinishLine({ deliveryId, fence: invokingFence });
        if (!finished.ok) return { kind: "blocked", blockers: [...finished.blockers] };
        return { kind: "ok", summary: `merge-ready; delivery is ${finished.state} (result ${finished.resultDigest})` };
      }
      case "explain-blocker": {
        const explained = await facade.explainBlocker({ deliveryId });
        if (!explained.ok) return { kind: "blocked", blockers: [...explained.blockers] };
        emit(explained.blocker ?? { blocker: null });
        return { kind: "ok", summary: explained.blocker === void 0 ? "no blocker recorded" : `blocker ${explained.blocker.code}` };
      }
      default:
        return { kind: "usage", message: `Unknown managed operation: ${operation}.` };
    }
  }
};

// packages/cli/src/commands/prepare.ts
import {
  classifyCandidateDrift as classifyCandidateDrift2,
  computePreparationFingerprint,
  computeDeliverableIdentity as computeDeliverableIdentity2,
  evaluatePreparationReceipt,
  createBlocker as createBlocker4,
  createExecPort as createExecPort2,
  invalidatePreparationReceipt,
  revokePreparationAttempt,
  publishPreparationReceipt
} from "./kernel.mjs";
var prepareCommand = {
  name: "prepare",
  sourceId: "delivery-harness.cli.prepare",
  summary: "Run preparation checks; --refresh-record-neutral permits proven artifact-only receipt refresh.",
  async run(context) {
    const usage = "Usage: delivery-harness prepare [--refresh-record-neutral]";
    if (context.args.length === 1 && ["--help", "-h"].includes(context.args[0])) {
      return { kind: "ok", summary: `${usage}
Ordinary prepare always runs mechanical checks. The refresh flag reuses prior success only when strict validation, policy, wiring and base are unchanged; otherwise it runs the checks.` };
    }
    if (context.args.length > 1 || context.args.length === 1 && context.args[0] !== "--refresh-record-neutral") {
      return { kind: "usage", message: usage };
    }
    const refreshRecordNeutral = context.args[0] === "--refresh-record-neutral";
    const wiring = await context.wire();
    let retainedAttemptId;
    let ownedAttemptId;
    let refreshed = false;
    try {
      let capture;
      let reusableFingerprint;
      let attemptId;
      try {
        capture = await wiring.captureCandidate();
        if (capture.ok && refreshRecordNeutral) {
          const previous = await evaluatePreparationReceipt(
            context.rootDir,
            { config: context.config, candidate: capture.candidate },
            { ...wiring.storageOptions, allowValidationEquivalent: true }
          );
          if (previous.prepared && previous.receipt.attemptId !== void 0) {
            reusableFingerprint = previous.receipt.preparationFingerprint;
            retainedAttemptId = previous.receipt.attemptId;
          }
        }
      } finally {
        attemptId = retainedAttemptId ?? await invalidatePreparationReceipt(context.rootDir, context.config, wiring.storageOptions);
        ownedAttemptId = attemptId;
      }
      if (!capture.ok) {
        return { kind: "blocked", blockers: [...capture.blockers] };
      }
      const fingerprint = await computePreparationFingerprint(context.rootDir, context.config, wiring.storageOptions);
      const reusable = reusableFingerprint === fingerprint;
      if (!reusable && retainedAttemptId !== void 0) {
        attemptId = await invalidatePreparationReceipt(context.rootDir, context.config, wiring.storageOptions);
        ownedAttemptId = attemptId;
        retainedAttemptId = void 0;
      }
      const validationDigest = await computeDeliverableIdentity2({
        rootDir: context.rootDir,
        treeSha: capture.candidate.treeSha,
        config: { ...context.config, computingIdentityVersion: "validation-tree/v1", reviewNeutral: context.config.recordNeutral }
      });
      if (reusable) context.write("reusing preparation checks: strict validation projection, base, policy and wiring unchanged");
      const exec = createExecPort2();
      const env = Object.fromEntries(Object.entries(context.env).filter((entry) => entry[1] !== void 0));
      for (const check of reusable ? [] : context.config.preparationCommands ?? []) {
        context.write(`preparing ${check.id}`);
        const result = await exec.run({
          command: check.command[0],
          args: check.command.slice(1),
          cwd: context.rootDir,
          env,
          timeoutMs: check.timeoutMs,
          maxBuffer: 1024 * 1024,
          ...context.signal === void 0 ? {} : { signal: context.signal }
        });
        if (result.code !== 0 || context.signal?.aborted) {
          return {
            kind: "blocked",
            blockers: [createBlocker4({
              code: "preparation_command_failed",
              source: { kind: "command", id: "delivery-harness.cli.prepare" },
              summary: `Preparation check ${check.id} failed; no receipt was published.`,
              details: `exit ${result.code}${result.errorCode === void 0 ? "" : ` (${result.errorCode})`}
${`${result.stdout}
${result.stderr}`.slice(-4e3)}`,
              remediations: [{ id: "repair-preparation-check", kind: "manual_action", summary: `Fix ${check.id}, then run prepare again.` }]
            })]
          };
        }
      }
      if (context.signal?.aborted) throw new CliInterruption();
      const finalCapture = await wiring.captureCandidate();
      if (!finalCapture.ok) return { kind: "blocked", blockers: [...finalCapture.blockers] };
      const after = finalCapture.candidate;
      if (classifyCandidateDrift2(capture.candidate, after).length > 0 || capture.candidate.headSha !== after.headSha || capture.candidate.mode !== after.mode || fingerprint !== await computePreparationFingerprint(context.rootDir, context.config, wiring.storageOptions)) {
        return {
          kind: "blocked",
          blockers: [createBlocker4({
            code: "preparation_candidate_changed",
            source: { kind: "command", id: "delivery-harness.cli.prepare" },
            summary: "The candidate, base, or preparation wiring changed while checks ran; no receipt was published.",
            remediations: [{ id: "prepare-stable-candidate", kind: "manual_action", summary: "Commit any intended changes and prepare the stable candidate again." }]
          })]
        };
      }
      const published = await publishPreparationReceipt(
        context.rootDir,
        { config: context.config, candidate: capture.candidate, attemptId, validationDigest },
        wiring.storageOptions
      );
      if (context.signal?.aborted) throw new CliInterruption();
      refreshed = true;
      return {
        kind: "ok",
        summary: [
          `prepared ${context.config.gateId}: tree ${capture.candidate.treeSha} (${capture.candidate.mode}); receipt ${published.path}`,
          `  treeSha ${capture.candidate.treeSha}`
        ].join("\n")
      };
    } finally {
      if (ownedAttemptId !== void 0 && !refreshed) {
        await revokePreparationAttempt(context.rootDir, context.config, ownedAttemptId, wiring.storageOptions);
      }
    }
  }
};

// packages/cli/src/commands/record.ts
import {
  buildDeliveryRecord,
  computePreparationFingerprint as computePreparationFingerprint2,
  capturePortableEvidenceContext,
  repositoryEvidenceReader,
  capturePortableVerificationInputs,
  verifyDeliveryRecord,
  deliveryRecordBytes,
  deliveryRecordPathFor,
  discoverRecords
} from "./kernel.mjs";
import path7 from "node:path";
var recordCommand = {
  name: "record",
  sourceId: "delivery-harness.cli.record",
  summary: "Write the tracked delivery record for an admitted gate.",
  async run(context) {
    const wiring = await context.wire();
    const admission = await runProviderBackedAdmission(context, { allowPrompt: false, includeInjectedLiveResults: false });
    if (!admission.admitted || admission.decision === void 0) {
      return { kind: "blocked", blockers: [...admission.blockers] };
    }
    const decision = admission.decision;
    const recheck = await wiring.captureCandidate();
    if (!recheck.ok) {
      return { kind: "blocked", blockers: [...recheck.blockers] };
    }
    if (recheck.candidate.deliverable.digest !== decision.candidate.deliverable.digest) {
      return {
        kind: "blocked",
        blockers: [
          commandBlocker({
            code: "record_identity_changed",
            sourceId: "delivery-harness.cli.record",
            summary: "The deliverable identity changed after the gate; nothing was recorded.",
            details: `gate ${decision.candidate.deliverable.digest} but current ${recheck.candidate.deliverable.digest}`,
            remediations: [
              {
                id: "reprepare-and-record",
                kind: "command",
                command: ["delivery-harness", "prepare"],
                summary: "Re-prepare the candidate and re-run the gate before recording."
              }
            ]
          })
        ]
      };
    }
    const evidenceRecords = [];
    for (const obligation of context.config.obligations) {
      const discovery = await discoverRecords(context.rootDir, {
        gateId: context.config.gateId,
        obligationId: obligation.id,
        ...wiring.storageOptions
      });
      evidenceRecords.push(...discovery.records);
    }
    const evidenceContext = await capturePortableEvidenceContext(
      context.config,
      repositoryEvidenceReader(context.rootDir, context.artifacts),
      await computePreparationFingerprint2(context.rootDir, context.config)
    );
    const built = buildDeliveryRecord({ config: context.config, decision, evidenceRecords, context: evidenceContext });
    if (!built.ok) {
      return { kind: "blocked", blockers: [...built.blockers] };
    }
    const verificationInputs = await capturePortableVerificationInputs(context.rootDir, context.config, recheck.candidate, built.record);
    const checked = verifyDeliveryRecord(
      context.config,
      built.record,
      { deliverableDigest: recheck.candidate.deliverable.digest, identityToken: recheck.candidate.deliverable.identity },
      recheck.candidate.base,
      { ...verificationInputs, liveResults: admission.observedLiveResults ?? [], executionContext: context.classifyContext() }
    );
    if (!checked.ok) return { kind: "blocked", blockers: [...checked.blockers] };
    const relativePath = deliveryRecordPathFor(context.config, decision.candidate.deliverable.digest);
    const absolutePath = path7.join(context.rootDir, relativePath);
    await context.artifacts.writeTextFile(absolutePath, deliveryRecordBytes(built.record));
    return { kind: "ok", summary: `recorded ${relativePath}` };
  }
};

// packages/cli/src/commands/review-context.ts
import { evaluatePreparationReceipt as evaluatePreparationReceipt3 } from "./kernel.mjs";

// packages/cli/src/review-evidence.ts
import { randomUUID as randomUUID3 } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path8 from "node:path";
import {
  resolveReviewCharters,
  validateReviewedContext,
  parseReviewOutcome,
  deriveTelemetry,
  reviewerLists,
  capturePortableEvidenceContext as capturePortableEvidenceContext2,
  repositoryEvidenceReader as repositoryEvidenceReader2,
  createArtifactsPort as createArtifactsPort2,
  ReviewInputError as OutcomeError,
  BlockedError as BlockedError3,
  digestCanonical as digestCanonical2,
  evaluatePreparationReceipt as evaluatePreparationReceipt2,
  sha256Hex as sha256Hex3
} from "./kernel.mjs";
import { validateReviewedContext as validateReviewedContext2, parseReviewOutcome as parseReviewOutcome2, deriveTelemetry as deriveTelemetry2, reviewerLists as reviewerLists2, REVIEWER_RESULTS } from "./kernel.mjs";
var REVIEW_PAYLOAD_SPEC = "review.green/1";
var ENVELOPE_SPEC = "delivery-evidence/1";
var EMITTER_VERSION = "1.0.0";
var REVIEW_CONTEXT_SPEC = "review-context/1";
function manifestCandidate(captured) {
  return {
    vcs: captured.vcs,
    treeSha: captured.treeSha,
    headSha: captured.headSha,
    deliverable: { digest: captured.deliverable.digest, identity: captured.deliverable.identity },
    base: { ref: captured.base.ref, tipSha: captured.base.tipSha, mergeBaseSha: captured.base.mergeBaseSha },
    workspaceId: captured.workspaceId
  };
}
async function buildReviewContext(rootDir, config, candidate, receipt) {
  const inputs = await capturePortableEvidenceContext2(config, repositoryEvidenceReader2(rootDir, createArtifactsPort2()), receipt.preparationFingerprint);
  const charters = inputs.reviewerCharters;
  if (charters.length === 0 || inputs.release === null) throw new OutcomeError("the compiled policy activates no review lens or installed release");
  const binding = {
    gate: resolveGateBinding(config),
    candidate: manifestCandidate(candidate),
    preparationFingerprint: inputs.preparationFingerprint,
    configurationDigest: inputs.configurationDigest,
    policyDigest: inputs.policyDigest,
    release: inputs.release,
    workflowGraphSha256: inputs.workflowGraphSha256,
    charters
  };
  return { spec: REVIEW_CONTEXT_SPEC, digest: digestCanonical2(binding), binding };
}
function resolveGateBinding(config) {
  const obligations = config.obligations.filter(
    (obligation2) => obligation2.acceptedPayloadSpecs.includes(REVIEW_PAYLOAD_SPEC)
  );
  if (obligations.length !== 1) {
    throw new OutcomeError(
      `the gate declares ${obligations.length} obligations accepting ${REVIEW_PAYLOAD_SPEC}; this provider serves exactly one`
    );
  }
  const obligation = obligations[0];
  if (obligation.providers.length !== 1) {
    throw new OutcomeError(
      `obligation ${obligation.id} names ${obligation.providers.length} providers; this provider serves exactly one`
    );
  }
  return { obligationId: obligation.id, providerId: obligation.providers[0] };
}
async function emitReviewEvidence(context, original, document) {
  const { rootDir, config } = context;
  const wiring = await context.wire();
  const capture = await wiring.captureCandidate();
  if (!capture.ok) throw new OutcomeError(`the candidate could not be captured: ${capture.code}`);
  const captured = capture.candidate;
  const preparation = await evaluatePreparationReceipt2(rootDir, { config, candidate: captured }, wiring.storageOptions);
  if (!preparation.prepared) throw new BlockedError3([...preparation.blockers]);
  const current = await buildReviewContext(rootDir, config, captured, preparation.receipt);
  validateReviewedContext(original, current, document);
  const charters = current.binding.charters.map((charter) => charter.reviewerId).sort();
  const outcome = parseReviewOutcome(document, charters);
  const binding = current.binding.gate;
  const candidate = manifestCandidate(captured);
  const provider = {
    id: binding.providerId,
    version: EMITTER_VERSION,
    // One emitter run is one evaluated pass over this candidate.
    runId: `r-${randomUUID3()}`,
    finalPassId: outcome.finalPassId ?? "pass-1"
  };
  const reviewed = original;
  const originalRunHistory = outcome.runHistory ?? [{
    preparedTreeSha: reviewed.binding.candidate.treeSha,
    evaluatedInPassId: provider.finalPassId
  }];
  const finalEntry = originalRunHistory.at(-1);
  if (finalEntry["preparedTreeSha"] !== reviewed.binding.candidate.treeSha || finalEntry["evaluatedInPassId"] !== provider.finalPassId) {
    throw new OutcomeError("the supplied final review pass does not name the original reviewed candidate");
  }
  const runHistory = originalRunHistory.map((entry, index) => index === originalRunHistory.length - 1 ? { ...entry, preparedTreeSha: captured.treeSha } : entry);
  const allocation = await context.artifacts.allocateRunRoot({ providerId: provider.id, runId: provider.runId });
  if (!allocation.ok) throw new OutcomeError(`the run root was refused: ${allocation.reason}`);
  const runRoot = allocation.runRoot.path;
  const lists = reviewerLists(charters, outcome);
  await mkdir(path8.join(runRoot, "reviewers"), { recursive: true });
  const artifacts = [];
  for (const [name, value] of [["review-context", original], ["review-outcome", document]]) {
    const bytes = `${JSON.stringify(value, null, 2)}
`;
    await writeFile(path8.join(runRoot, `${name}.json`), bytes, "utf8");
    artifacts.push({ path: `${name}.json`, sha256: sha256Hex3(bytes), role: name });
  }
  if (digestCanonical2(reviewed.binding.candidate) !== digestCanonical2(candidate)) {
    const bytes = `${JSON.stringify({
      spec: "review-context-projection/1",
      basis: "unchanged-deliverable-and-review-inputs",
      originalContextDigest: reviewed.digest,
      reviewedCandidate: reviewed.binding.candidate,
      preparedCandidate: candidate,
      originalRunHistory,
      reviewRoundAdded: false
    }, null, 2)}
`;
    await writeFile(path8.join(runRoot, "review-context-projection.json"), bytes, "utf8");
    artifacts.push({ path: "review-context-projection.json", sha256: sha256Hex3(bytes), role: "review-context-projection" });
  }
  for (const reviewerId of lists.approved) {
    const stamp = `${JSON.stringify(
      {
        schemaVersion: 1,
        reviewerId,
        result: "approved",
        provider: { id: provider.id, runId: provider.runId, finalPassId: provider.finalPassId },
        workspaceId: candidate.workspaceId,
        candidate
      },
      null,
      2
    )}
`;
    const relativePath = `reviewers/${reviewerId}.json`;
    await writeFile(path8.join(runRoot, relativePath), stamp, "utf8");
    artifacts.push({ path: relativePath, sha256: sha256Hex3(stamp), role: "reviewer-approval" });
  }
  const manifest = {
    spec: ENVELOPE_SPEC,
    provider,
    candidate,
    repository: null,
    runHistory,
    artifacts,
    attestation: { level: "self", signatures: [] },
    recordedAt: (/* @__PURE__ */ new Date()).toISOString(),
    claims: [
      {
        obligation: binding.obligationId,
        payloadSpec: REVIEW_PAYLOAD_SPEC,
        payload: {
          verdict: outcome.verdict,
          finalized: true,
          editedAfterFinalPass: false,
          reviewers: {
            selected: lists.selected,
            completed: lists.completed,
            failed: lists.failed,
            timedOut: lists.timedOut
          },
          findings: outcome.findings,
          telemetry: { ...deriveTelemetry(outcome.findings, runHistory.length), ...outcome.cost === void 0 ? {} : { cost: outcome.cost } }
        }
      }
    ]
  };
  const manifestPath = path8.join(runRoot, "manifest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}
`, "utf8");
  return { manifestPath, runRoot };
}

// packages/cli/src/commands/review-context.ts
var reviewContextCommand = {
  name: "review-context",
  sourceId: "delivery-harness.cli.review-context",
  summary: "Show the reviewable-change context for the prepared candidate.",
  async run(context) {
    if (context.args.length > 0 && !(context.args.length === 1 && context.args[0] === "--json")) {
      return { kind: "usage", message: "review-context accepts only --json." };
    }
    const wiring = await context.wire();
    const capture = await wiring.captureCandidate();
    if (!capture.ok) {
      return { kind: "blocked", blockers: [...capture.blockers] };
    }
    const evaluation = await evaluatePreparationReceipt3(
      context.rootDir,
      { config: context.config, candidate: capture.candidate },
      wiring.storageOptions
    );
    if (!evaluation.prepared) {
      const blockers = [...evaluation.blockers];
      if (evaluation.failure === "missing") {
        blockers.push(
          commandBlocker({
            code: "review_context_requires_receipt",
            sourceId: "delivery-harness.cli.review-context",
            summary: "Review context is unavailable until the candidate is prepared.",
            remediations: [
              {
                id: "run-prepare",
                kind: "command",
                command: ["delivery-harness", "prepare"],
                summary: "Publish a preparation receipt for the current candidate."
              }
            ]
          })
        );
      }
      return { kind: "blocked", blockers };
    }
    if (context.args[0] === "--json") {
      try {
        const document = await buildReviewContext(context.rootDir, context.config, capture.candidate, evaluation.receipt);
        return { kind: "ok", summary: JSON.stringify(document, null, 2) };
      } catch (error) {
        if (!(error instanceof OutcomeError)) throw error;
        return { kind: "blocked", blockers: [commandBlocker({
          code: "review_context_unavailable",
          sourceId: "delivery-harness.cli.review-context",
          summary: error.message,
          remediations: [{ id: "restore-review-inputs", kind: "manual_action", summary: "Restore the installed workflow release and compiled policy charters before acquiring review." }]
        })] };
      }
    }
    const projection = await wiring.projectActivation(capture.candidate);
    const active = projection.relevantLineCount >= context.config.activationThreshold || projection.hasRelevantBinaryChange;
    return {
      kind: "ok",
      summary: [
        `review context for ${context.config.gateId}:`,
        `  candidate tree ${capture.candidate.treeSha} (${capture.candidate.mode})`,
        `  relevant lines ${projection.relevantLineCount} across ${projection.changedEntryCount} changed entr${projection.changedEntryCount === 1 ? "y" : "ies"}`,
        `  activation ${active ? "active" : "inactive"} (threshold ${context.config.activationThreshold})`,
        ...projection.sensitivePathIds.length > 0 ? [`  sensitive: ${projection.sensitivePathIds.join(", ")}`] : [],
        `  submit evidence with: delivery-harness submit-evidence --manifest <path>`
      ].join("\n")
    };
  }
};

// packages/cli/src/commands/emit-review-evidence.ts
import { readFile as readFile4 } from "node:fs/promises";
import path9 from "node:path";
var emitReviewEvidenceCommand = {
  name: "emit-review-evidence",
  sourceId: "delivery-harness.cli.emit-review-evidence",
  summary: "Bind concluded review outcomes to their original prepared context.",
  async run(context) {
    if (context.args.length !== 2 || context.args[0] !== "--context" || !context.args[1] || context.args[1].startsWith("-")) {
      return { kind: "usage", message: "emit-review-evidence requires --context <review-context.json> and a review-outcome/1 document on stdin." };
    }
    let original;
    let document;
    try {
      original = JSON.parse(await readFile4(path9.resolve(context.rootDir, context.args[1]), "utf8"));
      const raw = await context.readStdin?.() ?? "";
      if (!raw.trim()) return { kind: "usage", message: "The review-outcome/1 document is required on stdin." };
      document = JSON.parse(raw);
    } catch {
      return { kind: "usage", message: "The original context and review outcome must be readable JSON documents." };
    }
    try {
      const result = await emitReviewEvidence(context, original, document);
      return { kind: "ok", summary: result.manifestPath };
    } catch (error) {
      if (!(error instanceof OutcomeError)) throw error;
      return { kind: "blocked", blockers: [commandBlocker({
        code: "review_outcome_invalid",
        sourceId: "delivery-harness.cli.emit-review-evidence",
        summary: error.message,
        remediations: [{ id: "supply-reviewed-context", kind: "manual_action", summary: "Use the original review-context --json output and concluded outcomes naming its digest; acquire a new review if the deliverable or review inputs changed." }]
      })] };
    }
  }
};

// packages/cli/src/commands/runs.ts
import { stat } from "node:fs/promises";
import path10 from "node:path";
import { evaluateRunJournal as evaluateRunJournal4 } from "./kernel.mjs";

// packages/cli/src/run-projection.ts
import {
  RUN_JOURNAL_REQUIRED_ENTRIES,
  runJournalCarries,
  runPrimaryTicket
} from "./kernel.mjs";
var READOUT_LABELS = "self-attested; observability, not evidence; unbound to a record";
function costLabel(value) {
  const cost = typeof value === "object" && value !== null ? value : {};
  if (cost["coverage"] === "unreported" || cost["total"] === void 0) return "unreported";
  const measured = `${oneLineOf(cost["total"])} ${oneLineOf(cost["unit"])}`.trim();
  return cost["coverage"] === "partial" ? `${measured} (partial coverage)` : measured;
}
function projectCosts(events) {
  const closed = events.filter((event) => event.kind === "review.round.closed");
  const totals = /* @__PURE__ */ new Map();
  let unreportedEntries = 0;
  let partial = events.filter((event) => event.kind === "review.round.opened").length !== closed.length;
  for (const event of closed) {
    const cost = payloadOf(event)["cost"];
    if (cost["coverage"] === "unreported") {
      unreportedEntries += 1;
      continue;
    }
    if (cost["coverage"] === "partial") partial = true;
    const unit = cost["unit"];
    const reportedBy = cost["reportedBy"];
    const key = JSON.stringify([reportedBy, unit]);
    const prior = totals.get(key);
    const sum = prior?.total === null ? Infinity : (prior?.total ?? 0) + cost["total"];
    if (!Number.isFinite(sum)) partial = true;
    totals.set(key, { unit, total: Number.isFinite(sum) ? sum : null, reportedBy });
  }
  const ended = events.find((event) => event.kind === "run.ended");
  return {
    review: {
      coverage: totals.size === 0 ? "unreported" : partial || unreportedEntries > 0 ? "partial" : "complete",
      unreportedEntries,
      totals: [...totals.values()]
    },
    run: ended === void 0 ? { coverage: "unreported" } : payloadOf(ended)["cost"]
  };
}
var payloadOf = (event) => typeof event.payload === "object" && event.payload !== null ? event.payload : {};
var boundTicket = (event) => event.ticket === void 0 ? "" : ` for ${oneLineOf(event.ticket, 128)}`;
function detailOf(event) {
  const payload = payloadOf(event);
  switch (event.kind) {
    case "run.started":
      return oneLineOf(payload["host"]) + (payload["displacedRunId"] === void 0 ? "" : ` displaced ${oneLineOf(payload["displacedRunId"])}`);
    case "run.ended":
      return `${oneLineOf(payload["result"])} cost ${costLabel(payload["cost"])}`;
    case "ticket.read":
      return `${oneLineOf(payload["ticket"])} via ${oneLineOf(payload["tracker"])}`;
    case "posture.declared":
      return oneLineOf(payload["posture"]) + boundTicket(event);
    case "lens.selected":
      return `mandated ${oneLineOf(payload["mandated"])} selected ${oneLineOf(payload["selected"])} \u2014 ${oneLineOf(payload["rationale"])}`;
    case "review.round.opened":
      return `round ${oneLineOf(payload["round"])} on ${oneLineOf(event.candidateTreeSha)} lenses ${oneLineOf(payload["lenses"])}`;
    case "review.round.closed":
      return `round ${oneLineOf(payload["round"])} ${oneLineOf(payload["outcome"])} findings ${oneLineOf(payload["findings"])}`;
    case "command.completed":
      return `${oneLineOf(payload["command"])} ${oneLineOf(payload["outcome"])} in ${oneLineOf(payload["durationMs"])}ms`;
    case "gate.reported":
      return `${oneLineOf(payload["command"])} ${oneLineOf(payload["outcome"])} in ${oneLineOf(payload["durationMs"])}ms${boundTicket(event)}`;
    case "pr.opened":
      return `${oneLineOf(payload["url"], 400)} on ${oneLineOf(event.candidateTreeSha)}${boundTicket(event)}`;
    case "blocker.recorded":
      return `${oneLineOf(payload["code"])} \u2014 ${oneLineOf(payload["summary"])}`;
    case "decision.recorded":
      return `${oneLineOf(payload["fork"])} \u2014 ${oneLineOf(payload["choice"])}${payload["cited"] === void 0 ? "" : ` (cited ${oneLineOf(payload["cited"])})`}`;
    case "compounding.recorded":
      return `${oneLineOf(payload["outcome"])}${payload["reference"] === void 0 ? "" : ` \u2014 ${oneLineOf(payload["reference"])}`}`;
    case "context.saved":
      return `stage ${oneLineOf(payload["stage"])} (observation only)`;
    case "action.intent":
    case "action.observed":
      return `${oneLineOf(payload["actionId"])} ${oneLineOf(payload["outcome"] ?? "unknown")} reference ${oneLineOf(payload["reference"])}`;
    default:
      return "";
  }
}
function roundEntries(events) {
  const rounds = /* @__PURE__ */ new Map();
  for (const event of events) {
    if (event.kind !== "review.round.opened" && event.kind !== "review.round.closed") continue;
    const key = oneLineOf(payloadOf(event)["round"], 32);
    const entry = rounds.get(key) ?? {};
    if (event.kind === "review.round.opened") entry.opened = event;
    else entry.closed = event;
    rounds.set(key, entry);
  }
  return [...rounds.entries()].map(([round, entry]) => {
    const anchor = entry.opened ?? entry.closed;
    return {
      round,
      candidateTreeSha: oneLineOf(anchor?.candidateTreeSha),
      ...entry.opened === void 0 ? {} : { opened: entry.opened },
      ...entry.closed === void 0 ? {} : { closed: entry.closed }
    };
  });
}
function roundLenses(entry) {
  return entry.opened === void 0 ? "never opened" : oneLineOf(payloadOf(entry.opened)["lenses"]);
}
function roundRows(events) {
  return roundEntries(events).map((entry) => {
    const closed = entry.closed === void 0 ? void 0 : payloadOf(entry.closed);
    return [
      `  round ${entry.round}`,
      `candidate ${entry.candidateTreeSha || "(none)"}`,
      entry.opened === void 0 ? roundLenses(entry) : `lenses ${roundLenses(entry)}`,
      closed === void 0 ? "open" : `${oneLineOf(closed["outcome"])} findings ${oneLineOf(closed["findings"])} cost ${costLabel(closed["cost"])}`
    ].join("  ");
  });
}
function readoutOf(events, evaluation, rootDir) {
  const present = RUN_JOURNAL_REQUIRED_ENTRIES.filter((entry) => runJournalCarries(events, entry));
  const note = evaluation.status === "complete-executor-only" && rootDir !== void 0 && harnessConfigPresentAt(rootDir) ? `no CLI gate completion in this journal; harness.config.ts present at ${oneLine(rootDir, 400)}` : void 0;
  return {
    status: evaluation.status,
    present,
    missing: evaluation.missing,
    violations: evaluation.violations,
    ...note === void 0 ? {} : { note }
  };
}
function readoutRows(events, evaluation, rootDir) {
  const readout = readoutOf(events, evaluation, rootDir);
  const rows = [
    `  completeness: ${readout.status}  (${READOUT_LABELS})`,
    `    present: ${readout.present.length === 0 ? "(none)" : readout.present.join(", ")}`,
    `    missing: ${readout.missing.length === 0 ? "(none)" : [...readout.missing].join(", ")}`
  ];
  if (readout.violations.length > 0) rows.push(`    violations: ${[...readout.violations].join(", ")}`);
  if (readout.note !== void 0) rows.push(`    note: ${readout.note}`);
  return rows;
}
var cliCompletionFor = (events, command) => events.findLast(
  (event) => event.kind === "command.completed" && event.actor.role === "cli" && payloadOf(event)["command"] === command
);
var severityOf = (value, key) => {
  const findings = typeof value === "object" && value !== null ? value : {};
  const count = findings[key];
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
};
function spanSeconds(from, to) {
  const start = Date.parse(from);
  const end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return 0;
  return Math.round((end - start) / 1e3);
}
function summarize(events) {
  const first = events[0];
  const last = events[events.length - 1];
  const startedAt = first?.at ?? "";
  const lastAt = last?.at ?? "";
  const ended = events.find((event) => event.kind === "run.ended");
  const gateCompletion = cliCompletionFor(events, "gate");
  const gateReported = events.find((event) => event.kind === "gate.reported");
  const recordCompletion = cliCompletionFor(events, "record");
  const closed = events.filter((event) => event.kind === "review.round.closed");
  const gate = gateCompletion !== void 0 ? { outcome: oneLineOf(payloadOf(gateCompletion)["outcome"], 64), writer: "cli" } : gateReported !== void 0 ? { outcome: oneLineOf(payloadOf(gateReported)["outcome"], 64), writer: "executor" } : void 0;
  return {
    ticket: oneLineOf(runPrimaryTicket(events), 128),
    open: ended === void 0,
    startedAt,
    lastAt,
    durationSeconds: spanSeconds(startedAt, lastAt),
    roundsOpened: events.filter((event) => event.kind === "review.round.opened").length,
    roundsClosed: closed.length,
    findings: {
      P0: closed.reduce((total, event) => total + severityOf(payloadOf(event)["findings"], "P0"), 0),
      P1: closed.reduce((total, event) => total + severityOf(payloadOf(event)["findings"], "P1"), 0),
      P2: closed.reduce((total, event) => total + severityOf(payloadOf(event)["findings"], "P2"), 0),
      P3: closed.reduce((total, event) => total + severityOf(payloadOf(event)["findings"], "P3"), 0)
    },
    ...gate === void 0 ? {} : { gate },
    ...recordCompletion === void 0 ? {} : { record: { outcome: oneLineOf(payloadOf(recordCompletion)["outcome"], 64), writer: "cli" } },
    ...ended === void 0 ? {} : { result: oneLineOf(payloadOf(ended)["result"], 64) }
  };
}

// packages/cli/src/run-export.ts
import { canonicalize, evaluateRunJournal as evaluateRunJournal2, RUN_STORE_ID as RUN_STORE_ID2, validateRunEvent } from "./kernel.mjs";
function buildRunExport(input) {
  return {
    spec: "delivery-run-export/1",
    labels: READOUT_LABELS,
    runId: input.runId,
    events: input.events,
    summary: summarize(input.events),
    costs: projectCosts(input.events),
    readout: readoutOf(input.events, evaluateRunJournal2(input.events), input.rootDir),
    refusedAppends: input.refusedAppends ?? []
  };
}

// packages/cli/src/run-server.ts
import { createServer } from "node:http";
import {
  evaluateRunJournal as evaluateRunJournal3
} from "./kernel.mjs";
var RUN_SERVER_HOST = "127.0.0.1";
var DEFAULT_POLL_SECONDS = 2;
var RUN_SERVER_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "style-src 'unsafe-inline'",
  "img-src 'none'",
  "connect-src 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'"
].join("; ");
async function resolveRepo(repoPath) {
  const surface = await resolveRunSurface(repoPath);
  if (!surface.ok) return { reason: `${repoPath}: ${surface.reason}` };
  const root = await resolveWorktreeRoot(repoPath);
  if (!root.ok) return { reason: `${repoPath}: ${root.reason}` };
  return {
    root: root.root,
    commonDir: surface.surface.commonDir,
    runsDir: surface.surface.runsDir,
    worktreeKey: surface.surface.worktreeKey,
    store: surface.surface.store
  };
}
function groupByStore(resolved) {
  const groups = /* @__PURE__ */ new Map();
  for (const repo of resolved) {
    const existing = groups.get(repo.commonDir);
    if (existing === void 0) {
      groups.set(repo.commonDir, {
        root: repo.root,
        commonDir: repo.commonDir,
        runsDir: repo.runsDir,
        worktreeKeys: [repo.worktreeKey],
        store: repo.store
      });
      continue;
    }
    if (!existing.worktreeKeys.includes(repo.worktreeKey)) existing.worktreeKeys.push(repo.worktreeKey);
  }
  return [...groups.values()];
}
function servedRun(input) {
  const { summary } = input;
  return {
    runId: input.runId,
    repository: input.repository,
    readable: input.readable,
    live: input.live,
    open: summary.open,
    ticket: summary.ticket,
    startedAt: summary.startedAt,
    lastAt: summary.lastAt,
    durationSeconds: summary.durationSeconds,
    rounds: { opened: summary.roundsOpened, closed: summary.roundsClosed },
    findings: summary.findings,
    ...summary.gate === void 0 ? {} : { gate: summary.gate },
    ...summary.record === void 0 ? {} : { record: summary.record },
    ...summary.result === void 0 ? {} : { result: summary.result },
    readout: input.readout,
    timeline: input.timeline,
    roundDetail: input.roundDetail,
    notes: input.notes
  };
}
var EMPTY_SUMMARY = {
  ticket: "",
  open: true,
  startedAt: "",
  lastAt: "",
  durationSeconds: 0,
  roundsOpened: 0,
  roundsClosed: 0,
  findings: { P0: 0, P1: 0, P2: 0, P3: 0 }
};
function timelineOf(events) {
  return events.map((event) => ({
    seq: event.seq,
    at: event.at,
    kind: event.kind,
    writer: event.actor.role,
    detail: detailOf(event)
  }));
}
function roundsOf(events) {
  return roundEntries(events).map((entry) => {
    const closed = entry.closed === void 0 ? void 0 : payloadOf(entry.closed);
    return {
      round: entry.round,
      candidateTreeSha: entry.candidateTreeSha,
      opened: entry.opened !== void 0,
      lenses: roundLenses(entry),
      outcome: closed === void 0 ? "open" : oneLineOf(closed["outcome"], 64),
      findings: closed === void 0 ? "" : oneLineOf(closed["findings"]),
      cost: closed === void 0 ? "" : costLabel(closed["cost"])
    };
  });
}
function notesOf(entries) {
  return entries.map((entry) => {
    const note = typeof entry === "object" && entry !== null ? entry : {};
    return {
      at: oneLineOf(note["at"], 32),
      kind: oneLineOf(note["kind"], 128),
      code: oneLineOf(note["code"], 64),
      pattern: oneLineOf(note["pattern"], 64)
    };
  });
}
async function readState(groups, pollSeconds) {
  const runs = [];
  for (const group of groups) {
    const live = /* @__PURE__ */ new Set();
    for (const worktreeKey of group.worktreeKeys) {
      const current = await group.store.current(worktreeKey);
      if (current.ok && current.runId !== void 0) live.add(current.runId);
    }
    for (const runId of await group.store.list()) {
      const read = await group.store.read(runId);
      const notes = notesOf(await group.store.readNotes(runId));
      if (!read.ok) {
        runs.push(
          servedRun({
            runId,
            repository: group.root,
            readable: false,
            live: false,
            summary: EMPTY_SUMMARY,
            readout: { status: "absent", present: [], missing: [], violations: [] },
            timeline: [],
            roundDetail: [],
            notes
          })
        );
        continue;
      }
      const events = read.events;
      const summary = summarize(events);
      runs.push(
        servedRun({
          runId,
          repository: group.root,
          readable: true,
          // Liveness is the pointer AND the absence of an end, never one alone:
          // a pointer left behind by a run that ended without clearing it must
          // not read as a run still in flight.
          live: summary.open && live.has(runId),
          summary,
          // No record tree sha and no mandated pair: the viewer has neither, and
          // pretending otherwise would turn an observation into a claim.
          readout: readoutOf(events, evaluateRunJournal3(events), group.root),
          timeline: timelineOf(events),
          roundDetail: roundsOf(events),
          notes
        })
      );
    }
  }
  return {
    labels: READOUT_LABELS,
    pollSeconds,
    repositories: groups.map((group) => ({
      root: group.root,
      commonDir: group.commonDir,
      runsDir: group.runsDir,
      worktreeKeys: group.worktreeKeys
    })),
    runs
  };
}
function escapeHtml(value) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
var cell = (value, maximum = 240) => escapeHtml(oneLine(value, maximum));
var STYLE = [
  "body{font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;margin:1.5rem;color:#1a1a1a;background:#fbfbfa}",
  "h1{font-size:1.1rem;margin:0 0 .25rem}h2{font-size:.95rem;margin:1.5rem 0 .4rem}h3{font-size:.85rem;margin:.9rem 0 .3rem;color:#555}",
  ".labels{color:#7a6a00;background:#fffbe6;border:1px solid #e8dca0;padding:.35rem .5rem;margin:.5rem 0 1rem}",
  "table{border-collapse:collapse;width:100%;margin:.3rem 0 .6rem}",
  "th,td{border:1px solid #ddd;padding:.22rem .45rem;text-align:left;vertical-align:top;word-break:break-word}",
  "th{background:#f0f0ee;font-weight:600}",
  ".live{color:#0a6b2e;font-weight:700}.ended{color:#666}.open{color:#7a4b00}",
  ".meta{color:#666;margin:.2rem 0}",
  "@media(prefers-color-scheme:dark){body{background:#16181a;color:#e6e6e6}th{background:#24272a}th,td{border-color:#3a3f44}",
  ".labels{color:#e8d98a;background:#2a2718;border-color:#4d4526}.meta,.ended{color:#9aa0a6}h3{color:#9aa0a6}}"
].join("");
var RUNS_HEADER = ["run", "ticket", "repository", "duration", "rounds", "findings", "gate", "record", "result", "state"];
function stateCell(run) {
  if (!run.readable) return `<td class="open">unreadable</td>`;
  if (run.live) return `<td class="live">live</td>`;
  return run.open ? `<td class="open">open</td>` : `<td class="ended">ended</td>`;
}
var written = (outcome) => outcome === void 0 ? "\u2014" : `${cell(outcome.outcome, 64)} <span class="meta">(${cell(outcome.writer, 16)}-written)</span>`;
function runsTable(state) {
  const rows = state.runs.map(
    (run) => [
      "<tr>",
      `<td>${cell(run.runId, 128)}</td>`,
      `<td>${cell(run.ticket, 128) || "\u2014"}</td>`,
      `<td>${cell(run.repository, 400)}</td>`,
      `<td>${run.durationSeconds}s</td>`,
      `<td>${run.rounds.closed}/${run.rounds.opened}</td>`,
      `<td>P0 ${run.findings.P0} \xB7 P1 ${run.findings.P1} \xB7 P2 ${run.findings.P2} \xB7 P3 ${run.findings.P3}</td>`,
      `<td>${written(run.gate)}</td>`,
      `<td>${written(run.record)}</td>`,
      `<td>${run.result === void 0 ? "\u2014" : cell(run.result, 64)}</td>`,
      stateCell(run),
      "</tr>"
    ].join("")
  );
  return [
    "<table>",
    `<tr>${RUNS_HEADER.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr>`,
    rows.length === 0 ? `<tr><td colspan="${RUNS_HEADER.length}">no runs in this store</td></tr>` : rows.join(""),
    "</table>"
  ].join("");
}
function timelineTable(run) {
  const rows = run.timeline.map(
    (entry) => [
      "<tr>",
      `<td>${entry.seq}</td>`,
      `<td>${cell(entry.at, 32)}</td>`,
      `<td>${cell(entry.kind, 64)}</td>`,
      `<td>${cell(entry.writer, 16)}-written</td>`,
      `<td>${cell(entry.detail, 400)}</td>`,
      "</tr>"
    ].join("")
  );
  return [
    "<h3>timeline</h3><table><tr><th>seq</th><th>at</th><th>kind</th><th>writer</th><th>detail</th></tr>",
    rows.length === 0 ? '<tr><td colspan="5">no readable events</td></tr>' : rows.join(""),
    "</table>"
  ].join("");
}
function roundsTable(run) {
  if (run.roundDetail.length === 0) return "";
  const rows = run.roundDetail.map(
    (round) => [
      "<tr>",
      `<td>${cell(round.round, 32)}</td>`,
      `<td>${cell(round.candidateTreeSha, 128) || "(none)"}</td>`,
      `<td>${cell(round.lenses)}</td>`,
      `<td>${cell(round.outcome, 64)}</td>`,
      `<td>${cell(round.findings)}</td>`,
      `<td>${cell(round.cost, 64)}</td>`,
      "</tr>"
    ].join("")
  );
  return [
    "<h3>rounds</h3><table><tr><th>round</th><th>candidate</th><th>lenses</th><th>outcome</th><th>findings</th><th>cost</th></tr>",
    rows.join(""),
    "</table>"
  ].join("");
}
function notesTable(run) {
  if (run.notes.length === 0) return "";
  const rows = run.notes.map(
    (note) => `<tr><td>${cell(note.at, 32)}</td><td>${cell(note.kind, 128)}</td><td>${cell(note.code, 64)}</td><td>${cell(note.pattern, 64)}</td></tr>`
  );
  return [
    "<h3>refused appends</h3><table><tr><th>at</th><th>kind</th><th>code</th><th>pattern</th></tr>",
    rows.join(""),
    "</table>"
  ].join("");
}
function readoutBlock(run) {
  const list = (entries) => entries.length === 0 ? "(none)" : cell(entries.join(", "), 800);
  return [
    "<h3>completeness</h3>",
    `<p class="labels">${cell(run.readout.status, 64)} \u2014 ${escapeHtml(READOUT_LABELS)}</p>`,
    `<p class="meta">present: ${list(run.readout.present)}</p>`,
    `<p class="meta">missing: ${list(run.readout.missing)}</p>`,
    run.readout.violations.length === 0 ? "" : `<p class="meta">violations: ${list(run.readout.violations)}</p>`,
    run.readout.note === void 0 ? "" : `<p class="meta">note: ${cell(run.readout.note, 500)}</p>`
  ].join("");
}
function renderPage(state) {
  const anyLive = state.runs.some((run) => run.live);
  return [
    '<!doctype html><html lang="en"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    anyLive ? `<meta http-equiv="refresh" content="${state.pollSeconds}">` : "",
    "<title>delivery runs</title>",
    `<style>${STYLE}</style></head><body>`,
    "<h1>delivery runs</h1>",
    `<p class="labels">${escapeHtml(READOUT_LABELS)}. Nothing here is read by admission, the gate, or the recorder.</p>`,
    ...state.repositories.map(
      (repository) => `<p class="meta">${cell(repository.root, 400)} \u2014 ${cell(repository.runsDir, 400)}</p>`
    ),
    anyLive ? `<p class="meta">refreshing every ${state.pollSeconds}s while a run is live</p>` : '<p class="meta">no live run; this page does not refresh itself</p>',
    runsTable(state),
    ...state.runs.map(
      (run) => [
        `<h2>${cell(run.runId, 128)}</h2>`,
        `<p class="meta">${cell(run.repository, 400)}</p>`,
        timelineTable(run),
        roundsTable(run),
        notesTable(run),
        readoutBlock(run)
      ].join("")
    ),
    "</body></html>"
  ].join("");
}
var SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": RUN_SERVER_CSP,
  "Referrer-Policy": "no-referrer",
  // A viewer of a live store must never be shown a cached run, and no proxy
  // between loopback and loopback has any business holding one.
  "Cache-Control": "no-store"
};
function send(response, status, contentType, body) {
  response.writeHead(status, { ...SECURITY_HEADERS, "Content-Type": contentType });
  response.end(body);
}
function hostIsBound(header, host, port) {
  return header === `${host}:${port}`;
}
async function startRunServer(input) {
  if (input.repos.length === 0) return { ok: false, reason: "no repository path to serve" };
  const pollSeconds = input.pollSeconds ?? DEFAULT_POLL_SECONDS;
  const resolved = [];
  for (const repoPath of input.repos) {
    const outcome = await resolveRepo(repoPath);
    if ("reason" in outcome) return { ok: false, reason: outcome.reason };
    resolved.push(outcome);
  }
  const groups = groupByStore(resolved);
  let bound;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (bound === void 0 || !hostIsBound(request.headers.host, bound.host, bound.port)) {
          send(response, 403, "text/plain; charset=utf-8", "forbidden host\n");
          return;
        }
        if (request.method !== "GET" && request.method !== "HEAD") {
          send(response, 405, "text/plain; charset=utf-8", "method not allowed\n");
          return;
        }
        const route = (request.url ?? "/").split("?")[0];
        if (route === "/") {
          send(response, 200, "text/html; charset=utf-8", renderPage(await readState(groups, pollSeconds)));
          return;
        }
        if (route === "/api/runs") {
          send(response, 200, "application/json; charset=utf-8", `${JSON.stringify(await readState(groups, pollSeconds), null, 2)}
`);
          return;
        }
        send(response, 404, "text/plain; charset=utf-8", "not found\n");
      } catch {
        if (!response.headersSent) send(response, 500, "text/plain; charset=utf-8", "the run store could not be read\n");
        response.end();
      }
    })();
  });
  const listening = await new Promise((resolve) => {
    server.once("error", (error) => resolve(error.message));
    server.listen(input.port ?? 0, RUN_SERVER_HOST, () => resolve(void 0));
  });
  if (listening !== void 0) return { ok: false, reason: oneLine(listening, 200) };
  const address = server.address();
  if (address === null || typeof address === "string") {
    await new Promise((resolve) => server.close(() => resolve()));
    return { ok: false, reason: "the server bound no inspectable address" };
  }
  bound = { host: address.address, port: address.port };
  return {
    ok: true,
    server: {
      host: bound.host,
      port: bound.port,
      url: `http://${bound.host}:${bound.port}`,
      close: () => new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      })
    }
  };
}

// packages/cli/src/commands/runs.ts
var USAGE3 = [
  "Usage: delivery-harness runs list",
  "       delivery-harness runs show <run-id> [--json]",
  "       delivery-harness runs serve [--repo <path>]... [--port <n>]"
].join("\n");
var unresolvable = (reason) => ({
  kind: "blocked",
  blockers: [
    runSurfaceBlocker({
      code: "run_store_unresolvable",
      summary: "The run store could not be resolved.",
      details: oneLine(reason, 200),
      remediation: {
        id: "run-inside-a-repository",
        summary: "Run this command inside a git repository; the run store lives under its common directory."
      }
    })
  ]
});
var runsCommand = {
  name: "runs",
  sourceId: "delivery-harness.cli.runs",
  summary: "List, show, and serve the delivery runs this repository has recorded.",
  configFree: true,
  async run(context) {
    const [subcommand, ...rest] = context.args;
    if (subcommand === void 0) return { kind: "usage", message: `runs needs a subcommand.
${USAGE3}` };
    if (subcommand !== "list" && subcommand !== "show" && subcommand !== "serve") {
      return { kind: "usage", message: `Unknown runs subcommand ${oneLine(subcommand, 64)}.
${USAGE3}` };
    }
    if (subcommand === "show" && rest[0] === void 0) {
      return { kind: "usage", message: `runs show needs a run id.
${USAGE3}` };
    }
    if (subcommand === "show" && (rest.length > 2 || rest[1] !== void 0 && rest[1] !== "--json")) {
      return { kind: "usage", message: `runs show accepts only a run id and optional --json.
${USAGE3}` };
    }
    if (subcommand === "serve") return serveRuns(context, rest);
    const resolved = await resolveRunSurface(context.rootDir);
    if (!resolved.ok) return unresolvable(resolved.reason);
    return subcommand === "list" ? listRuns(resolved.surface, context) : showRun(resolved.surface, context, rest[0], rest[1] === "--json");
  }
};
async function sizeOf(runsDir, runId) {
  try {
    return (await stat(path10.join(runsDir, `${runId}.jsonl`))).size;
  } catch {
    return 0;
  }
}
async function listRuns(surface, context) {
  const runIds = await surface.store.list();
  const current = await surface.store.current(surface.worktreeKey);
  const currentRunId = current.ok ? current.runId : void 0;
  const lines = [`runs in ${oneLine(surface.runsDir, 400)}`, `  (${READOUT_LABELS})`];
  let total = 0;
  for (const runId of runIds) {
    const size = await sizeOf(surface.runsDir, runId);
    total += size;
    const read = await surface.store.read(runId);
    if (!read.ok) {
      lines.push(`  ${runId}  unreadable  ${size} bytes`);
      continue;
    }
    const evaluation = evaluateRunJournal4(read.events);
    const open = !read.events.some((event) => event.kind === "run.ended");
    lines.push(
      `  ${runId}  ${evaluation.status}  ${open ? "open" : "ended"}${runId === currentRunId ? " current" : ""}  ${size} bytes`
    );
  }
  lines.push(`total ${total} bytes across ${runIds.length} run(s)`);
  for (const line of lines) context.write(line);
  return { kind: "ok" };
}
async function showRun(surface, context, runId, json) {
  const read = await surface.store.read(runId);
  if (!read.ok) {
    return {
      kind: "blocked",
      blockers: [
        runSurfaceBlocker({
          code: "run_unresolvable",
          summary: "That run has no readable journal in this store.",
          details: `run ${oneLine(runId, 128)}: ${oneLine(read.rejections[0]?.message ?? "unreadable", 200)}`,
          remediation: { id: "list-the-runs", summary: "Run `delivery-harness runs list` to see the runs this repository holds." }
        })
      ]
    };
  }
  const events = read.events;
  if (json) {
    const worktreeRoot2 = await resolveWorktreeRoot(context.rootDir);
    const rootDir2 = worktreeRoot2.ok ? worktreeRoot2.root : context.rootDir;
    context.write(JSON.stringify(buildRunExport({
      runId,
      events,
      rootDir: rootDir2,
      refusedAppends: await surface.store.readNotes(runId)
    }), null, 2));
    return { kind: "ok" };
  }
  const open = !events.some((event) => event.kind === "run.ended");
  const current = await surface.store.current(surface.worktreeKey);
  const isCurrent = current.ok && current.runId === runId;
  context.write(`run ${runId}  ${open ? "open" : "ended"}${isCurrent ? "  current in this worktree" : ""}`);
  context.write("  events:");
  for (const event of events) {
    context.write(`    ${event.seq}  ${event.at}  ${event.kind.padEnd(20)}  ${event.actor.role.padEnd(8)}  ${detailOf(event)}`);
  }
  const rounds = roundRows(events);
  if (rounds.length > 0) {
    context.write("  rounds:");
    for (const row of rounds) context.write(`  ${row}`);
  }
  const decisions = events.filter((event) => event.kind === "decision.recorded");
  if (decisions.length > 0) {
    context.write("  decisions:");
    for (const decision of decisions) context.write(`    ${detailOf(decision)}`);
  }
  const notes = await surface.store.readNotes(runId);
  if (notes.length > 0) {
    context.write("  refused appends:");
    for (const entry of notes) {
      const note = typeof entry === "object" && entry !== null ? entry : {};
      context.write(
        `    ${oneLineOf(note["at"], 32)}  ${oneLineOf(note["kind"], 128)}  ${oneLineOf(note["code"], 64)}${note["pattern"] === void 0 ? "" : `  ${oneLineOf(note["pattern"], 64)}`}`
      );
    }
  }
  const worktreeRoot = await resolveWorktreeRoot(context.rootDir);
  const rootDir = worktreeRoot.ok ? worktreeRoot.root : context.rootDir;
  for (const row of readoutRows(events, evaluateRunJournal4(events), rootDir)) context.write(row);
  return { kind: "ok" };
}
var BROWSER_ELIDED_PORTS = [80, 443];
function parseServeArgs(args, rootDir) {
  const repos = [];
  let port;
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--repo" || token === "--port") {
      const value = args[index + 1];
      if (value === void 0) return { ok: false, message: `${token} needs a value.
${USAGE3}` };
      index += 1;
      if (token === "--repo") {
        repos.push(path10.resolve(rootDir, value));
        continue;
      }
      if (!/^\d{1,5}$/.test(value)) return { ok: false, message: `--port needs a port number.
${USAGE3}` };
      const parsed = Number(value);
      if (parsed > 65535) return { ok: false, message: `--port needs a port number.
${USAGE3}` };
      if (BROWSER_ELIDED_PORTS.includes(parsed)) {
        return {
          ok: false,
          message: `--port ${parsed} cannot be served: a browser omits a scheme's default port from the Host header, and this page answers only to the exact host:port it bound.
${USAGE3}`
        };
      }
      port = parsed;
      continue;
    }
    if (token.startsWith("--")) return { ok: false, message: `Unknown flag ${oneLine(token, 64)}.
${USAGE3}` };
    return { ok: false, message: `runs serve takes no positional arguments.
${USAGE3}` };
  }
  return { ok: true, args: { repos: repos.length === 0 ? [rootDir] : repos, ...port === void 0 ? {} : { port } } };
}
async function serveRuns(context, args) {
  const parsed = parseServeArgs(args, context.rootDir);
  if (!parsed.ok) return { kind: "usage", message: parsed.message };
  const started = await startRunServer({ repos: parsed.args.repos, ...parsed.args.port === void 0 ? {} : { port: parsed.args.port } });
  if (!started.ok) return unresolvable(started.reason);
  const server = started.server;
  context.write(`serving ${parsed.args.repos.length} repository path(s) at ${server.url}`);
  context.write(`  (${READOUT_LABELS})`);
  try {
    await untilSignalled(context.signal);
  } finally {
    await server.close();
  }
  return { kind: "ok" };
}
function untilSignalled(signal) {
  if (signal === void 0) return new Promise(() => {
  });
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

// packages/cli/src/commands/submit-evidence.ts
import { submitManifest as submitManifest3 } from "./kernel.mjs";
function manifestPathFrom(args) {
  const flagIndex = args.indexOf("--manifest");
  if (flagIndex !== -1) return args[flagIndex + 1];
  const positional = args.find((argument) => !argument.startsWith("-"));
  return positional;
}
var submitEvidenceCommand = {
  name: "submit-evidence",
  sourceId: "delivery-harness.cli.submit-evidence",
  summary: "Validate a provider manifest and publish its evidence records.",
  async run(context) {
    const manifestPath = manifestPathFrom(context.args);
    if (manifestPath === void 0 || manifestPath === "") {
      return { kind: "usage", message: "submit-evidence requires --manifest <path>." };
    }
    const wiring = await context.wire();
    const outcome = await submitManifest3(
      { rootDir: context.rootDir, manifestPath, config: context.config },
      { captureCandidate: wiring.captureCandidate, artifacts: context.artifacts, ...wiring.storageOptions }
    );
    if (outcome.status === "accepted") {
      const lines = outcome.records.map(
        (record) => `  ${record.obligationId}: ${record.status} ${record.recordId}`
      );
      return {
        kind: "ok",
        summary: [`accepted (manifestDigest ${outcome.manifestDigest}):`, ...lines].join("\n")
      };
    }
    return { kind: "blocked", blockers: [...outcome.blockers] };
  }
};

// packages/cli/src/commands/verify.ts
import { readFile as readFile5 } from "node:fs/promises";
import path11 from "node:path";
import {
  MAX_RUN_PROVIDER_ID,
  RUN_PROVIDER_ID,
  deliveryRecordPathFor as deliveryRecordPathFor2,
  needsCommittedSymlinkTarget,
  parseCandidateTreeListing,
  parseDeliveryRecord,
  runGitCommand,
  verifyDeliveryRecord as verifyDeliveryRecord2,
  capturePortableVerificationInputs as capturePortableVerificationInputs2,
  collectLiveProviderResults
} from "./kernel.mjs";
var USAGE4 = "Usage: delivery-harness verify [--require-run-journal] [--mandated-lens <id>]...";
function parseArgs2(args) {
  let requireRunJournal = false;
  const mandatedLensIds = [];
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--require-run-journal") {
      requireRunJournal = true;
      continue;
    }
    if (token === "--mandated-lens") {
      const value = args[index + 1];
      if (value === void 0) return { ok: false, message: `${token} needs a value.
${USAGE4}` };
      if (value.length > MAX_RUN_PROVIDER_ID || !RUN_PROVIDER_ID.test(value)) {
        return { ok: false, message: `${token} takes a bounded lens id, not ${oneLine(value, 64)}.
${USAGE4}` };
      }
      mandatedLensIds.push(value);
      index += 1;
      continue;
    }
    if (token.startsWith("-")) return { ok: false, message: `Unknown flag ${oneLine(token, 64)}.
${USAGE4}` };
    return { ok: false, message: `verify takes no positional arguments, and ${oneLine(token, 64)} is one.
${USAGE4}` };
  }
  return { ok: true, args: { requireRunJournal, mandatedLensIds } };
}
function runJournalBlocker(row) {
  const missing = row.missing.length === 0 ? "(none)" : row.missing.join(", ");
  const violations = row.violations === void 0 || row.violations.length === 0 ? "(none)" : row.violations.join(", ");
  return commandBlocker({
    code: "run_journal_incomplete",
    sourceId: "delivery-harness.cli.verify",
    summary: "The run journal for this candidate is not complete, and --require-run-journal was given.",
    details: `status ${row.status}${row.runId === void 0 ? "" : ` (run ${oneLine(row.runId, 128)})`}; missing: ${missing}; violations: ${violations}`,
    remediations: [
      {
        id: "emit-the-missing-run-events",
        kind: "manual_action",
        summary: "Emit the run events this delivery did not journal, or drop --require-run-journal: the row is observability, not evidence."
      }
    ]
  });
}
var verifyCommand = {
  name: "verify",
  sourceId: "delivery-harness.cli.verify",
  summary: "Verify the tracked delivery record against the current candidate.",
  async run(context) {
    const parsedArgs = parseArgs2(context.args);
    if (!parsedArgs.ok) return { kind: "usage", message: parsedArgs.message };
    const wiring = await context.wire();
    const capture = await wiring.captureCandidate();
    if (!capture.ok) {
      return { kind: "blocked", blockers: [...capture.blockers] };
    }
    const identity = {
      deliverableDigest: capture.candidate.deliverable.digest,
      identityToken: capture.candidate.deliverable.identity
    };
    const base = {
      ref: capture.candidate.base.ref,
      tipSha: capture.candidate.base.tipSha,
      mergeBaseSha: capture.candidate.base.mergeBaseSha
    };
    const relativePath = deliveryRecordPathFor2(context.config, identity.deliverableDigest);
    const absolutePath = path11.join(context.rootDir, relativePath);
    let text;
    try {
      text = await readFile5(absolutePath, "utf8");
    } catch {
      return {
        kind: "blocked",
        blockers: [
          commandBlocker({
            code: "delivery_record_missing",
            sourceId: "delivery-harness.cli.verify",
            summary: "No delivery record describes the current candidate.",
            details: `expected ${relativePath}`,
            remediations: [
              {
                id: "run-record",
                kind: "command",
                command: ["delivery-harness", "record"],
                summary: "Record the admitted gate for this candidate."
              }
            ]
          })
        ]
      };
    }
    const parsed = parseDeliveryRecord(text);
    if (!parsed.ok) {
      return { kind: "blocked", blockers: [...parsed.blockers] };
    }
    const listing = await runGitCommand(["git", "ls-tree", "-r", "-z", "--full-tree", "HEAD"], {
      cwd: context.rootDir
    });
    const candidateTreePaths = [];
    if (listing.exitCode === 0) {
      for (const entry of parseCandidateTreeListing(listing.stdout)) {
        if (!needsCommittedSymlinkTarget(entry)) {
          candidateTreePaths.push(entry);
          continue;
        }
        const blob = await runGitCommand(["git", "cat-file", "blob", entry.objectSha], { cwd: context.rootDir });
        candidateTreePaths.push(blob.exitCode === 0 ? { ...entry, symlinkTarget: blob.stdout } : entry);
      }
    }
    const runJournal = await resolveRunJournalRow({
      cwd: context.rootDir,
      treeSha: parsed.record.candidateBinding.treeSha,
      ...parsedArgs.args.mandatedLensIds.length === 0 ? {} : { mandatedLensIds: parsedArgs.args.mandatedLensIds }
    });
    const inputs = await capturePortableVerificationInputs2(context.rootDir, context.config, capture.candidate, parsed.record);
    const live = await collectLiveProviderResults({
      rootDir: context.rootDir,
      config: context.config,
      candidate: capture.candidate,
      projection: inputs.projection,
      evidenceContext: inputs.evidenceContext,
      env: context.env,
      ...context.signal === void 0 ? {} : { signal: context.signal }
    });
    const check = verifyDeliveryRecord2(context.config, parsed.record, identity, base, { candidateTreePaths, runJournal, ...inputs, liveResults: live.liveResults, executionContext: context.classifyContext() });
    if (!check.ok) {
      return { kind: "blocked", blockers: [...live.blockers, ...check.blockers] };
    }
    if (parsedArgs.args.requireRunJournal && runJournal.status !== "complete") {
      return { kind: "blocked", blockers: [runJournalBlocker(runJournal)] };
    }
    const relaxation = check.baseMovementRelaxed ? ` (base movement relaxed by policy: ${check.relaxedDriftClasses.join(", ")})` : "";
    return {
      kind: "ok",
      summary: [
        `verified ${relativePath}${relaxation}; attestation: ${check.attestationLabel}`,
        ...runJournalRows(runJournal)
      ].join("\n")
    };
  }
};

// packages/cli/src/ordinary-context.ts
import { readFile as readFile6 } from "node:fs/promises";
import path12 from "node:path";
import { HARNESS_VERSION, digestCanonical as digestCanonical3 } from "./kernel.mjs";
function recoveryBlocker(code, summary) {
  return commandBlocker({
    code,
    sourceId: "delivery-harness.cli.resume",
    summary,
    remediations: [{ id: "reconcile-delivery-context", kind: "manual_action", summary: "Inspect the saved context and actual workspace/external state with host tools; rerun preparation and gates where evidence is not current. Never replay an uncertain action automatically." }]
  });
}
async function recoveryRun(rootDir, named) {
  const resolved = await resolveRunSurface(rootDir);
  if (!resolved.ok) return { ok: false, blocker: recoveryBlocker("resume_context_invalid", "The repository run store cannot be read.") };
  const current = await resolved.surface.store.current(resolved.surface.worktreeKey);
  const runId = named ?? (current.ok ? current.runId : void 0);
  if (!runId) return { ok: false, blocker: recoveryBlocker("resume_context_missing", "No current delivery run was found; start a run or name its existing id with --run.") };
  const read = await resolved.surface.store.read(runId);
  if (!read.ok) return { ok: false, blocker: recoveryBlocker("resume_context_invalid", "The delivery journal is missing, corrupt, or inaccessible.") };
  return { ok: true, surface: resolved.surface, runId, events: read.events };
}
async function installedRelease(rootDir) {
  const document = JSON.parse(await readFile6(path12.join(rootDir, ".agent-skills/active.json"), "utf8"));
  const release = document?.release;
  if (!release || typeof release.releaseId !== "string" || typeof release.profile !== "string" || typeof release.archiveSha256 !== "string" || !/^[0-9a-f]{64}$/.test(release.archiveSha256)) {
    throw new Error("Installed workflow release identity is missing or malformed.");
  }
  return { runtimeVersion: HARNESS_VERSION, releaseId: release.releaseId, profile: release.profile, archiveSha256: release.archiveSha256 };
}
var policyDigest = (context) => digestCanonical3({ config: context.config, policyBinding: context.policyBinding ?? null });
function reconciliationActions(events) {
  const actions = /* @__PURE__ */ new Map();
  for (const event of events) {
    const p = event.payload;
    if (event.kind === "action.intent") {
      const actionId = p["actionId"];
      const prior = actions.get(actionId);
      actions.set(actionId, { actionId, operation: p["operation"], reference: p["reference"], outcome: "unknown", ...prior ? { inconsistent: true } : {} });
    } else if (event.kind === "action.observed") {
      const actionId = p["actionId"];
      const prior = actions.get(actionId);
      actions.set(actionId, {
        ...prior,
        actionId,
        reference: p["reference"],
        outcome: p["outcome"],
        ...!prior || prior.inconsistent || prior.outcome !== "unknown" && prior.outcome !== p["outcome"] ? { inconsistent: true } : {}
      });
    }
  }
  return [...actions.values()];
}

// packages/cli/src/commands/save-context.ts
var saveContextCommand = {
  name: "save-context",
  sourceId: "delivery-harness.cli.save-context",
  summary: "Save a bounded delivery contract and stage observation in the current run.",
  async run(context) {
    if (context.args.length !== 2 || context.args[0] !== "--json") return { kind: "usage", message: `Usage: delivery-harness save-context --json '{"contract":{"objective":"...","acceptanceCriteria":["..."],"finishLine":"merge-ready"},"stage":"work"}'` };
    let input;
    try {
      const value = JSON.parse(context.args[1]);
      if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key) => key !== "contract" && key !== "stage")) throw new Error();
      input = value;
    } catch {
      return { kind: "usage", message: "Context must be a JSON object with only contract and stage." };
    }
    const run = await recoveryRun(context.rootDir);
    if (!run.ok) return { kind: "blocked", blockers: [run.blocker] };
    const wiring = await context.wire();
    const capture = await wiring.captureCandidate();
    if (!capture.ok) return { kind: "blocked", blockers: capture.blockers };
    let release;
    try {
      release = await installedRelease(context.rootDir);
    } catch {
      return { kind: "blocked", blockers: [recoveryBlocker("resume_release_unreadable", "The installed workflow release identity cannot be read; restore a valid installation before saving context.")] };
    }
    const candidate = capture.candidate;
    const payload = {
      spec: "ordinary-run-context/1",
      contract: input.contract,
      stage: input.stage,
      candidateTreeSha: candidate.treeSha,
      candidateBinding: {
        deliverableDigest: candidate.deliverable.digest,
        identity: candidate.deliverable.identity,
        baseRef: candidate.base.ref,
        baseTipSha: candidate.base.tipSha,
        mergeBaseSha: candidate.base.mergeBaseSha,
        workspaceId: candidate.workspaceId
      },
      policyDigest: policyDigest(context),
      release
    };
    const appended = await run.surface.store.append(run.runId, buildRunEvent({ runId: run.runId, commonDir: run.surface.commonDir, kind: "context.saved", role: "executor", payload }));
    if (!appended.ok) return { kind: "blocked", blockers: [recoveryBlocker("resume_context_invalid", "Context was refused by the bounded run-event contract; inspect contract, stage, and secret-free inputs.")] };
    return { kind: "ok", summary: `saved ordinary context for ${run.runId}; stage is an observation, not evidence` };
  }
};

// packages/cli/src/commands/resume.ts
import { classifyCandidateDrift as classifyCandidateDrift3, digestCanonical as digestCanonical4, evaluatePreparationReceipt as evaluatePreparationReceipt4, runAdmission as runAdmission2 } from "./kernel.mjs";
var resumeCommand = {
  name: "resume",
  sourceId: "delivery-harness.cli.resume",
  summary: "Read saved ordinary context and recheck evidence without executing or replaying work.",
  async run(context) {
    if (context.args.length !== 0 && (context.args.length !== 2 || context.args[0] !== "--run")) return { kind: "usage", message: "Usage: delivery-harness resume [--run <run-id>]" };
    const run = await recoveryRun(context.rootDir, context.args[1]);
    if (!run.ok) return { kind: "blocked", blockers: [run.blocker] };
    const saved = [...run.events].reverse().find((event) => event.kind === "context.saved");
    if (!saved) return { kind: "blocked", blockers: [recoveryBlocker("resume_context_missing", "This run has no saved ordinary context. Recover the contract from its work item and save it explicitly.")] };
    const p = saved.payload;
    const actions = reconciliationActions(run.events);
    const blockers = actions.some((action) => action.outcome === "unknown" || action.inconsistent) ? [recoveryBlocker("resume_action_unreconciled", "An external action has no consistent observed outcome. Reconcile its reference with host tools before any repeat.")] : [];
    const wiring = await context.wire();
    const capture = await wiring.captureCandidate();
    const drift = [];
    if (p["policyDigest"] !== policyDigest(context)) drift.push("policy_changed");
    try {
      if (digestCanonical4(p["release"]) !== digestCanonical4(await installedRelease(context.rootDir))) drift.push("release_changed");
    } catch {
      drift.push("release_unreadable");
    }
    if (capture.ok) {
      const binding = p["candidateBinding"];
      const expected = {
        treeSha: saved.candidateTreeSha,
        deliverable: { digest: binding["deliverableDigest"], identity: binding["identity"] },
        base: { ref: binding["baseRef"], tipSha: binding["baseTipSha"], mergeBaseSha: binding["mergeBaseSha"] },
        workspaceId: binding["workspaceId"]
      };
      drift.push(...classifyCandidateDrift3(expected, capture.candidate));
      if (expected.deliverable.identity !== capture.candidate.deliverable.identity) drift.push("identity_changed");
      if (expected.base.ref !== capture.candidate.base.ref) drift.push("base_ref_changed");
    } else blockers.push(...capture.blockers);
    const preparation = capture.ok ? await evaluatePreparationReceipt4(context.rootDir, { config: context.config, candidate: capture.candidate }, wiring.storageOptions) : void 0;
    const admission = capture.ok ? await runAdmission2(
      { rootDir: context.rootDir, config: context.config, context: context.classifyContext() },
      { captureCandidate: wiring.captureCandidate, projectActivation: wiring.projectActivation, ...wiring.storageOptions }
    ) : void 0;
    if (capture.ok && admission?.candidate && classifyCandidateDrift3(capture.candidate, admission.candidate).length > 0) drift.push("candidate_observation_changed");
    try {
      if (digestCanonical4(p["release"]) !== digestCanonical4(await installedRelease(context.rootDir)) && !drift.includes("release_changed")) drift.push("release_changed");
    } catch {
      if (!drift.includes("release_unreadable")) drift.push("release_unreadable");
    }
    if (admission) blockers.push(...admission.blockers);
    if (drift.some((item) => item !== "raw_tree_changed")) blockers.push(recoveryBlocker("resume_context_stale", "Saved candidate, policy, or release bindings changed; revalidate the contract and affected work before saving fresh context."));
    const reuseAllowed = blockers.length === 0 && admission?.admitted === true;
    context.write(JSON.stringify({
      spec: "ordinary-resume/1",
      runId: run.runId,
      observationOnly: true,
      automaticReplay: false,
      savedContext: p,
      actions,
      drift,
      preparation: preparation ?? { prepared: false },
      admission: admission ?? { admitted: false },
      reuseAllowed
    }));
    return blockers.length > 0 ? { kind: "blocked", blockers } : { kind: "ok" };
  }
};

// packages/cli/src/index.ts
var COMMANDS = [
  prepareCommand,
  reviewContextCommand,
  emitReviewEvidenceCommand,
  submitEvidenceCommand,
  gateCommand,
  recordCommand,
  verifyCommand,
  checkCommand,
  managedCommand,
  maintainCommand,
  emitCommand,
  runsCommand,
  saveContextCommand,
  resumeCommand
];
function runCli(argv, runtime) {
  return runCliBoundary(argv, COMMANDS, runtime);
}

// packages/cli/src/main.ts
function createWaiverPrompt(input, output) {
  return (decision, obligationIds) => new Promise((resolve, reject) => {
    const rl = createInterface({ input, output });
    let settled = false;
    const settle = (action) => {
      if (settled) return;
      settled = true;
      action();
    };
    rl.on("SIGINT", () => {
      settle(() => {
        rl.close();
        reject(new CliInterruption("Waiver prompt interrupted."));
      });
    });
    rl.on("close", () => {
      settle(() => resolve(false));
    });
    output.write(`Waiving covers ${obligationIds.length} obligation(s): ${obligationIds.join(", ")}.
`);
    output.write(`Candidate: ${decision.candidate.treeSha}. Approval covers only these findings under the current policy; live obligations require new approval each invocation.
`);
    for (const resolution of decision.resolutions) {
      if (resolution.kind === "blocked" && obligationIds.includes(resolution.obligationId)) {
        for (const blocker of resolution.blockers) output.write(`${resolution.obligationId}: [${blocker.code}] ${blocker.summary}
`);
      }
    }
    const finish = (value) => settle(() => {
      rl.close();
      resolve(value);
    });
    rl.question("Waive all of them? [y/N] ", (answer) => {
      if (!/^\s*y(es)?\s*$/i.test(answer)) return finish(false);
      rl.question("Author: ", (author) => {
        if (!author.trim() || author.length > 256) return finish(false);
        rl.question("Reason: ", (reason) => {
          if (!reason.trim() || reason.length > 4096) return finish(false);
          finish({ author: author.trim(), reason: reason.trim() });
        });
      });
    });
  });
}
var readlineWaiverPrompt = (decision, obligationIds) => createWaiverPrompt(process.stdin, process.stderr)(decision, obligationIds);
function canonicalEntryPath(entryPath) {
  try {
    return realpathSync(entryPath);
  } catch {
    return entryPath;
  }
}
function invokedDirectly(argvEntry, moduleHref) {
  if (argvEntry === void 0) return false;
  let modulePath;
  try {
    modulePath = fileURLToPath(moduleHref);
  } catch {
    return false;
  }
  return canonicalEntryPath(argvEntry) === canonicalEntryPath(modulePath);
}
function readStdinText(input) {
  if (input.isTTY === true) return Promise.resolve("");
  return new Promise((resolve) => {
    let text = "";
    input.setEncoding("utf8");
    input.on("data", (chunk) => {
      text += chunk;
    });
    input.once("error", () => resolve(text));
    input.once("end", () => resolve(text));
  });
}
function defaultRuntime() {
  return {
    cwd: process.cwd(),
    env: process.env,
    stdinIsTTY: process.stdin.isTTY === true,
    stdoutIsTTY: process.stdout.isTTY === true,
    stdout: (text) => process.stdout.write(text),
    stderr: (text) => process.stderr.write(text),
    promptForWaiver: readlineWaiverPrompt,
    readStdin: () => readStdinText(process.stdin)
  };
}
async function main(argv) {
  return runCli(argv, defaultRuntime());
}
if (invokedDirectly(process.argv[1], import.meta.url)) {
  process.exitCode = EXIT_POLICY;
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
    process.exitCode = EXIT_POLICY;
  });
}
export {
  createWaiverPrompt,
  defaultRuntime,
  invokedDirectly,
  main,
  readStdinText,
  readlineWaiverPrompt
};
