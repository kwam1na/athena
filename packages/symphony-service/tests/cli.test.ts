import { describe, expect, it, vi } from "vitest";
import type { SymphonyService } from "../src/service";
import { parseCliArgs, runCliEntry } from "../src/cli";

function makeService(overrides?: Partial<SymphonyService>): SymphonyService {
  return {
    async start() {},
    async stop() {},
    async reloadWorkflow() {
      return true;
    },
    async runTickOnce() {},
    getSnapshot() {
      return {
        workflowPath: "/tmp/WORKFLOW.md",
        pollIntervalMs: 1000,
        runningCount: 0,
        retryCount: 0,
      };
    },
    getRuntimeSnapshot() {
      return {
        running: [],
        retrying: [],
        codex_totals: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          seconds_running: 0,
        },
        rate_limits: null,
      };
    },
    ...overrides,
  };
}

describe("parseCliArgs", () => {
  it("uses cwd + WORKFLOW.md by default", () => {
    const parsed = parseCliArgs([], "/repo");
    expect(parsed).toEqual({
      workflowPath: "/repo/WORKFLOW.md",
      watch: false,
      printEffectiveConfig: false,
    });
  });

  it("parses watch, print-effective-config, and explicit workflow path", () => {
    const parsed = parseCliArgs(["./ops/WORKFLOW.md", "--watch", "--print-effective-config"], "/repo");
    expect(parsed).toEqual({
      workflowPath: "/repo/ops/WORKFLOW.md",
      watch: true,
      printEffectiveConfig: true,
    });
  });
});

describe("runCliEntry", () => {
  it("exits nonzero when startup fails", async () => {
    const exits: number[] = [];
    const stderr: string[] = [];

    await runCliEntry(["./WORKFLOW.md"], {
      cwd: () => "/repo",
      createService: () => {
        throw new Error("startup failed");
      },
      onSignal: () => {},
      onUncaughtException: () => {},
      onUnhandledRejection: () => {},
      writeStderr: (line) => stderr.push(line),
      exit: (code) => exits.push(code),
    });

    expect(exits).toEqual([1]);
    expect(stderr.some((line) => line.includes("startup failed"))).toBe(true);
  });

  it("stops service and exits zero on SIGINT", async () => {
    const exits: number[] = [];
    const signals: Partial<Record<"SIGINT" | "SIGTERM", () => void>> = {};
    const stop = vi.fn(async () => {});

    await runCliEntry([], {
      cwd: () => "/repo",
      createService: () => makeService({ stop }),
      onSignal: (signal, handler) => {
        signals[signal] = handler;
      },
      onUncaughtException: () => {},
      onUnhandledRejection: () => {},
      writeStderr: () => {},
      exit: (code) => exits.push(code),
    });

    expect(stop).not.toHaveBeenCalled();
    signals.SIGINT?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(exits).toEqual([0]);
  });

  it("still exits zero when shutdown fails", async () => {
    const exits: number[] = [];
    const stderr: string[] = [];
    const signals: Partial<Record<"SIGINT" | "SIGTERM", () => void>> = {};

    await runCliEntry([], {
      cwd: () => "/repo",
      createService: () =>
        makeService({
          stop: async () => {
            throw new Error("stop failed");
          },
        }),
      onSignal: (signal, handler) => {
        signals[signal] = handler;
      },
      onUncaughtException: () => {},
      onUnhandledRejection: () => {},
      writeStderr: (line) => stderr.push(line),
      exit: (code) => exits.push(code),
    });

    signals.SIGTERM?.();
    await Promise.resolve();
    await Promise.resolve();

    expect(stderr.some((line) => line.includes("shutdown failed"))).toBe(true);
    expect(exits).toEqual([0]);
  });

  it("stops service and exits nonzero on uncaught exception", async () => {
    const exits: number[] = [];
    const stderr: string[] = [];
    let uncaughtHandler: ((error: unknown) => void) | null = null;
    const stop = vi.fn(async () => {});

    await runCliEntry([], {
      cwd: () => "/repo",
      createService: () => makeService({ stop }),
      onSignal: () => {},
      onUncaughtException: (handler) => {
        uncaughtHandler = handler;
      },
      onUnhandledRejection: () => {},
      writeStderr: (line) => stderr.push(line),
      exit: (code) => exits.push(code),
    });

    if (!uncaughtHandler) {
      throw new Error("uncaught exception handler was not registered");
    }
    (uncaughtHandler as (error: unknown) => void)(new Error("boom"));
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stderr.some((line) => line.includes("fatal host error"))).toBe(true);
    expect(exits).toEqual([1]);
  });

  it("stops service and exits nonzero on unhandled rejection", async () => {
    const exits: number[] = [];
    const stderr: string[] = [];
    let rejectionHandler: ((reason: unknown) => void) | null = null;
    const stop = vi.fn(async () => {});

    await runCliEntry([], {
      cwd: () => "/repo",
      createService: () => makeService({ stop }),
      onSignal: () => {},
      onUncaughtException: () => {},
      onUnhandledRejection: (handler) => {
        rejectionHandler = handler;
      },
      writeStderr: (line) => stderr.push(line),
      exit: (code) => exits.push(code),
    });

    if (!rejectionHandler) {
      throw new Error("unhandled rejection handler was not registered");
    }
    (rejectionHandler as (reason: unknown) => void)(new Error("rejected"));
    await Promise.resolve();
    await Promise.resolve();

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stderr.some((line) => line.includes("fatal host error"))).toBe(true);
    expect(exits).toEqual([1]);
  });
});
