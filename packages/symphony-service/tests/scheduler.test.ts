import { describe, expect, it } from "vitest";
import { isIssueDispatchEligible, sortIssuesForDispatch } from "../src/scheduler";
import type { NormalizedIssue } from "../src/issue";

function makeIssue(partial: Partial<NormalizedIssue>): NormalizedIssue {
  return {
    id: partial.id ?? "1",
    identifier: partial.identifier ?? "ATH-1",
    title: partial.title ?? "title",
    state: partial.state ?? "Todo",
    priority: partial.priority ?? null,
    created_at: partial.created_at ?? "2026-01-01T00:00:00.000Z",
    updated_at: partial.updated_at ?? "2026-01-01T00:00:00.000Z",
    labels: partial.labels ?? [],
    blocked_by: partial.blocked_by ?? [],
  };
}

describe("sortIssuesForDispatch", () => {
  it("sorts by priority, created_at, then identifier", () => {
    const sorted = sortIssuesForDispatch([
      makeIssue({ identifier: "ATH-3", priority: 2, created_at: "2026-01-03T00:00:00.000Z" }),
      makeIssue({ identifier: "ATH-2", priority: 1, created_at: "2026-01-04T00:00:00.000Z" }),
      makeIssue({ identifier: "ATH-1", priority: 1, created_at: "2026-01-02T00:00:00.000Z" }),
    ]);

    expect(sorted.map((issue) => issue.identifier)).toEqual(["ATH-1", "ATH-2", "ATH-3"]);
  });
});

describe("isIssueDispatchEligible", () => {
  const activeStates = new Set(["Todo", "In Progress"]);
  const terminalStates = new Set(["Done", "Closed"]);

  it("rejects Todo issues with non-terminal blockers", () => {
    const eligible = isIssueDispatchEligible(
      makeIssue({
        state: "Todo",
        blocked_by: [{ id: "2", identifier: "ATH-2", state: "In Progress" }],
      }),
      {
        activeStates,
        terminalStates,
        claimedIssueIds: new Set(),
        runningIssueIds: new Set(),
      },
    );

    expect(eligible).toBe(false);
  });

  it("accepts Todo issues with terminal blockers", () => {
    const eligible = isIssueDispatchEligible(
      makeIssue({
        state: "Todo",
        blocked_by: [{ id: "2", identifier: "ATH-2", state: "Done" }],
      }),
      {
        activeStates,
        terminalStates,
        claimedIssueIds: new Set(),
        runningIssueIds: new Set(),
      },
    );

    expect(eligible).toBe(true);
  });

  it("rejects issues already claimed", () => {
    const eligible = isIssueDispatchEligible(makeIssue({ id: "x", state: "In Progress" }), {
      activeStates,
      terminalStates,
      claimedIssueIds: new Set(["x"]),
      runningIssueIds: new Set(),
    });

    expect(eligible).toBe(false);
  });
});
