/**
 * Installs an agent-skills release into this repository.
 *
 * One command performs the whole install: it builds the named release from the
 * agent-skills checkout, runs the lifecycle update against this repository, and
 * then reads the lifecycle status sensor. The install has only succeeded when
 * that sensor reports `lifecycle: current`, no blockers, and the release that
 * was just built as the active generation, so the check lives here rather than
 * in an operator's eyes.
 */
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/** The documented environment variable naming the agent-skills checkout. */
export const CHECKOUT_ENV_VAR = "AGENT_SKILLS_CHECKOUT";

export type ActiveGeneration = {
  readonly releaseId?: unknown;
  readonly profile?: unknown;
  readonly archiveSha256?: unknown;
};

export type StatusReport = {
  readonly lifecycle?: unknown;
  readonly blockers?: unknown;
  readonly active?: ActiveGeneration;
};

export type BuiltRelease = {
  readonly releaseId: string;
  readonly profile: string;
  readonly archiveSha256: string;
};

export function resolveCheckout(
  env: Readonly<Record<string, string | undefined>>
): string {
  const value = env[CHECKOUT_ENV_VAR]?.trim();

  if (!value) {
    throw new Error(
      `${CHECKOUT_ENV_VAR} is not set. Point it at the agent-skills checkout holding the release to install.`
    );
  }

  if (!path.isAbsolute(value)) {
    throw new Error(
      `${CHECKOUT_ENV_VAR} must be an absolute path to the agent-skills checkout; received "${value}".`
    );
  }

  return value;
}

/**
 * The install's sensor. Anything short of a clean status against the release we
 * just built is a failed install, and every reason is reported at once so a
 * single run names the whole gap.
 */
export function assertInstalled(
  status: StatusReport,
  expected: BuiltRelease
): void {
  const problems: string[] = [];

  if (status.lifecycle !== "current") {
    problems.push(
      `lifecycle is ${JSON.stringify(status.lifecycle)}, expected "current"`
    );
  }

  const blockers = Array.isArray(status.blockers) ? status.blockers : [];
  if (blockers.length > 0) {
    problems.push(`status reports ${blockers.length} blocker(s)`);
  }

  if (status.active?.releaseId !== expected.releaseId) {
    problems.push(
      `active release is ${JSON.stringify(status.active?.releaseId)}, expected ${JSON.stringify(expected.releaseId)}`
    );
  }

  if (status.active?.archiveSha256 !== expected.archiveSha256) {
    problems.push(
      `active archive is ${JSON.stringify(status.active?.archiveSha256)}, expected ${JSON.stringify(expected.archiveSha256)}`
    );
  }

  if (problems.length > 0) {
    throw new Error(
      `agent-skills install did not converge:\n- ${problems.join("\n- ")}`
    );
  }
}

export function parseArgs(argv: readonly string[]): {
  releaseId: string;
  profile: string;
} {
  const positional: string[] = [];
  let profile: string | undefined;

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]!;
    if (token === "--profile") {
      profile = argv[index + 1];
      index += 1;
      continue;
    }
    positional.push(token);
  }

  const releaseId = positional[0];
  if (!releaseId || !profile) {
    throw new Error(
      "Usage: bun run agent-skills:install -- <release-id> --profile <profile>"
    );
  }

  return { releaseId, profile };
}

async function run(
  command: readonly string[],
  cwd: string
): Promise<{ stdout: string }> {
  const proc = Bun.spawn(command, { cwd, stdout: "pipe", stderr: "inherit" });
  const stdout = await new Response(proc.stdout).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`\`${command.join(" ")}\` failed with exit code ${exitCode}.`);
  }

  return { stdout };
}

export async function installRelease(options: {
  repoRoot: string;
  checkout: string;
  releaseId: string;
  profile: string;
}): Promise<BuiltRelease> {
  const { repoRoot, checkout, releaseId, profile } = options;
  const staging = await mkdtemp(path.join(tmpdir(), "agent-skills-install-"));
  const archive = path.join(staging, "release.zip");
  const metadata = path.join(staging, "release.json");

  try {
    await run(
      [
        "python3",
        "-B",
        "scripts/build-release.py",
        "build",
        "--root",
        checkout,
        "--archive",
        archive,
        "--metadata",
        metadata,
        "--release-id",
        releaseId,
        "--profile",
        profile,
      ],
      checkout
    );

    const built: BuiltRelease = {
      releaseId,
      profile,
      archiveSha256: (
        JSON.parse(await readFile(metadata, "utf8")) as {
          archiveSha256: string;
        }
      ).archiveSha256,
    };

    await run(
      [
        "python3",
        "-B",
        "-m",
        "agent_skills.cli",
        "--root",
        repoRoot,
        "update",
        "--archive",
        archive,
        "--metadata",
        metadata,
        // The lifecycle refuses every mutation without it; running this command
        // in this repository is that explicit repository authority.
        "--maintenance",
      ],
      checkout
    );

    const status = await run(
      ["python3", "-B", "-m", "agent_skills.cli", "--root", repoRoot, "status"],
      checkout
    );

    assertInstalled(JSON.parse(status.stdout) as StatusReport, built);
    return built;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    const { releaseId, profile } = parseArgs(Bun.argv.slice(2));
    const built = await installRelease({
      repoRoot: path.resolve(import.meta.dirname, ".."),
      checkout: resolveCheckout(Bun.env),
      releaseId,
      profile,
    });
    console.log(
      `Installed ${built.releaseId} (${built.profile}) at ${built.archiveSha256}.`
    );
  } catch (error: unknown) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
