import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  type CommandRunner,
  mergePullRequest,
  parseArgs,
  runProcess,
} from "./github-pr-merge";

describe("github-pr-merge", () => {
  it("merges through gh api instead of gh pr merge", async () => {
    const calls: string[][] = [];
    const inputs: Array<string | undefined> = [];
    const runCommand: CommandRunner = async (command, options) => {
      calls.push(command);
      inputs.push(options?.input);

      if (command[0] === "gh" && command[1] === "pr" && command[2] === "view") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            baseRefName: "main",
            headRefName: "codex/example",
            headRepository: { nameWithOwner: "kwam1na/athena" },
            headRepositoryOwner: { login: "kwam1na" },
            isDraft: false,
            number: 343,
            state: "OPEN",
            url: "https://github.com/kwam1na/athena/pull/343",
          }),
        };
      }

      return { exitCode: 0, stderr: "", stdout: "{}" };
    };

    const message = await mergePullRequest(
      {
        deleteBranch: true,
        method: "squash",
        prRef: "343",
        repo: "kwam1na/athena",
      },
      runCommand
    );

    expect(message).toContain("Merged https://github.com/kwam1na/athena/pull/343");
    expect(calls).toEqual([
      [
        "gh",
        "pr",
        "view",
        "343",
        "--repo",
        "kwam1na/athena",
        "--json",
        "baseRefName,headRefName,headRepository,headRepositoryOwner,isDraft,number,state,url",
      ],
      [
        "gh",
        "api",
        "--method",
        "PUT",
        "/repos/kwam1na/athena/pulls/343/merge",
        "--input",
        "-",
      ],
      [
        "gh",
        "api",
        "--method",
        "DELETE",
        "/repos/kwam1na/athena/git/refs/heads/codex/example",
      ],
    ]);
    expect(inputs[1]).toBe('{"merge_method":"squash"}\n');
  });

  it("does not delete fork branches", async () => {
    const calls: string[][] = [];
    const runCommand: CommandRunner = async (command) => {
      calls.push(command);

      if (command[0] === "gh" && command[1] === "pr" && command[2] === "view") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            baseRefName: "main",
            headRefName: "codex/fork",
            headRepository: { nameWithOwner: "someone/athena" },
            headRepositoryOwner: { login: "someone" },
            isDraft: false,
            number: 12,
            state: "OPEN",
            url: "https://github.com/kwam1na/athena/pull/12",
          }),
        };
      }

      return { exitCode: 0, stderr: "", stdout: "{}" };
    };

    await mergePullRequest(
      {
        deleteBranch: true,
        method: "squash",
        prRef: "12",
        repo: "kwam1na/athena",
      },
      runCommand
    );

    expect(calls.map((call) => call[1])).toEqual(["pr", "api"]);
  });

  it("resolves the current repo when --repo is omitted", async () => {
    const calls: string[][] = [];
    const runCommand: CommandRunner = async (command) => {
      calls.push(command);

      if (command[0] === "gh" && command[1] === "repo") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({ nameWithOwner: "kwam1na/athena" }),
        };
      }

      if (command[0] === "gh" && command[1] === "pr") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            baseRefName: "main",
            headRefName: "codex/example",
            headRepository: { nameWithOwner: "kwam1na/athena" },
            headRepositoryOwner: { login: "kwam1na" },
            isDraft: false,
            number: 343,
            state: "OPEN",
            url: "https://github.com/kwam1na/athena/pull/343",
          }),
        };
      }

      return { exitCode: 0, stderr: "", stdout: "{}" };
    };

    await mergePullRequest(
      {
        deleteBranch: false,
        method: "squash",
        prRef: "343",
      },
      runCommand
    );

    expect(calls[0]).toEqual(["gh", "repo", "view", "--json", "nameWithOwner"]);
    expect(calls[1]).toContain("kwam1na/athena");
  });

  it("does not delete the base branch when head and base names match", async () => {
    const calls: string[][] = [];
    const runCommand: CommandRunner = async (command) => {
      calls.push(command);

      if (command[0] === "gh" && command[1] === "pr") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            baseRefName: "main",
            headRefName: "main",
            headRepository: { nameWithOwner: "kwam1na/athena" },
            headRepositoryOwner: { login: "kwam1na" },
            isDraft: false,
            number: 22,
            state: "OPEN",
            url: "https://github.com/kwam1na/athena/pull/22",
          }),
        };
      }

      return { exitCode: 0, stderr: "", stdout: "{}" };
    };

    await mergePullRequest(
      {
        deleteBranch: true,
        method: "squash",
        prRef: "22",
        repo: "kwam1na/athena",
      },
      runCommand
    );

    expect(calls.map((call) => call[1])).toEqual(["pr", "api"]);
  });

  it("treats already merged PRs as successful no-ops", async () => {
    const calls: string[][] = [];
    const runCommand: CommandRunner = async (command) => {
      calls.push(command);
      return {
        exitCode: 0,
        stderr: "",
        stdout: JSON.stringify({
          baseRefName: "main",
          headRefName: "codex/done",
          headRepository: { nameWithOwner: "kwam1na/athena" },
          headRepositoryOwner: { login: "kwam1na" },
          isDraft: false,
          number: 99,
          state: "MERGED",
          url: "https://github.com/kwam1na/athena/pull/99",
        }),
      };
    };

    await expect(
      mergePullRequest(
        {
          deleteBranch: true,
          method: "squash",
          prRef: "99",
          repo: "kwam1na/athena",
        },
        runCommand
      )
    ).resolves.toContain("already merged");
    expect(calls).toHaveLength(1);
  });

  it("rejects draft PRs before merge", async () => {
    const runCommand: CommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        baseRefName: "main",
        headRefName: "codex/draft",
        headRepository: { nameWithOwner: "kwam1na/athena" },
        headRepositoryOwner: { login: "kwam1na" },
        isDraft: true,
        number: 100,
        state: "OPEN",
        url: "https://github.com/kwam1na/athena/pull/100",
      }),
    });

    await expect(
      mergePullRequest(
        {
          deleteBranch: false,
          method: "squash",
          prRef: "100",
          repo: "kwam1na/athena",
        },
        runCommand
      )
    ).rejects.toThrow("still a draft");
  });

  it("rejects closed PRs before merge", async () => {
    const runCommand: CommandRunner = async () => ({
      exitCode: 0,
      stderr: "",
      stdout: JSON.stringify({
        baseRefName: "main",
        headRefName: "codex/closed",
        headRepository: { nameWithOwner: "kwam1na/athena" },
        headRepositoryOwner: { login: "kwam1na" },
        isDraft: false,
        number: 101,
        state: "CLOSED",
        url: "https://github.com/kwam1na/athena/pull/101",
      }),
    });

    await expect(
      mergePullRequest(
        {
          deleteBranch: false,
          method: "squash",
          prRef: "101",
          repo: "kwam1na/athena",
        },
        runCommand
      )
    ).rejects.toThrow("only OPEN PRs can be merged");
  });

  it("surfaces gh api merge failures", async () => {
    const runCommand: CommandRunner = async (command) => {
      if (command[0] === "gh" && command[1] === "pr") {
        return {
          exitCode: 0,
          stderr: "",
          stdout: JSON.stringify({
            baseRefName: "main",
            headRefName: "codex/failing",
            headRepository: { nameWithOwner: "kwam1na/athena" },
            headRepositoryOwner: { login: "kwam1na" },
            isDraft: false,
            number: 102,
            state: "OPEN",
            url: "https://github.com/kwam1na/athena/pull/102",
          }),
        };
      }

      return { exitCode: 1, stderr: "merge blocked", stdout: "" };
    };

    await expect(
      mergePullRequest(
        {
          deleteBranch: false,
          method: "squash",
          prRef: "102",
          repo: "kwam1na/athena",
        },
        runCommand
      )
    ).rejects.toThrow("merge blocked");
  });

  it("parses merge options", () => {
    expect(
      parseArgs([
        "343",
        "--method",
        "rebase",
        "--delete-branch",
        "--repo=kwam1na/athena",
      ])
    ).toEqual({
      deleteBranch: true,
      method: "rebase",
      prRef: "343",
      repo: "kwam1na/athena",
    });
  });

  it("rejects invalid CLI options", () => {
    expect(() => parseArgs([])).toThrow("Usage:");
    expect(() => parseArgs(["343", "--method"])).toThrow("--method requires a value");
    expect(() => parseArgs(["343", "--method", "octopus"])).toThrow(
      "Unsupported merge method"
    );
    expect(() => parseArgs(["343", "--repo"])).toThrow("--repo requires a value");
    expect(() => parseArgs(["343", "--unknown"])).toThrow("Unknown option");
    expect(() => parseArgs(["343", "344"])).toThrow("Unexpected extra argument");
  });

  it("keeps the execute workflow pointed at the worktree-safe merge helper", async () => {
    const rootDir = path.resolve(import.meta.dirname, "..");
    const [executeSkill, packageJson] = await Promise.all([
      readFile(path.join(rootDir, ".agents/skills/execute/SKILL.md"), "utf8"),
      readFile(path.join(rootDir, "package.json"), "utf8"),
    ]);

    expect(JSON.parse(packageJson).scripts["github:pr-merge"]).toBe(
      "bun scripts/github-pr-merge.ts"
    );
    expect(executeSkill).toContain("bun run github:pr-merge -- <pr-number-or-url>");
    expect(executeSkill).toContain("instead of raw `gh pr merge`");
    expect(executeSkill).toContain("Delivery always includes remote merge and local fast-forward");
    expect(executeSkill).toContain("fast-forward the local root checkout to `origin/main`");
    expect(executeSkill).toContain("Treat the merge as incomplete until the remote merge is confirmed");
  });

  it("runs local commands with optional stdin", async () => {
    const result = await runProcess(["bash", "-lc", "cat"], {
      input: "merge through api\n",
    });

    expect(result).toEqual({
      exitCode: 0,
      stderr: "",
      stdout: "merge through api\n",
    });
  });
});
