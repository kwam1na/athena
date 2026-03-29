import { describe, expect, it } from "vitest";
import { SymphonyError } from "../src/errors";
import { LinearTrackerClient } from "../src/tracker/linear";

function makeFetch(responses: unknown[]) {
  const calls: Array<{ body: Record<string, unknown> }> = [];
  const fetchMock = (async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    calls.push({ body });

    const next = responses.shift();
    if (!next) {
      throw new Error("no mock response remaining");
    }

    return {
      ok: true,
      status: 200,
      async json() {
        return next;
      },
    } as Response;
  }) as typeof fetch;

  return { fetchMock, calls };
}

function clientWith(fetchImpl: typeof fetch) {
  return new LinearTrackerClient({
    endpoint: "https://api.linear.app/graphql",
    apiKey: "token",
    projectSlug: "ATH",
    activeStates: ["Todo", "In Progress"],
    fetchImpl,
  });
}

describe("LinearTrackerClient", () => {
  it("paginates candidate issues", async () => {
    const { fetchMock, calls } = makeFetch([
      {
        data: {
          issues: {
            nodes: [
              {
                id: "1",
                identifier: "ATH-1",
                title: "first",
                priority: 1,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                state: { name: "Todo" },
                labels: { nodes: [{ name: "Bug" }] },
                relations: { nodes: [] },
              },
            ],
            pageInfo: { hasNextPage: true, endCursor: "cursor-1" },
          },
        },
      },
      {
        data: {
          issues: {
            nodes: [
              {
                id: "2",
                identifier: "ATH-2",
                title: "second",
                priority: 2,
                createdAt: "2026-01-02T00:00:00Z",
                updatedAt: "2026-01-02T00:00:00Z",
                state: { name: "In Progress" },
                labels: { nodes: [{ name: "Ops" }] },
                relations: {
                  nodes: [
                    {
                      type: "blocks",
                      relatedIssue: {
                        id: "3",
                        identifier: "ATH-3",
                        state: { name: "Done" },
                      },
                    },
                  ],
                },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    ]);

    const issues = await clientWith(fetchMock).fetchCandidateIssues();
    expect(issues.map((issue) => issue.identifier)).toEqual(["ATH-1", "ATH-2"]);
    expect(issues[0]?.labels).toEqual(["bug"]);
    expect(issues[1]?.blocked_by).toEqual([{ id: "3", identifier: "ATH-3", state: "Done" }]);
    expect(calls).toHaveLength(2);
    expect(calls[1]?.body?.variables).toMatchObject({ after: "cursor-1" });
  });

  it("returns empty for fetchIssuesByStates([]) without API call", async () => {
    const { fetchMock, calls } = makeFetch([]);
    const issues = await clientWith(fetchMock).fetchIssuesByStates([]);
    expect(issues).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("throws linear_graphql_errors on GraphQL errors", async () => {
    const { fetchMock } = makeFetch([{ errors: [{ message: "bad query" }] }]);

    await expect(clientWith(fetchMock).fetchCandidateIssues()).rejects.toMatchObject({
      code: "linear_graphql_errors",
    });
  });

  it("throws linear_missing_end_cursor when pagination cursor is missing", async () => {
    const { fetchMock } = makeFetch([
      {
        data: {
          issues: {
            nodes: [],
            pageInfo: { hasNextPage: true, endCursor: null },
          },
        },
      },
    ]);

    await expect(clientWith(fetchMock).fetchCandidateIssues()).rejects.toMatchObject({
      code: "linear_missing_end_cursor",
    });
  });

  it("fetches issue states by ids using GraphQL ID list variable", async () => {
    const { fetchMock, calls } = makeFetch([
      {
        data: {
          issues: {
            nodes: [
              {
                id: "10",
                identifier: "ATH-10",
                title: "state check",
                priority: 1,
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-01-01T00:00:00Z",
                state: { name: "In Progress" },
                labels: { nodes: [] },
                relations: { nodes: [] },
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      },
    ]);

    const issues = await clientWith(fetchMock).fetchIssueStatesByIds(["10"]);
    expect(issues).toHaveLength(1);
    expect((calls[0]?.body?.variables as Record<string, unknown>)?.issueIds).toEqual(["10"]);
  });

  it("surfaces invalid payload errors with typed SymphonyError", async () => {
    const { fetchMock } = makeFetch([{ data: { notIssues: {} } }]);

    try {
      await clientWith(fetchMock).fetchCandidateIssues();
      throw new Error("expected failure");
    } catch (error) {
      expect(error).toBeInstanceOf(SymphonyError);
      expect((error as SymphonyError).code).toBe("linear_unknown_payload");
    }
  });
});
