import { realpath } from "node:fs/promises";
import path from "node:path";
import {
  candidateTreeSourceReader,
  parseCandidateTreeListing,
  runGitCommand,
  type CandidateCommandRunner,
  type HarnessConfig,
} from "../.agent-skills/current/runtime/kernel.mjs";
import {
  resolveHostedValidationBinding,
  type JsonRequest,
} from "./harness-validation-ci-binding";
import {
  captureCanonicalValidationPlan,
  projectCapturedValidationPlan,
} from "./harness-validation-capture";
import { validationCheckCommand } from "./harness-validation-command";

const GUARD = "scripts/harness-validation-runtime.ts";

/** Base-owned conservative authority set. Changes require legacy validation;
 * this is not a candidate-supplied list and not an execution-success claim. */
export function isValidationAuthorityPath(file: string) {
  return (
    [
      "scripts/",
      ".github/workflows/",
      ".agents/",
      ".agent-skills/",
      ".claude/",
      ".husky/",
    ].some((prefix) => file.startsWith(prefix)) ||
    file === "harness.config.ts" ||
    /(?:^|\/)(?:AGENTS\.md|package\.json|bun\.lockb?|package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bunfig\.toml)$/.test(
      file,
    )
  );
}

type Selection = ReturnType<typeof projectCapturedValidationPlan>;
export type ValidationTrustPorts = {
  /** Must be the trusted caller's base ATHENA_LEGACY_CONFIG, never candidate config. */
  legacyConfig?: HarnessConfig;
  requestJson?: JsonRequest;
  run?: CandidateCommandRunner;
};

/** Hosted preflight only. The caller must execute this module and its imports
 * from the pinned trusted base, and retain trusted final native verification. */
export async function guardValidationCandidate(
  baseRoot: string,
  candidateRoot: string,
  env: NodeJS.ProcessEnv,
  ports: ValidationTrustPorts = {},
) {
  if (!env.VALIDATION_GUARD_BASE_SHA)
    throw new Error("Authenticated pinned base is required");
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch")
    throw new Error("Scoped qualification remains manual only");
  const binding = await resolveHostedValidationBinding(
    "qualify",
    env,
    ports.requestJson,
  );
  const roots = await Promise.all(
    [baseRoot, candidateRoot].map(async (root) => {
      if (!path.isAbsolute(root))
        throw new Error("Guard roots must be absolute");
      const physical = await realpath(root);
      if (physical !== path.resolve(root))
        throw new Error("Guard root aliases are forbidden");
      return physical;
    }),
  );
  if (
    roots[0] === roots[1] ||
    roots.some((root, i) => root.startsWith(`${roots[1 - i]}${path.sep}`))
  )
    throw new Error("Guard roots must be distinct non-nested checkouts");
  if (!env.GITHUB_WORKSPACE) throw new Error("Hosted workspace required");
  const workspace = await realpath(env.GITHUB_WORKSPACE);
  if (roots.some((root) => path.dirname(root) !== workspace))
    throw new Error("Guard roots must be sibling hosted checkouts");
  const run = ports.run ?? runGitCommand;
  const git = async (root: string, ...args: string[]) => {
    const result = await run(
      ["git", "--no-replace-objects", "-c", "core.fsmonitor=false", ...args],
      { cwd: root },
    );
    if (result.exitCode !== 0)
      throw new Error(`Guard Git inspection failed: ${args[0]}`);
    return result.stdout;
  };
  const inspect = async (root: string, sha: string) => {
    if (
      (await realpath(
        (await git(root, "rev-parse", "--show-toplevel")).trim(),
      )) !== root
    )
      throw new Error("Guard root is not the Git toplevel");
    if (
      (await git(root, "status", "--porcelain=v1", "--untracked-files=all"))
        .length
    )
      throw new Error("Guard checkout is dirty or untracked");
    if ((await git(root, "rev-parse", "HEAD")).trim() !== sha)
      throw new Error(
        "Guard checkout HEAD does not match authenticated identity",
      );
    const tree = (await git(root, "rev-parse", `${sha}^{tree}`)).trim();
    if ((await git(root, "write-tree")).trim() !== tree)
      throw new Error("Guard index differs from commit tree");
    const listing = await git(root, "ls-tree", "-r", "-z", "--full-tree", tree);
    const entries = parseCandidateTreeListing(listing);
    if (
      entries.length !== listing.split("\0").filter(Boolean).length ||
      entries.some(
        (entry) =>
          !/^(?:100644|100755|120000)$/.test(entry.mode) ||
          path.posix.isAbsolute(entry.path) ||
          /[\\\x00-\x1f]/.test(entry.path) ||
          entry.path.split("/").includes(".."),
      )
    )
      throw new Error("Malformed guard tree inventory");
    const reader = await candidateTreeSourceReader(root, tree, run);
    for (const entry of entries)
      if (entry.mode === "120000") await reader.metadata(entry.path);
    return { tree, entries };
  };
  const before = await inspect(roots[0], binding.baseSha);
  const candidate = await inspect(roots[1], binding.headSha);
  const guard = before.entries.find((entry) => entry.path === GUARD);
  if (guard && !/^100(?:644|755)$/.test(guard.mode))
    throw new Error("Base guard is not a regular committed module");
  const byPath = new Map(before.entries.map((entry) => [entry.path, entry]));
  const afterPath = new Map(
    candidate.entries.map((entry) => [entry.path, entry]),
  );
  const changedControllerPaths = [
    ...new Set([...byPath.keys(), ...afterPath.keys()]),
  ]
    .filter((file) => {
      const old = byPath.get(file),
        next = afterPath.get(file);
      return (
        isValidationAuthorityPath(file) &&
        (old?.objectSha !== next?.objectSha || old?.mode !== next?.mode)
      );
    })
    .sort();
  let selection: Selection | null = null;
  const reason = !guard
    ? "historical-guard-absence"
    : changedControllerPaths.length
      ? "changed-authority"
      : "unchanged-authority";
  if (reason === "unchanged-authority") {
    if (!ports.legacyConfig || ports.legacyConfig.scopedExecution)
      throw new Error("Base legacy config must be supplied explicitly");
    const capture = await captureCanonicalValidationPlan(
      roots[1],
      { ...ports.legacyConfig, baseRef: binding.baseSha },
      "comparison",
      { run },
    );
    if (
      capture.candidate.mode !== "clean" ||
      capture.candidate.headSha !== binding.headSha ||
      capture.candidate.treeSha !== candidate.tree ||
      capture.candidate.base.tipSha !== binding.baseSha
    )
      throw new Error(
        "Native candidate differs from authenticated guard identity",
      );
    selection = projectCapturedValidationPlan(capture);
    for (const check of selection.plan.checks)
      validationCheckCommand(check, {
        packageScripts: selection.packageScripts[check.cwd],
      });
  }
  const currentBinding = await resolveHostedValidationBinding(
    "qualify",
    env,
    ports.requestJson,
  );
  if (JSON.stringify(currentBinding) !== JSON.stringify(binding))
    throw new Error("Authenticated binding moved during guard");
  const finalBase = await inspect(roots[0], binding.baseSha);
  const finalCandidate = await inspect(roots[1], binding.headSha);
  if (finalBase.tree !== before.tree || finalCandidate.tree !== candidate.tree)
    throw new Error("Guard tree moved during selection");
  return {
    binding,
    selection,
    readiness: selection ? ("scoped" as const) : ("legacy" as const),
    reason,
    changedControllerPaths,
  };
}

/** Readiness is selection only, never a check-success receipt. Emit it after
 * authentication and tree inspection complete, including an explicit fallback. */
export async function runValidationGuardCli(
  args: readonly string[],
  options: ValidationTrustPorts & {
    baseRoot: string;
    env: NodeJS.ProcessEnv;
    writeOutput: (text: string) => Promise<void>;
  },
) {
  if (
    args.length !== 3 ||
    args[0] !== "guard" ||
    args[1] !== "--candidate-root" ||
    !path.isAbsolute(args[2])
  )
    throw new Error(
      "Usage: harness:validation-ci guard --candidate-root <absolute-path>",
    );
  const result = await guardValidationCandidate(
    options.baseRoot,
    args[2],
    options.env,
    options,
  );
  await options.writeOutput(
    `base_guard_ready=${result.readiness === "scoped"}\n`,
  );
  return result;
}
