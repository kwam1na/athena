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
        completed: [],
        codex_totals: {
          input_tokens: 0,
          output_tokens: 0,
          total_tokens: 0,
          seconds_running: 0,
        },
        rate_limits: null,
      };
    },
    getRuntimeIssueSnapshot() {
      return null;
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
      port: undefined,
    });
  });

  it("parses watch, print-effective-config, and explicit workflow path", () => {
    const parsed = parseCliArgs(["./ops/WORKFLOW.md", "--watch", "--print-effective-config", "--port=3131"], "/repo");
    expect(parsed).toEqual({
      workflowPath: "/repo/ops/WORKFLOW.md",
      watch: true,
      printEffectiveConfig: true,
      port: 3131,
    });
  });

  it("parses --port value from next arg", () => {
    const parsed = parseCliArgs(["--port", "8080"], "/repo");
    expect(parsed.port).toBe(8080);
  });

  it("throws for invalid --port", () => {
    expect(() => parseCliArgs(["--port", "foo"], "/repo")).toThrowError("invalid --port value");
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
      resolveWorkflowServerPort: async () => undefined,
      startStatusServer: async () => ({ host: "127.0.0.1", port: 0, stop: async () => {} }),
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => {},
      exit: (code) => exits.push(code),
    });

    expect(exits).toEqual([1]);
    expect(stderr.some((line) => line.includes("startup failed"))).toBe(true);
  });

  it("stops service and exits zero on SIGINT", async () => {
    const exits: number[] = [];
    const signals: Partial<Record<"SIGINT" | "SIGTERM", () => void>> = {};
    const stop = vi.fn(async () => {});
    const statusStop = vi.fn(async () => {});

    await runCliEntry([], {
      cwd: () => "/repo",
      createService: () => makeService({ stop }),
      onSignal: (signal, handler) => {
        signals[signal] = handler;
      },
      onUncaughtException: () => {},
      onUnhandledRejection: () => {},
      resolveWorkflowServerPort: async () => 4030,
      startStatusServer: async () => ({ host: "127.0.0.1", port: 4030, stop: statusStop }),
      writeStderr: () => {},
      writeStdout: () => {},
      exit: (code) => exits.push(code),
    });

    expect(stop).not.toHaveBeenCalled();
    signals.SIGINT?.();
    await vi.waitFor(() => {
      expect(exits).toEqual([0]);
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(statusStop).toHaveBeenCalledTimes(1);
  });

  it("still exits zero when shutdown fails", async () => {
    const exits: number[] = [];
    const stderr: string[] = [];
    const signals: Partial<Record<"SIGINT" | "SIGTERM", () => void>> = {};
    const statusStop = vi.fn(async () => {});

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
      resolveWorkflowServerPort: async () => 0,
      startStatusServer: async () => ({ host: "127.0.0.1", port: 3301, stop: statusStop }),
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => {},
      exit: (code) => exits.push(code),
    });

    signals.SIGTERM?.();
    await vi.waitFor(() => {
      expect(exits).toEqual([0]);
    });

    expect(stderr.some((line) => line.includes("shutdown failed"))).toBe(true);
    expect(statusStop).toHaveBeenCalledTimes(1);
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
      resolveWorkflowServerPort: async () => undefined,
      startStatusServer: async () => ({ host: "127.0.0.1", port: 0, stop: async () => {} }),
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => {},
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
      resolveWorkflowServerPort: async () => undefined,
      startStatusServer: async () => ({ host: "127.0.0.1", port: 0, stop: async () => {} }),
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => {},
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

  it("starts status server when --port is provided", async () => {
    const startedPorts: number[] = [];
    const stdout: string[] = [];

    await runCliEntry(["--port", "4321"], {
      cwd: () => "/repo",
      createService: () => makeService(),
      onSignal: () => {},
      onUncaughtException: () => {},
      onUnhandledRejection: () => {},
      resolveWorkflowServerPort: async () => 7000,
      startStatusServer: async ({ port }) => {
        startedPorts.push(port);
        return { host: "127.0.0.1", port, stop: async () => {} };
      },
      writeStderr: () => {},
      writeStdout: (line) => stdout.push(line),
      exit: () => {},
    });

    expect(startedPorts).toEqual([4321]);
    expect(stdout.some((line) => line.includes("4321"))).toBe(true);
  });

  it("uses workflow server port when --port is not provided", async () => {
    const startedPorts: number[] = [];

    await runCliEntry([], {
      cwd: () => "/repo",
      createService: () => makeService(),
      onSignal: () => {},
      onUncaughtException: () => {},
      onUnhandledRejection: () => {},
      resolveWorkflowServerPort: async () => 5050,
      startStatusServer: async ({ port }) => {
        startedPorts.push(port);
        return { host: "127.0.0.1", port, stop: async () => {} };
      },
      writeStderr: () => {},
      writeStdout: () => {},
      exit: () => {},
    });

    expect(startedPorts).toEqual([5050]);
  });

  it("stops service and exits nonzero when status server startup fails", async () => {
    const exits: number[] = [];
    const stderr: string[] = [];
    const stop = vi.fn(async () => {});

    await runCliEntry(["--port", "4200"], {
      cwd: () => "/repo",
      createService: () => makeService({ stop }),
      onSignal: () => {},
      onUncaughtException: () => {},
      onUnhandledRejection: () => {},
      resolveWorkflowServerPort: async () => undefined,
      startStatusServer: async () => {
        throw new Error("port in use");
      },
      writeStderr: (line) => stderr.push(line),
      writeStdout: () => {},
      exit: (code) => exits.push(code),
    });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(stderr.some((line) => line.includes("startup failed"))).toBe(true);
    expect(exits).toEqual([1]);
  });
});
