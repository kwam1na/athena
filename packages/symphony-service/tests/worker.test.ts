import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CodexAppServerClient } from "../src/codex/client";
import type { NormalizedIssue, TrackerClient } from "../src/issue";
import type { EffectiveConfig } from "../src/types";
import { runIssueAttempt } from "../src/worker";

function issue(partial: Partial<NormalizedIssue>): NormalizedIssue {
  return {
    id: partial.id ?? "1",
    identifier: partial.identifier ?? "ATH-1",
    title: partial.title ?? "Issue",
    state: partial.state ?? "Todo",
    priority: partial.priority ?? 1,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
    labels: partial.labels ?? [],
    blocked_by: partial.blocked_by ?? [],
  };
}

class FakeTracker implements TrackerClient {
  constructor(
    private readonly refreshed: NormalizedIssue[],
  ) {}

  async fetchCandidateIssues(): Promise<NormalizedIssue[]> {
    return [];
  }

  async fetchIssuesByStates(): Promise<NormalizedIssue[]> {
    return [];
  }

  async fetchIssueStatesByIds(): Promise<NormalizedIssue[]> {
    return this.refreshed;
  }
}

class FakeCodex {
  readonly startedCwds: string[] = [];
  readonly prompts: string[] = [];
  readonly stops: number[] = [];
  private turnCount = 0;

  constructor(
    private readonly runTurnOutcome: "completed" | "failed" | "cancelled" | "turn_timeout" | "port_exit" | "turn_input_required" = "completed",
    private readonly inputTokensPerTurn = 0,
  ) {}

  async startSession(input: { cwd: string }): Promise<{ threadId: string }> {
    this.startedCwds.push(input.cwd);
    return { threadId: "thread-1" };
  }

  async runTurn(input: {
    threadId: string;
    cwd: string;
    title: string;
    prompt: string;
  }): Promise<{
    turnId: string;
    sessionId: string;
    outcome: "completed" | "failed" | "cancelled" | "turn_timeout" | "port_exit" | "turn_input_required";
    usage?: { input_tokens: number; output_tokens: number; total_tokens: number };
  }> {
    this.prompts.push(input.prompt);
    this.turnCount += 1;
    return {
      turnId: `turn-${this.turnCount}`,
      sessionId: `thread-1-turn-${this.turnCount}`,
      outcome: this.runTurnOutcome,
      usage:
        this.inputTokensPerTurn > 0
          ? {
              input_tokens: this.inputTokensPerTurn,
              output_tokens: 1,
              total_tokens: this.inputTokensPerTurn + 1,
            }
          : undefined,
    };
  }

  stop(): void {
    this.stops.push(Date.now());
  }
}

function config(root: string, overrides?: Partial<EffectiveConfig>): EffectiveConfig {
  const trackerOverrides = overrides?.tracker;

  return {
    tracker: {
      kind: trackerOverrides?.kind ?? "linear",
      endpoint: trackerOverrides?.endpoint ?? "https://api.linear.app/graphql",
      apiKey: trackerOverrides?.apiKey ?? "key",
      projectSlug: trackerOverrides?.projectSlug ?? "ATH",
      handoffState: trackerOverrides?.handoffState ?? "Human Review",
      activeStates: trackerOverrides?.activeStates ?? ["Todo", "In Progress"],
      terminalStates: trackerOverrides?.terminalStates ?? ["Done", "Closed"],
    },
    polling: {
      intervalMs: 30_000,
      ...overrides?.polling,
    },
    workspace: {
      root,
      ...overrides?.workspace,
    },
    hooks: {
      timeoutMs: 2000,
      ...overrides?.hooks,
    },
    agent: {
      maxConcurrentAgents: 2,
      maxRetryBackoffMs: 300_000,
      maxTurns: 3,
      maxInputTokensPerAttempt: 150_000,
      maxIssueInputTokens: 300_000,
      maxContinuationRunsPerIssue: 2,
      continuationRetryDelayMs: 30_000,
      maxConcurrentAgentsByState: {},
      ...overrides?.agent,
    },
    codex: {
      command: "codex app-server",
      clientName: "symphony",
      clientVersion: "test",
      clientCapabilities: {},
      turnTimeoutMs: 60_000,
      readTimeoutMs: 5000,
      stallTimeoutMs: 300_000,
      ...overrides?.codex,
    },
  };
}

describe("runIssueAttempt", () => {
  it("creates workspace, runs hooks, executes turn loop, and exits when issue becomes terminal", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-worker-success-"));
    const codex = new FakeCodex("completed");
    const tracker = new FakeTracker([
      issue({ id: "1", identifier: "ATH-1", state: "Done" }),
    ]);

    const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];
    const result = await runIssueAttempt({
      issue: issue({ id: "1", identifier: "ATH-1", state: "Todo" }),
      attempt: 1,
      workflowTemplate: "Issue {{ issue.identifier }} attempt {{ attempt }}",
      config: config(root, {
        hooks: {
          timeoutMs: 2000,
          beforeRun: "echo before > before.txt",
          afterRun: "echo after > after.txt",
        },
      }),
      tracker,
      createCodexClient: () => codex as unknown as CodexAppServerClient,
      onLog: (entry) => logs.push(entry),
    });

    expect(result.exit).toBe("normal");
    expect(result.turnCount).toBe(1);
    expect(codex.startedCwds.length).toBe(1);
    expect(codex.prompts[0]).toContain("ATH-1");
    expect(codex.stops.length).toBe(1);
    expect((await readFile(join(result.workspacePath, "before.txt"), "utf8")).trim()).toBe("before");
    expect((await readFile(join(result.workspacePath, "after.txt"), "utf8")).trim()).toBe("after");
    expect(logs.some((entry) => entry.details?.issue_id === "1" && entry.details?.issue_identifier === "ATH-1")).toBe(true);
    expect(logs.some((entry) => entry.details?.session_id === "thread-1-turn-1")).toBe(true);
  });

  it("fails fast when before_run hook fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-worker-before-run-fail-"));

    await expect(
      runIssueAttempt({
        issue: issue({ id: "2", identifier: "ATH-2", state: "Todo" }),
        attempt: 1,
        workflowTemplate: "Issue {{ issue.identifier }}",
        config: config(root, {
          hooks: {
            timeoutMs: 2000,
            beforeRun: "exit 7",
          },
        }),
        tracker: new FakeTracker([]),
        createCodexClient: () => new FakeCodex() as unknown as CodexAppServerClient,
      }),
    ).rejects.toMatchObject({
      code: "hook_failed",
    });
  });

  it("runs after_run hook even when turn fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-worker-turn-fail-"));
    const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];

    await expect(
      runIssueAttempt({
        issue: issue({ id: "3", identifier: "ATH-3", state: "Todo" }),
        attempt: 1,
        workflowTemplate: "Issue {{ issue.identifier }}",
        config: config(root, {
          hooks: {
            timeoutMs: 2000,
            afterRun: "echo after > after.txt",
          },
        }),
        tracker: new FakeTracker([
          issue({ id: "3", identifier: "ATH-3", state: "Todo" }),
        ]),
        createCodexClient: () => new FakeCodex("failed") as unknown as CodexAppServerClient,
        onLog: (entry) => logs.push(entry),
      }),
    ).rejects.toMatchObject({
      code: "worker_turn_failed",
    });

    const workspacePath = join(root, "ATH-3");
    expect((await readFile(join(workspacePath, "after.txt"), "utf8")).trim()).toBe("after");
    expect(logs.some((entry) => entry.message.includes("action=turn outcome=failed"))).toBe(true);
    expect(logs.some((entry) => entry.details?.issue_id === "3" && entry.details?.issue_identifier === "ATH-3")).toBe(true);
    expect(logs.some((entry) => entry.details?.session_id === "thread-1-turn-1")).toBe(true);
  });

  it("treats port_exit as clean completion when the issue already transitioned out of active states", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-worker-port-exit-terminal-"));
    const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];

    const result = await runIssueAttempt({
      issue: issue({ id: "9", identifier: "ATH-9", state: "Todo" }),
      attempt: 1,
      workflowTemplate: "Issue {{ issue.identifier }}",
      config: config(root),
      tracker: new FakeTracker([
        issue({ id: "9", identifier: "ATH-9", state: "Done" }),
      ]),
      createCodexClient: () => new FakeCodex("port_exit") as unknown as CodexAppServerClient,
      onLog: (entry) => logs.push(entry),
    });

    expect(result.exit).toBe("normal");
    expect(result.issue.state).toBe("Done");
    expect(result.turnCount).toBe(1);
    expect(logs.some((entry) => entry.message.includes("action=turn outcome=terminal_after_non_completed"))).toBe(true);
  });

  it("stops attempt when per-attempt input token budget is exceeded", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-worker-token-guardrail-"));
    const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];

    const result = await runIssueAttempt({
      issue: issue({ id: "4", identifier: "ATH-4", state: "Todo" }),
      attempt: 1,
      workflowTemplate: "Issue {{ issue.identifier }}",
      config: config(root, {
        agent: {
          maxTurns: 10,
          maxInputTokensPerAttempt: 100,
          maxIssueInputTokens: 300_000,
          maxContinuationRunsPerIssue: 2,
          continuationRetryDelayMs: 30_000,
          maxConcurrentAgents: 2,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: {},
        },
      }),
      tracker: new FakeTracker([issue({ id: "4", identifier: "ATH-4", state: "Todo" })]),
      createCodexClient: () => new FakeCodex("completed", 75) as unknown as CodexAppServerClient,
      onLog: (entry) => logs.push(entry),
    });

    expect(result.exit).toBe("guardrail_stop");
    expect(result.guardrail_reason).toBe("attempt_input_budget_exceeded");
    expect(result.turnCount).toBe(2);
    expect(logs.some((entry) => entry.message.includes("guardrail_stop"))).toBe(true);
  });

  it("stops attempt after no-progress window is exceeded", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-worker-no-progress-"));
    const logs: Array<{ message: string; details?: Record<string, unknown> }> = [];

    const result = await runIssueAttempt({
      issue: issue({ id: "5", identifier: "ATH-5", state: "Todo" }),
      attempt: 1,
      workflowTemplate: "Issue {{ issue.identifier }}",
      config: config(root, {
        hooks: {
          timeoutMs: 2000,
          afterCreate: "git init -q",
        },
        agent: {
          maxTurns: 12,
          maxInputTokensPerAttempt: 150_000,
          maxIssueInputTokens: 300_000,
          maxContinuationRunsPerIssue: 2,
          continuationRetryDelayMs: 30_000,
          maxConcurrentAgents: 2,
          maxRetryBackoffMs: 300_000,
          maxConcurrentAgentsByState: {},
        },
      }),
      tracker: new FakeTracker([issue({ id: "5", identifier: "ATH-5", state: "Todo" })]),
      createCodexClient: () => new FakeCodex("completed", 10) as unknown as CodexAppServerClient,
      onLog: (entry) => logs.push(entry),
    });

    expect(result.exit).toBe("guardrail_stop");
    expect(result.guardrail_reason).toBe("no_progress_window_exceeded");
    expect(result.turnCount).toBe(3);
    expect(logs.some((entry) => entry.message.includes("no_progress_window_exceeded"))).toBe(true);
  });
});
