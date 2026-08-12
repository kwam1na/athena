import { createHash } from "node:crypto";

/**
 * Review evidence authorizes a *deliverable*, not a raw Git tree.
 *
 * The raw tree SHA is the strictest possible identity, but it also treats
 * delivery narration — the landed-change report and the solution note, both of
 * which are written after the implementation they describe — as if they were
 * reviewed program content. That forced a full re-review for every
 * documentation commit, which is the failure this identity exists to remove.
 *
 * The neutral set is deliberately narrower than
 * `isDeliverableFingerprintPath` in `delivery-diff-fingerprint.ts`. That
 * fingerprint answers "did the deliverable diff change?" for report freshness.
 * This identity answers "is this the tree a reviewer approved?", so generated
 * artifacts (`_generated/`, `routeTree.gen.ts`, `graphify-out/`, `artifacts/`)
 * stay inside the reviewed deliverable: they are executable or gate-consumed
 * content, and nothing here re-derives them to prove they still match their
 * reviewed sources.
 */
export const REVIEW_NEUTRAL_PATH_PREFIXES = [
  "docs/reports/",
  "docs/solutions/",
] as const;

export const HARNESS_REVIEW_IDENTITY_VERSION = "deliverable-tree/v1" as const;

export type HarnessReviewIdentityVersion =
  typeof HARNESS_REVIEW_IDENTITY_VERSION;

export type DeliverableTreeIdentity = {
  identityVersion: HarnessReviewIdentityVersion;
  deliverableTreeSha: string;
};

type SpawnedProcess = {
  exited: Promise<number>;
  stdout?: ReadableStream | null;
  stderr?: ReadableStream | null;
};

export type ReviewIdentityCommandRunner = (
  command: string[],
  options: { cwd: string; stdout: "pipe"; stderr: "pipe" },
) => SpawnedProcess;

export type DeliverableTreeIdentityOptions = {
  spawn?: ReviewIdentityCommandRunner;
};

function normalizeRepoPath(repoPath: string) {
  return repoPath.replaceAll("\\", "/").replace(/^\.\//, "");
}

export function isReviewNeutralPath(repoPath: string) {
  const normalizedPath = normalizeRepoPath(repoPath);
  return REVIEW_NEUTRAL_PATH_PREFIXES.some((prefix) =>
    normalizedPath.startsWith(prefix),
  );
}

export type DeliverableTreeEntry = {
  mode: string;
  objectSha: string;
  path: string;
};

export function parseTreeEntries(output: string): DeliverableTreeEntry[] {
  return output
    .split(/\0|\n/)
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const match = /^(\S+) (\S+) (\S+)\t(.+)$/.exec(record);
      if (!match) {
        throw new Error(`git ls-tree produced an unparsable record: ${record}`);
      }
      return { mode: match[1], objectSha: match[3], path: match[4] };
    });
}

export function digestDeliverableEntries(
  entries: readonly DeliverableTreeEntry[],
): DeliverableTreeIdentity {
  const hash = createHash("sha256");
  hash.update(`identity\0${HARNESS_REVIEW_IDENTITY_VERSION}\0`);
  const deliverableEntries = entries
    .filter((entry) => !isReviewNeutralPath(entry.path))
    .map((entry) => ({ ...entry, path: normalizeRepoPath(entry.path) }))
    .sort((left, right) => left.path.localeCompare(right.path));

  for (const entry of deliverableEntries) {
    hash.update(`${entry.mode}\0${entry.objectSha}\0${entry.path}\0`);
  }

  return {
    identityVersion: HARNESS_REVIEW_IDENTITY_VERSION,
    deliverableTreeSha: hash.digest("hex"),
  };
}

export async function computeDeliverableTreeIdentity(
  rootDir: string,
  treeSha: string,
  options: DeliverableTreeIdentityOptions = {},
): Promise<DeliverableTreeIdentity> {
  const spawn = options.spawn ?? (Bun.spawn as ReviewIdentityCommandRunner);
  const command = ["git", "ls-tree", "-r", "-z", "--full-tree", treeSha];
  const process = spawn(command, {
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || stdout.trim() || `${command.join(" ")} failed`,
    );
  }
  return digestDeliverableEntries(parseTreeEntries(stdout));
}
