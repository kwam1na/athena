import { mkdir, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { NormalizedIssue, TrackerClient } from "../src/issue";
import { cleanupTerminalIssueWorkspaces } from "../src/startup";
import { resolveWorkspaceLocation, type WorkspaceConfig } from "../src/workspace";

function issue(partial: Partial<NormalizedIssue>): NormalizedIssue {
  return {
    id: partial.id ?? "id",
    identifier: partial.identifier ?? "ATH-1",
    title: partial.title ?? "Issue title",
    state: partial.state ?? "Done",
    priority: partial.priority ?? null,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
    labels: partial.labels ?? [],
    blocked_by: partial.blocked_by ?? [],
  };
}

class FakeTracker implements TrackerClient {
  constructor(
    private readonly terminal: NormalizedIssue[] = [],
    private readonly failFetch = false,
  ) {}

  async fetchCandidateIssues(): Promise<NormalizedIssue[]> {
    return [];
  }

  async fetchIssuesByStates(): Promise<NormalizedIssue[]> {
    if (this.failFetch) {
      throw new Error("terminal fetch failed");
    }

    return this.terminal;
  }

  async fetchIssueStatesByIds(): Promise<NormalizedIssue[]> {
    return [];
  }
}

describe("cleanupTerminalIssueWorkspaces", () => {
  it("removes terminal issue workspaces at startup", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-startup-cleanup-"));

    const workspaceConfig: WorkspaceConfig = {
      root,
      hooks: {
        timeoutMs: 1000,
      },
    };

    const a = resolveWorkspaceLocation(root, "ATH-10");
    const b = resolveWorkspaceLocation(root, "ATH-11");
    await mkdir(a.path, { recursive: true });
    await mkdir(b.path, { recursive: true });

    const result = await cleanupTerminalIssueWorkspaces({
      tracker: new FakeTracker([issue({ identifier: "ATH-10" }), issue({ identifier: "ATH-11" })]),
      terminalStates: ["Done", "Closed"],
      workspace: workspaceConfig,
    });

    expect(result.removed).toBe(2);
    expect(result.failed).toBe(0);
    await expect(stat(a.path)).rejects.toThrowError();
    await expect(stat(b.path)).rejects.toThrowError();
  });

  it("logs and continues when terminal state fetch fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "symphony-startup-cleanup-fail-"));
    const warnings: string[] = [];

    const result = await cleanupTerminalIssueWorkspaces({
      tracker: new FakeTracker([], true),
      terminalStates: ["Done", "Closed"],
      workspace: {
        root,
        hooks: {
          timeoutMs: 1000,
        },
      },
      onLog: (entry) => {
        if (entry.level === "warn") {
          warnings.push(entry.message);
        }
      },
    });

    expect(result.removed).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.warnings.length).toBe(1);
    expect(warnings.length).toBe(1);
    expect(warnings[0]).toContain("failed to fetch terminal issues");
  });
});
