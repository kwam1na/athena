import { describe, expect, it, vi } from "vitest";
import type { FSWatcher } from "node:fs";
import type { WorkflowDocument } from "../src/types";
import type { TrackerClient } from "../src/issue";
import { createSymphonyService } from "../src/service";

class FakeTracker implements TrackerClient {
  async fetchCandidateIssues() {
    return [];
  }

  async fetchIssuesByStates() {
    return [];
  }

  async fetchIssueStatesByIds() {
    return [];
  }
}

function workflow(pollMs: number): WorkflowDocument {
  return {
    path: "/tmp/WORKFLOW.md",
    config: {
      tracker: {
        kind: "linear",
        api_key: "key",
        project_slug: "ATH",
      },
      polling: {
        interval_ms: pollMs,
      },
      codex: {
        command: "codex app-server",
      },
    },
    promptTemplate: "Issue {{ issue.identifier }}",
  };
}

describe("createSymphonyService", () => {
  it("runs startup cleanup, immediate tick, and schedules polling", async () => {
    const intervalCalls: number[] = [];
    const clearCalls: unknown[] = [];
    let intervalId = 0;
    const runTickCalls: number[] = [];
    const dueRetryCalls: number[] = [];
    const cleanupCalls: number[] = [];

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => workflow(1234),
        createTracker: () => new FakeTracker(),
        cleanupTerminalIssueWorkspaces: async () => {
          cleanupCalls.push(1);
          return { removed: 0, failed: 0, warnings: [] };
        },
        processDueRetries: async () => {
          dueRetryCalls.push(1);
          return {
            processedIssueIds: [],
            dispatchedIssueIds: [],
            requeuedIssueIds: [],
            releasedIssueIds: [],
          };
        },
        runOrchestratorTick: async () => {
          runTickCalls.push(1);
          return {
            skippedDispatch: false,
            selectedIssueIds: [],
            dispatchedIssueIds: [],
            dispatchErrors: [],
            reconcileActions: [],
            stalledIssueIds: [],
          };
        },
        setIntervalFn: (fn: () => void, ms: number) => {
          intervalCalls.push(ms);
          void fn;
          intervalId += 1;
          return intervalId as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: (id: ReturnType<typeof setInterval>) => {
          clearCalls.push(id);
        },
      },
    });

    await service.start();

    expect(cleanupCalls).toHaveLength(1);
    expect(dueRetryCalls).toHaveLength(1);
    expect(runTickCalls).toHaveLength(1);
    expect(intervalCalls).toEqual([1234]);
    expect(service.getSnapshot().pollIntervalMs).toBe(1234);

    await service.stop();
    expect(clearCalls).toHaveLength(1);
  });

  it("reloads workflow and updates poll interval while keeping last-known-good on reload failure", async () => {
    const workflows = [workflow(1000), workflow(2500)];
    const intervalCalls: number[] = [];
    const clearCalls: number[] = [];
    const warnings: string[] = [];
    let intervalId = 0;

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      deps: {
        loadWorkflowFile: async () => {
          const next = workflows.shift();
          if (!next) {
            throw new Error("reload parse failed");
          }
          return next;
        },
        createTracker: () => new FakeTracker(),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        runOrchestratorTick: async () => ({
          skippedDispatch: false,
          selectedIssueIds: [],
          dispatchedIssueIds: [],
          dispatchErrors: [],
          reconcileActions: [],
          stalledIssueIds: [],
        }),
        setIntervalFn: (_fn: () => void, ms: number) => {
          intervalCalls.push(ms);
          intervalId += 1;
          return intervalId as unknown as ReturnType<typeof setInterval>;
        },
        clearIntervalFn: (_id: ReturnType<typeof setInterval>) => {
          clearCalls.push(1);
        },
        onLog: (entry) => {
          if (entry.level === "warn") {
            warnings.push(entry.message);
          }
        },
      },
    });

    await service.start();
    expect(service.getSnapshot().pollIntervalMs).toBe(1000);

    await service.reloadWorkflow();
    expect(service.getSnapshot().pollIntervalMs).toBe(2500);
    expect(intervalCalls).toEqual([1000, 2500]);
    expect(clearCalls.length).toBeGreaterThanOrEqual(1);

    await service.reloadWorkflow();
    expect(service.getSnapshot().pollIntervalMs).toBe(2500);
    expect(warnings.some((msg) => msg.includes("reload failed"))).toBe(true);

    await service.stop();
  });

  it("debounces watch-triggered reloads", async () => {
    vi.useFakeTimers();

    const watchCallbacks: Array<() => void> = [];
    let loadCount = 0;

    const service = createSymphonyService({
      workflowPath: "/tmp/WORKFLOW.md",
      watch: true,
      deps: {
        loadWorkflowFile: async () => {
          loadCount += 1;
          return workflow(1000);
        },
        createTracker: () => new FakeTracker(),
        cleanupTerminalIssueWorkspaces: async () => ({ removed: 0, failed: 0, warnings: [] }),
        processDueRetries: async () => ({
          processedIssueIds: [],
          dispatchedIssueIds: [],
          requeuedIssueIds: [],
          releasedIssueIds: [],
        }),
        runOrchestratorTick: async () => ({
          skippedDispatch: false,
          selectedIssueIds: [],
          dispatchedIssueIds: [],
          dispatchErrors: [],
          reconcileActions: [],
          stalledIssueIds: [],
        }),
        watchWorkflowFile: (_path: string, cb: () => void) => {
          watchCallbacks.push(cb);
          return {
            close: () => {},
          } as FSWatcher;
        },
      },
    });

    await service.start();
    expect(loadCount).toBe(1);

    const triggerWatchReload = watchCallbacks[0];
    if (!triggerWatchReload) {
      throw new Error("expected watch callback to be registered");
    }

    triggerWatchReload();
    triggerWatchReload();
    triggerWatchReload();
    await vi.advanceTimersByTimeAsync(99);
    expect(loadCount).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(loadCount).toBe(2);

    await service.stop();
    vi.useRealTimers();
  });
});
