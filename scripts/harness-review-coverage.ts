import { createHash } from "node:crypto";
import { lstat, readFile, readdir, readlink, realpath } from "node:fs/promises";
import path from "node:path";

// Qualified ordinary-suite supersession only. Timer stress, focused/custom
// commands and different configs remain separate executions. This is transient
// bookkeeping inside one provider invocation, never portable gate evidence.
const COVERAGE_COMMAND = "bun scripts/coverage-toolchain-parity.ts --repair && bun run --filter '@athena/webapp' test:coverage && bun run --filter '@athena/storefront-webapp' test:coverage && bun run test:coverage:scripts && bun scripts/coverage-summary.ts";
const QUALIFIED_CONFIG = "689ad77112acfa25f3042ee33fbefeaa502b40f067fffde58a196800b1e8a556";
const WEBAPP = "packages/athena-webapp";
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

type Git = (args: string[]) => Promise<{ exitCode: number; stdout: string }>;
export type CoverageBinding = { identity: string; environment: string };
export type CoverageCapture = { binding: CoverageBinding; reason?: never } | { reason: string; binding?: never };

// Installed dependency mutation guard. Metadata is private to this process;
// ctime detects edits even when bytes/mtime are restored. Caches are runner
// outputs, not installed dependency inputs. No dependency-content/secret hash
// is persisted. The product remains responsible for final candidate admission.
async function dependencyState(root: string) {
  const entries: string[] = [];
  const visited = new Set<string>();
  const walk = async (location: string): Promise<void> => {
    const stat = await lstat(location, { bigint: true });
    if (stat.isSymbolicLink()) {
      entries.push(`${location}:link:${await readlink(location)}`);
      const target = await realpath(location);
      if (!target.startsWith(`${root}${path.sep}`)) throw new Error("external dependency");
      // Workspace source is bound by the Git tree; scan its node_modules below.
      if (target.includes(`${path.sep}node_modules${path.sep}`)) await walk(target);
    } else if (stat.isDirectory()) {
      if (visited.has(location)) return;
      visited.add(location);
      entries.push(`${location}:directory`);
      for (const name of (await readdir(location)).sort()) {
        if ([".cache", ".vite", ".vite-temp", ".vitest"].includes(name)) continue;
        await walk(path.join(location, name));
      }
    } else if (stat.isFile()) {
      entries.push(`${location}:${stat.dev}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
    } else throw new Error("unsupported dependency entry");
  };
  await walk(path.join(root, "node_modules"));
  const packages = await readdir(path.join(root, "packages"), { withFileTypes: true });
  for (const name of packages.filter(entry => entry.isDirectory()).map(entry => entry.name).sort()) {
    const location = path.join(root, "packages", name, "node_modules");
    try { await lstat(location); } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await walk(location);
  }
  return digest(entries.join("\n"));
}

async function toolchainState() {
  const executables = [process.execPath, Bun.which("bun"), Bun.which("node")];
  return Promise.all(executables.map(async executable => {
    if (!executable) throw new Error("missing toolchain executable");
    const target = await realpath(executable);
    const stat = await lstat(target, { bigint: true });
    return `${target}:${stat.ino}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`;
  }));
}

async function sourceMutationState(root: string, git: Git) {
  const files = await git(["ls-files", "-z"]);
  if (files.exitCode !== 0) throw new Error("unreadable source membership");
  const entries: string[] = [];
  for (const file of files.stdout.split("\0").filter(Boolean).sort()) {
    const stat = await lstat(path.join(root, file), { bigint: true });
    // Git binds bytes and membership, but would miss an edit followed by a
    // restore during execution. Inode/ctime also bind that mutation history.
    entries.push(`${file}:${stat.ino}:${stat.mode}:${stat.size}:${stat.mtimeNs}:${stat.ctimeNs}`);
  }
  return digest(entries.join("\n"));
}

export async function captureCoverageBinding(root: string, baseRef: string | undefined, git: Git): Promise<CoverageCapture> {
  try {
    root = await realpath(root);
    const manifest = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    const app = JSON.parse(await readFile(path.join(root, WEBAPP, "package.json"), "utf8"));
    if (manifest.scripts?.["test:coverage"] !== COVERAGE_COMMAND ||
        app.scripts?.test !== "vitest run --maxWorkers=4" ||
        ["pretest", "posttest"].some(hook => app.scripts?.[hook] !== undefined) ||
        app.scripts?.["test:coverage"] !== "vitest run --coverage --maxWorkers=${ATHENA_COVERAGE_MAX_WORKERS:-2}" ||
        digest(await readFile(path.join(root, WEBAPP, "vitest.config.ts"))) !== QUALIFIED_CONFIG) {
      return { reason: "unqualified-coverage-profile" };
    }
    const [diff, untracked, tree, base] = await Promise.all([
      git(["diff", "--quiet"]), git(["ls-files", "--others", "--exclude-standard"]),
      git(["write-tree"]), git(["rev-parse", "--verify", `${baseRef ?? "origin/main"}^{commit}`]),
    ]);
    if ([diff, untracked, tree, base].some(result => result.exitCode !== 0) || untracked.stdout.trim()) {
      return { reason: "source-not-prepared" };
    }
    // Environment values stay only in memory and are never logged or hashed.
    const environment = Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b));
    const privateInputs: Array<[string, string, string]> = [];
    for (const directory of [root, path.join(root, WEBAPP)]) {
      for (const name of (await readdir(directory)).filter(name => name === ".env" || name.startsWith(".env.")).sort()) {
        const location = path.join(directory, name);
        const stat = await lstat(location, { bigint: true });
        privateInputs.push([location, await readFile(location, "utf8"), `${stat.ino}:${stat.mtimeNs}:${stat.ctimeNs}`]);
      }
    }
    return { binding: {
      identity: [tree.stdout.trim(), base.stdout.trim(), process.execPath, process.version, Bun.version, process.platform, process.arch, await toolchainState(), await dependencyState(root), await sourceMutationState(root, git)].join(":"),
      environment: JSON.stringify([environment, privateInputs]),
    } };
  } catch {
    return { reason: "coverage-inputs-unavailable" };
  }
}

export function compareCoverageBindings(before: CoverageCapture, after: CoverageCapture): string | undefined {
  if (!before.binding) return before.reason;
  if (!after.binding) return after.reason;
  if (before.binding.identity !== after.binding.identity) return "source-base-toolchain-or-dependencies-changed";
  if (before.binding.environment !== after.binding.environment) return "execution-environment-changed";
  return undefined;
}
