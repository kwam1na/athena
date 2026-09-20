import { posix } from "node:path";
import * as kernel from "../.agent-skills/current/runtime/kernel.mjs";
import { wireRepo } from "../.agent-skills/current/runtime/cli-api.mjs";
import type {
  HarnessConfig,
  CapturedCandidate,
  CandidateCommandRunner,
} from "../.agent-skills/current/runtime/kernel.mjs";
import {
  captureValidationSnapshot,
  type SourceReader,
} from "./harness-validation-snapshot";
import {
  buildValidationPlan,
  type ValidationChange,
  type ValidationPlanMode,
} from "./harness-validation-plan";
import { collectCanonicalValidationRegistry } from "./harness-repo-validation";

export type SourceReaderFactory = (
  rootDir: string,
  treeSha: string,
  run?: CandidateCommandRunner,
) => Promise<SourceReader>;

/** Product owns candidate and blob integrity; Athena supplies its source-based
 * selection policy. Never substitutes the bounded evidence reader for source. */
export async function captureCanonicalValidationPlan(
  rootDir: string,
  config: HarnessConfig,
  mode: ValidationPlanMode,
  ports: {
    readSource?: SourceReaderFactory;
    run?: CandidateCommandRunner;
  } = {},
) {
  const readSource: SourceReaderFactory =
    ports.readSource ??
    (() => {
      const reader = Reflect.get(kernel, "candidateTreeSourceReader");
      if (typeof reader !== "function")
        throw new Error(
          "Installed product lacks candidateTreeSourceReader; install the qualified scoped release",
        );
      return reader as SourceReaderFactory;
    })();
  const started = performance.now();
  const run = ports.run ?? kernel.runGitCommand;
  const wiring = await wireRepo(rootDir, config);
  const captured = await wiring.captureCandidate();
  if (!captured.ok) throw new kernel.BlockedError(captured.blockers);
  const candidate = captured.candidate;
  const captureFinished = performance.now();
  const cache = new Map<string, string>();
  const snapshot = async (ref: string) => {
    const listing = await run(
      ["git", "ls-tree", "-r", "-z", "--full-tree", ref],
      { cwd: rootDir },
    );
    if (listing.exitCode !== 0)
      throw new Error("Cannot enumerate pinned validation tree");
    const entries = kernel.parseCandidateTreeListing(listing.stdout);
    if (entries.length !== listing.stdout.split("\0").filter(Boolean).length)
      throw new Error("Incomplete pinned tree listing");
    return {
      entries,
      source: await captureValidationSnapshot(
        entries,
        await readSource(rootDir, ref, run),
        cache,
      ),
    };
  };
  // Sequential trees share immutable verified regular blobs; each tree still
  // resolves and validates its own link metadata.
  const base = await snapshot(candidate.base.tipSha);
  const baseFinished = performance.now();
  const current = await snapshot(candidate.treeSha);
  const sourcesFinished = performance.now();
  const before = new Map(base.entries.map((entry) => [entry.path, entry]));
  const after = new Map(current.entries.map((entry) => [entry.path, entry]));
  const changes: ValidationChange[] = [];
  for (const path of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const old = before.get(path),
      next = after.get(path);
    if (old?.objectSha === next?.objectSha && old?.mode === next?.mode)
      continue;
    changes.push({
      path,
      status: !old ? "added" : !next ? "deleted" : "modified",
    });
  }
  const snapshots = {
    base: base.source.files,
    candidate: current.source.files,
    links: { base: base.source.links, candidate: current.source.links },
  };
  const registry = collectCanonicalValidationRegistry(
    current.entries.map((entry) => entry.path),
  );
  const plan = buildValidationPlan(registry, changes, mode, snapshots);
  const planningFinished = performance.now();
  const recaptured = await wiring.captureCandidate();
  if (!recaptured.ok) throw new kernel.BlockedError(recaptured.blockers);
  assertSelectionCandidate(candidate, recaptured.candidate);
  const finished = performance.now();
  // Measured operation time only; never an input to evidence or reuse decisions.
  const timing = {
    initialCaptureMs: captureFinished - started,
    baseSnapshotMs: baseFinished - captureFinished,
    candidateSnapshotMs: sourcesFinished - baseFinished,
    planningMs: planningFinished - sourcesFinished,
    finalCaptureMs: finished - planningFinished,
    totalMs: finished - started,
  };
  return { candidate, plan, registry, snapshots, timing };
}

export function assertSelectionCandidate(
  expected: CapturedCandidate,
  actual: CapturedCandidate,
) {
  if (
    expected.headSha !== actual.headSha ||
    kernel.classifyCandidateDrift(expected, actual).length
  )
    throw new Error(
      "Candidate or base moved during validation selection; capture a fresh plan",
    );
}

/** Small read-only child-process result. Native config never receives uploaded
 * selection authority or the hundreds of megabytes of source text used to plan. */
export function projectCapturedValidationPlan(
  capture: Awaited<ReturnType<typeof captureCanonicalValidationPlan>>,
) {
  const packageScripts: Record<string, Record<string, unknown>> = Object.create(
    null,
  );
  for (const [path, text] of Object.entries(capture.snapshots.candidate)) {
    if (posix.basename(path) !== "package.json") continue;
    let physical = path;
    const links = capture.snapshots.links.candidate;
    const crossed = new Set<string>();
    for (;;) {
      const link = Object.keys(links)
        .sort((a, b) => b.length - a.length)
        .find((name) => physical === name || physical.startsWith(`${name}/`));
      if (!link) break;
      if (crossed.has(link)) throw new Error("Cyclic captured package link");
      crossed.add(link);
      physical = posix.join(links[link], physical.slice(link.length));
    }
    const manifest = JSON.parse(
      physical === path ? text : capture.snapshots.candidate[physical],
    );
    const scripts = manifest.scripts ?? {};
    if (typeof scripts !== "object" || Array.isArray(scripts))
      throw new Error(`Invalid captured package scripts: ${path}`);
    packageScripts[posix.dirname(path)] = scripts;
  }
  return {
    schemaVersion: "athena-native-selection/1" as const,
    candidate: capture.candidate,
    plan: capture.plan,
    inventory: Object.keys(capture.snapshots.candidate),
    packageScripts,
    timing: capture.timing,
  };
}
