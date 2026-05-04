type MergeMethod = "merge" | "squash" | "rebase";

type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CommandRunner = (
  command: string[],
  options?: { input?: string }
) => Promise<CommandResult>;

type PullRequestView = {
  baseRefName: string;
  headRefName: string;
  headRepository: {
    nameWithOwner: string;
  } | null;
  headRepositoryOwner: {
    login: string;
  } | null;
  id: string;
  isDraft: boolean;
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
};

type RepoView = {
  nameWithOwner: string;
};

export type MergeOptions = {
  auto?: boolean;
  deleteBranch: boolean;
  method: MergeMethod;
  prRef: string;
  repo?: string;
};

const DEFAULT_METHOD: MergeMethod = "squash";
const HELP_TEXT = `Usage: bun scripts/github-pr-merge.ts <pr-ref> [--auto] [--method squash|merge|rebase] [--delete-branch] [--repo owner/name]

Merge or arm auto-merge for a GitHub pull request through GitHub APIs without
checking out, pulling, or mutating local main.

Options:
  --auto             Arm GitHub auto-merge instead of merging immediately.
  --method <method>  Merge method: squash, merge, or rebase. Default: squash.
  --delete-branch    Delete the same-repo head branch after an immediate merge.
                     Ignored with --auto because the remote merge happens later.
  --repo <owner/repo> Select a repository instead of resolving the current repo.
  -h, --help         Show this help.
`;

export async function mergePullRequest(
  options: MergeOptions,
  runCommand: CommandRunner = runProcess
) {
  const repo = options.repo ?? (await resolveCurrentRepo(runCommand));
  const pr = await viewPullRequest(options.prRef, repo, runCommand);

  if (pr.state === "MERGED") {
    return `Pull request ${pr.url} is already merged.`;
  }

  if (pr.state !== "OPEN") {
    throw new Error(`Pull request ${pr.url} is ${pr.state}; only OPEN PRs can be merged.`);
  }

  if (pr.isDraft) {
    throw new Error(`Pull request ${pr.url} is still a draft.`);
  }

  if (options.auto) {
    await enablePullRequestAutoMerge(pr, options.method, runCommand);
    return `Armed auto-merge for ${pr.url} with ${options.method}.`;
  }

  await ghJson(
    [
      "gh",
      "api",
      "--method",
      "PUT",
      `/repos/${repo}/pulls/${pr.number}/merge`,
      "--input",
      "-",
    ],
    {
      merge_method: options.method,
    },
    runCommand
  );

  let message = `Merged ${pr.url} into ${pr.baseRefName} with ${options.method}.`;

  if (options.deleteBranch && shouldDeleteHeadBranch(pr, repo)) {
    await deleteHeadBranch(repo, pr.headRefName, runCommand);
    message += ` Deleted ${pr.headRefName}.`;
  }

  return message;
}

export function parseArgs(args: string[]): MergeOptions {
  let auto = false;
  let deleteBranch = false;
  let method: MergeMethod = DEFAULT_METHOD;
  let repo: string | undefined;
  let prRef: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (arg === "-h" || arg === "--help") {
      throw new HelpRequested();
    }

    if (arg === "--auto") {
      auto = true;
      continue;
    }

    if (arg === "--delete-branch") {
      deleteBranch = true;
      continue;
    }

    if (arg === "--repo") {
      repo = requireValue(args, (index += 1), "--repo");
      continue;
    }

    if (arg === "--method") {
      method = parseMergeMethod(requireValue(args, (index += 1), "--method"));
      continue;
    }

    if (arg.startsWith("--method=")) {
      method = parseMergeMethod(arg.slice("--method=".length));
      continue;
    }

    if (arg.startsWith("--repo=")) {
      repo = arg.slice("--repo=".length);
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }

    if (prRef) {
      throw new Error(`Unexpected extra argument: ${arg}`);
    }

    prRef = arg;
  }

  if (!prRef) {
    throw new Error(HELP_TEXT.trim());
  }

  return { ...(auto ? { auto } : {}), deleteBranch, method, prRef, repo };
}

async function resolveCurrentRepo(runCommand: CommandRunner) {
  const repo = await ghJson<RepoView>(
    ["gh", "repo", "view", "--json", "nameWithOwner"],
    undefined,
    runCommand
  );
  return repo.nameWithOwner;
}

async function viewPullRequest(
  prRef: string,
  repo: string,
  runCommand: CommandRunner
) {
  return ghJson<PullRequestView>(
    [
      "gh",
      "pr",
      "view",
      prRef,
      "--repo",
      repo,
      "--json",
      "baseRefName,headRefName,headRepository,headRepositoryOwner,id,isDraft,number,state,url",
    ],
    undefined,
    runCommand
  );
}

async function deleteHeadBranch(
  repo: string,
  headRefName: string,
  runCommand: CommandRunner
) {
  await ghJson(
    [
      "gh",
      "api",
      "--method",
      "DELETE",
      `/repos/${repo}/git/refs/heads/${encodeGitRefPath(headRefName)}`,
    ],
    undefined,
    runCommand
  );
}

async function enablePullRequestAutoMerge(
  pr: PullRequestView,
  method: MergeMethod,
  runCommand: CommandRunner
) {
  const query = `
    mutation EnablePullRequestAutoMerge($pullRequestId: ID!, $mergeMethod: PullRequestMergeMethod!) {
      enablePullRequestAutoMerge(input: {
        pullRequestId: $pullRequestId
        mergeMethod: $mergeMethod
      }) {
        pullRequest {
          url
        }
      }
    }
  `;

  const result = await runCommand([
    "gh",
    "api",
    "graphql",
    "-f",
    `query=${query}`,
    "-f",
    `pullRequestId=${pr.id}`,
    "-f",
    `mergeMethod=${method.toUpperCase()}`,
  ]);

  if (result.exitCode === 0) {
    return;
  }

  throw new Error(
    `Failed to arm auto-merge for ${pr.url} with ${method}\n${result.stderr}`
  );
}

function shouldDeleteHeadBranch(pr: PullRequestView, repo: string) {
  return pr.headRepository?.nameWithOwner === repo && pr.headRefName !== pr.baseRefName;
}

function encodeGitRefPath(refName: string) {
  return refName.split("/").map(encodeURIComponent).join("/");
}

async function ghJson<T = JsonValue>(
  command: string[],
  input: JsonValue | undefined,
  runCommand: CommandRunner
): Promise<T> {
  const result = await runCommand(command, {
    input: input === undefined ? undefined : `${JSON.stringify(input)}\n`,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed with exit code ${result.exitCode}\n${result.stderr}`
    );
  }

  if (!result.stdout.trim()) {
    return undefined as T;
  }

  return JSON.parse(result.stdout) as T;
}

export async function runProcess(
  command: string[],
  options: { input?: string } = {}
): Promise<CommandResult> {
  const process = Bun.spawn(command, {
    stdin: options.input === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (options.input !== undefined) {
    process.stdin.write(options.input);
    process.stdin.end();
  }

  const [exitCode, stdout, stderr] = await Promise.all([
    process.exited,
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
  ]);

  return { exitCode, stdout, stderr };
}

class HelpRequested extends Error {}

function requireValue(args: string[], index: number, flag: string) {
  const value = args[index];
  if (!value) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function parseMergeMethod(value: string): MergeMethod {
  if (value === "merge" || value === "squash" || value === "rebase") {
    return value;
  }
  throw new Error(`Unsupported merge method: ${value}`);
}

if (import.meta.main) {
  try {
    const message = await mergePullRequest(parseArgs(Bun.argv.slice(2)));
    console.log(message);
  } catch (error) {
    if (error instanceof HelpRequested) {
      console.log(HELP_TEXT.trim());
      process.exit(0);
    }
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
