import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseProviderSkippedEvents,
  runPrAthenaDeliveryRun,
  writePrAthenaProviderEvidence,
} from "./pr-athena-delivery-run";

function runGit(rootDir: string, args: string[]) {
  const result = spawnSync("git", args, {
    cwd: rootDir,
    encoding: "utf8",
    env: gitFixtureEnv(),
  });

  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }

  return result.stdout.trim();
}

function gitFixtureEnv() {
  return Object.fromEntries(
    Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")),
  );
}

describe("pr-athena delivery run wrapper", () => {
  it("runs prepare, validate, and record-proof phases while recording spans", async () => {
    const commands: string[][] = [];
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: 0 };
      },
    });

    expect(result.exitCode).toBe(0);
    expect(commands).toEqual([
      ["bun", "run", "pr:athena:prepare"],
      ["bun", "run", "pr:athena:validate"],
      ["bun", "run", "pr:athena:record-proof"],
      ["bun", "run", "pr:athena:scorecard"],
    ]);
    expect(result.ledger).toMatchObject({
      status: "pass",
      proofState: "proof_recorded",
      summary: {
        commandCount: 4,
        failedCommandCount: 0,
      },
      commandSpans: [
        { phase: "prepare", status: "pass", exitCode: 0 },
        { phase: "validate", status: "pass", exitCode: 0 },
        { phase: "record-proof", status: "pass", exitCode: 0 },
        { phase: "scorecard", status: "pass", exitCode: 0 },
      ],
    });
  });

  it("records provider skip events emitted during validation", async () => {
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => ({
        exitCode: 0,
        providerSkippedEvents: command.includes("pr:athena:validate")
          ? [
              {
                providerName: "pr:athena:delivery-run",
                coveredBy: "@athena/webapp:test",
                reason: "athena-webapp-vitest",
              },
            ]
          : [],
      }),
    });

    expect(result.ledger.providerSkippedEvents).toEqual([
      {
        providerName: "pr:athena:delivery-run",
        status: "covered_by_provider",
        coveredBy: "@athena/webapp:test",
        reason: "athena-webapp-vitest",
      },
    ]);
    expect(result.ledger.summary.providerSkippedCount).toBe(1);
  });

  it("parses provider skip events from mixed command output", () => {
    expect(
      parseProviderSkippedEvents(
        [
          "Running @athena/webapp:test",
          JSON.stringify({
            type: "provider_skipped",
            status: "covered_by_provider",
            capability: "athena-webapp-vitest",
            command: "@athena/webapp:test",
            providedBy: "pr:athena:delivery-run",
          }),
          "{not-json",
        ].join("\n")
      )
    ).toEqual([
      {
        providerName: "pr:athena:delivery-run",
        coveredBy: "@athena/webapp:test",
        reason: "athena-webapp-vitest",
      },
    ]);
  });

  it("preserves the failing phase exit code and does not record proof after validation failure", async () => {
    const commands: string[][] = [];
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: command.includes("pr:athena:validate") ? 42 : 0 };
      },
    });

    expect(result.exitCode).toBe(42);
    expect(commands).toEqual([
      ["bun", "run", "pr:athena:prepare"],
      ["bun", "run", "pr:athena:validate"],
    ]);
    expect(result.ledger).toMatchObject({
      status: "blocked",
      proofState: "proof_not_recorded",
      blockedReason: "pr:athena:validate exited with code 42",
      commandSpans: [
        { phase: "prepare", status: "pass", exitCode: 0 },
        { phase: "validate", status: "fail", exitCode: 42 },
      ],
    });
  });

  it("does not mark proof recorded when record-proof fails", async () => {
    const commands: string[][] = [];
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async (command) => {
        commands.push(command);
        return { exitCode: command.includes("pr:athena:record-proof") ? 1 : 0 };
      },
    });

    expect(result.exitCode).toBe(1);
    expect(commands).toEqual([
      ["bun", "run", "pr:athena:prepare"],
      ["bun", "run", "pr:athena:validate"],
      ["bun", "run", "pr:athena:record-proof"],
    ]);
    expect(result.ledger).toMatchObject({
      status: "blocked",
      proofState: "proof_not_recorded",
      blockedReason: "pr:athena:record-proof exited with code 1",
      commandSpans: [
        { phase: "prepare", status: "pass", exitCode: 0 },
        { phase: "validate", status: "pass", exitCode: 0 },
        { phase: "record-proof", status: "fail", exitCode: 1 },
      ],
    });
  });

  it("records interrupted runs distinctly from blocked command failures", async () => {
    let tick = 0;

    const result = await runPrAthenaDeliveryRun("/repo", {
      nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
      monotonicMs: () => tick++ * 1000,
      writeLedger: false,
      runCommand: async () => {
        throw Object.assign(new Error("SIGINT"), { signal: "SIGINT" });
      },
    });

    expect(result.exitCode).toBe(130);
    expect(result.ledger).toMatchObject({
      status: "interrupted",
      proofState: "proof_not_recorded",
      interruptedReason: "SIGINT",
      commandSpans: [
        {
          phase: "prepare",
          status: "interrupted",
          exitCode: 130,
        },
      ],
    });
  });

  it("writes the default latest ledger artifact", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-ledger-"));
    let tick = 0;

    try {
      await runPrAthenaDeliveryRun(rootDir, {
        nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
        monotonicMs: () => tick++ * 1000,
        runCommand: async () => ({ exitCode: 0 }),
      });

      const latest = JSON.parse(
        await readFile(
          path.join(rootDir, "artifacts/harness-delivery-runs/latest.json"),
          "utf8"
        )
      );

      expect(latest).toMatchObject({
        status: "pass",
        proofState: "proof_recorded",
        summary: { commandCount: 4 },
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("writes provider evidence for the current index tree", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-provider-"));

    try {
      runGit(rootDir, ["init"]);
      await Bun.write(path.join(rootDir, "package.json"), "{}\n");
      runGit(rootDir, ["add", "package.json"]);
      const treeSha = runGit(rootDir, ["write-tree"]);

      await writePrAthenaProviderEvidence(rootDir);

      const evidence = JSON.parse(
        await readFile(
          path.join(
            rootDir,
            "artifacts/harness-delivery-runs/provider-evidence.json"
          ),
          "utf8"
        )
      );

      expect(evidence).toMatchObject({
        schemaVersion: 1,
        provider: "pr:athena:delivery-run",
        treeSha,
        capabilities: [
          {
            capability: "root-script-tests",
            command: "bun run test:coverage:scripts",
          },
          {
            capability: "athena-webapp-vitest",
            command: "bun run --filter '@athena/webapp' test:coverage",
            coverage: { mode: "full" },
          },
        ],
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it("persists a blocked ledger when the scorecard phase fails after proof recording", async () => {
    const rootDir = await mkdtemp(path.join(tmpdir(), "athena-pr-scorecard-"));
    let tick = 0;

    try {
      runGit(rootDir, ["init"]);
      const proofPath = path.join(
        rootDir,
        runGit(rootDir, [
          "rev-parse",
          "--git-path",
          "codex/pre-push-pr-athena-proof.json",
        ])
      );
      await mkdir(path.dirname(proofPath), { recursive: true });
      await Bun.write(proofPath, "{}\n");

      const result = await runPrAthenaDeliveryRun(rootDir, {
        nowIso: () => `2026-06-18T12:00:0${tick}.000Z`,
        monotonicMs: () => tick++ * 1000,
        runCommand: async (command) => ({
          exitCode: command.includes("pr:athena:scorecard") ? 7 : 0,
        }),
      });

      expect(result.exitCode).toBe(7);
      expect(result.ledger).toMatchObject({
        status: "blocked",
        proofState: "proof_not_recorded",
        blockedReason: "pr:athena:scorecard exited with code 7",
        commandSpans: [
          { phase: "prepare", status: "pass", exitCode: 0 },
          { phase: "validate", status: "pass", exitCode: 0 },
          { phase: "record-proof", status: "pass", exitCode: 0 },
          { phase: "scorecard", status: "fail", exitCode: 7 },
        ],
      });

      const latest = JSON.parse(
        await readFile(
          path.join(rootDir, "artifacts/harness-delivery-runs/latest.json"),
          "utf8"
        )
      );
      expect(latest).toMatchObject({
        status: "blocked",
        proofState: "proof_not_recorded",
        blockedReason: "pr:athena:scorecard exited with code 7",
      });
      await expect(readFile(proofPath, "utf8")).rejects.toThrow();
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
