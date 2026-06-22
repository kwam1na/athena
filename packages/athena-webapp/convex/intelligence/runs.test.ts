import { describe, expect, it, vi } from "vitest";

import {
  buildLatestRunDebugPayload,
  ensureRun,
  getLatestDebugRunBySubject,
  INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS,
  INTELLIGENCE_RUNNING_RUN_STALE_AFTER_MS,
  isActiveRunStale,
  selectActiveRunForIdempotency,
  selectLatestDebugRunFromCandidates,
  shouldSupersedeArtifact,
  shouldRecoverActiveRun,
  recordProviderInvocation,
  updateProviderInvocation,
} from "./runs";

describe("intelligence artifact superseding", () => {
  it("only supersedes the same subject stream for subject-scoped artifacts", () => {
    const next = {
      kind: "user_insights",
      subjectTable: "storeFrontActor",
      subjectId: "customer-1",
    } as const;

    expect(
      shouldSupersedeArtifact(
        {
          kind: "user_insights",
          subjectTable: "storeFrontActor",
          subjectId: "customer-1",
        },
        next,
      ),
    ).toBe(true);

    expect(
      shouldSupersedeArtifact(
        {
          kind: "user_insights",
          subjectTable: "storeFrontActor",
          subjectId: "customer-2",
        },
        next,
      ),
    ).toBe(false);
  });

  it("allows broad superseding only for artifacts without a subject", () => {
    expect(
      shouldSupersedeArtifact(
        {
          kind: "store_insights",
          subjectTable: "store",
          subjectId: "store-1",
        },
        {
          kind: "store_insights",
          subjectTable: undefined,
          subjectId: undefined,
        },
      ),
    ).toBe(true);
  });
});

describe("intelligence active run recovery", () => {
  it("treats old queued runs as stale so they do not block explicit reruns", () => {
    const now = 1_000_000;

    expect(
      isActiveRunStale(
        {
          createdAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
          status: "queued",
          updatedAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
        },
        now,
      ),
    ).toBe(true);
  });

  it("keeps running provider calls active until the provider timeout window passes", () => {
    const now = 1_000_000;

    expect(
      isActiveRunStale(
        {
          createdAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
          status: "running",
          updatedAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
        },
        now,
      ),
    ).toBe(false);

    expect(
      isActiveRunStale(
        {
          createdAt: now - INTELLIGENCE_RUNNING_RUN_STALE_AFTER_MS - 1,
          status: "running",
          updatedAt: now - INTELLIGENCE_RUNNING_RUN_STALE_AFTER_MS - 1,
        },
        now,
      ),
    ).toBe(true);
  });

  it("keeps fresh active and terminal runs from stale recovery", () => {
    const now = 1_000_000;

    expect(
      isActiveRunStale(
        {
          createdAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
          status: "running",
          updatedAt: now - 10_000,
        },
        now,
      ),
    ).toBe(false);
    expect(
      isActiveRunStale(
        {
          createdAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
          status: "failed",
          updatedAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it("selects the newest active idempotency run and ignores terminal history", () => {
    expect(
      selectActiveRunForIdempotency([
        {
          createdAt: 30,
          status: "failed",
        },
        {
          createdAt: 20,
          status: "queued",
        },
        {
          createdAt: 40,
          status: "completed",
        },
        {
          createdAt: 10,
          status: "running",
        },
      ] as any[]),
    ).toEqual({
      createdAt: 20,
      status: "queued",
    });
  });

  it("only recovers active runs after their status-specific stale window", () => {
    const now = 1_000_000;

    expect(
      shouldRecoverActiveRun(
        {
          createdAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
          status: "context_captured",
          updatedAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
        },
        now,
      ),
    ).toBe(true);
    expect(
      shouldRecoverActiveRun(
        {
          createdAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
          status: "running",
          updatedAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
        },
        now,
      ),
    ).toBe(false);
  });

  it("marks a stale active idempotency run failed before creating the replacement run", async () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const staleRun = {
      _id: "run-stale",
      createdAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
      status: "context_captured",
      updatedAt: now - INTELLIGENCE_ACTIVE_RUN_STALE_AFTER_MS - 1,
    };
    const insert = vi.fn(async () => "run-next");
    const patch = vi.fn(async () => undefined);
    const ctx = {
      db: {
        insert,
        patch,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => [staleRun]),
          })),
        })),
      },
    };

    await expect(
      getHandler(ensureRun)(ctx, baseEnsureRunArgs()),
    ).resolves.toBe("run-next");

    expect(patch).toHaveBeenCalledWith("intelligenceRun", "run-stale", {
      status: "failed",
      updatedAt: now,
      completedAt: now,
      error: {
        code: "stale_active_run",
        message: "The previous intelligence run did not finish.",
        retryable: true,
      },
    });
    expect(insert).toHaveBeenCalledWith(
      "intelligenceRun",
      expect.objectContaining({
        attemptCount: 1,
        status: "queued",
        updatedAt: now,
      }),
    );
  });

  it("keeps a fresh active idempotency run from creating a replacement run", async () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const insert = vi.fn(async () => "run-next");
    const ctx = {
      db: {
        insert,
        query: vi.fn(() => ({
          withIndex: vi.fn(() => ({
            collect: vi.fn(async () => [
              {
                _id: "run-active",
                createdAt: now - 1_000,
                status: "running",
                updatedAt: now - 1_000,
              },
            ]),
          })),
        })),
      },
    };

    await expect(getHandler(ensureRun)(ctx, baseEnsureRunArgs())).rejects.toThrow(
      "An Athena insight is already being generated for this context.",
    );
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("intelligence debug run selection", () => {
  it("uses debug subject fields before falling back to legacy source refs", () => {
    expect(
      selectLatestDebugRunFromCandidates(
        [
          {
            createdAt: 20,
            debugSubjectId: "customer-2",
            debugSubjectTable: "storeFrontActor",
            sourceRefs: [{ table: "storeFrontActor", id: "customer-1" }],
          },
          {
            createdAt: 10,
            debugSubjectId: "customer-1",
            debugSubjectTable: "storeFrontActor",
            sourceRefs: [],
          },
        ] as any[],
        {
          sourceRefTable: "storeFrontActor",
          sourceRefId: "customer-1",
        },
      ),
    ).toEqual({
      createdAt: 10,
      debugSubjectId: "customer-1",
      debugSubjectTable: "storeFrontActor",
      sourceRefs: [],
    });
  });

  it("returns the newest run when no subject scope is requested", () => {
    expect(
      selectLatestDebugRunFromCandidates([
        { createdAt: 10, sourceRefs: [] },
        { createdAt: 30, sourceRefs: [] },
        { createdAt: 20, sourceRefs: [] },
      ] as any[]),
    ).toEqual({ createdAt: 30, sourceRefs: [] });
  });

  it("uses the indexed debug subject path before the bounded fallback", async () => {
    const indexedRun = {
      _id: "run-indexed",
      createdAt: 30,
      debugSubjectId: "customer-1",
      debugSubjectTable: "storeFrontActor",
      sourceRefs: [],
    };
    const take = vi.fn(async () => []);
    const first = vi.fn(async () => indexedRun);
    const queryRecorder = createDebugQueryRecorder({ first, take });
    const ctx = { db: { query: queryRecorder.query } };

    await expect(
      getLatestDebugRunBySubject(ctx as any, {
        storeId: "store-1" as any,
        capability: "storeInsights:v1",
        sourceRefTable: "storeFrontActor",
        sourceRefId: "customer-1",
      }),
    ).resolves.toBe(indexedRun);

    expect(first).toHaveBeenCalled();
    expect(take).not.toHaveBeenCalled();
    expect(queryRecorder.calls).toEqual([
      {
        eqs: [
          ["storeId", "store-1"],
          ["capability", "storeInsights:v1"],
          ["debugSubjectTable", "storeFrontActor"],
          ["debugSubjectId", "customer-1"],
        ],
        indexName: "by_storeId_capability_debugSubject_createdAt",
        table: "intelligenceRun",
      },
    ]);
  });

  it("falls back to bounded capability history for legacy source refs", async () => {
    const first = vi.fn(async () => null);
    const take = vi
      .fn()
      .mockResolvedValueOnce([
        {
          _id: "run-legacy-old",
          createdAt: 10,
          sourceRefs: [{ table: "storeFrontActor", id: "customer-1" }],
        },
      ])
      .mockResolvedValueOnce([
        {
          _id: "run-other-subject",
          createdAt: 40,
          sourceRefs: [{ table: "storeFrontActor", id: "customer-2" }],
        },
      ])
      .mockResolvedValue([]);
    const queryRecorder = createDebugQueryRecorder({ first, take });
    const ctx = { db: { query: queryRecorder.query } };

    await expect(
      getLatestDebugRunBySubject(ctx as any, {
        storeId: "store-1" as any,
        capability: "storeInsights:v1",
        sourceRefTable: "storeFrontActor",
        sourceRefId: "customer-1",
      }),
    ).resolves.toMatchObject({ _id: "run-legacy-old" });

    expect(take).toHaveBeenCalled();
    expect(queryRecorder.calls).toEqual([
      {
        eqs: [
          ["storeId", "store-1"],
          ["capability", "storeInsights:v1"],
          ["debugSubjectTable", "storeFrontActor"],
          ["debugSubjectId", "customer-1"],
        ],
        indexName: "by_storeId_capability_debugSubject_createdAt",
        table: "intelligenceRun",
      },
      ...[
        "running",
        "context_captured",
        "queued",
        "failed",
        "completed",
        "canceled",
      ].map((status) => ({
        eqs: [
          ["storeId", "store-1"],
          ["capability", "storeInsights:v1"],
          ["status", status],
        ],
        indexName: "by_storeId_capability_status",
        table: "intelligenceRun",
      })),
    ]);
  });

  it("returns allowlisted debug summaries with sanitized diagnostics but no raw payloads", () => {
    const payload = buildLatestRunDebugPayload({
      run: {
        _id: "run-1",
        artifactId: "artifact-1",
        attemptCount: 1,
        capability: "storeInsights:v1",
        completedAt: 20,
        contextSnapshotId: "snapshot-1",
        createdAt: 10,
        error: {
          code: "provider_failure",
          diagnostic: "Cannot find module @tanstack/ai",
          message: "The intelligence provider could not complete the request.",
          retryable: true,
        },
        idempotencyKey: "storeInsights:1",
        providerKey: "tanstack-openai",
        providerModel: "gpt-4.1-mini",
        snapshotHash: "hash-1",
        sourceRefs: [],
        status: "failed",
        trigger: "operator",
        updatedAt: 20,
        visibilityMode: "operator_private",
      } as any,
      snapshot: {
        _id: "snapshot-1",
        createdAt: 11,
        payloadRedaction: "user contact omitted",
        payloadSummary: {
          compactAnalytics: [{ action: "viewed" }],
          nested: { hidden: "detail" },
        },
        snapshotHash: "hash-1",
        sourceRefs: [{ table: "store", id: "store-1" }],
      } as any,
      artifact: {
        _id: "artifact-1",
        confidence: 0.7,
        createdAt: 12,
        evidenceRefs: [
          { table: "storeFrontAnalytics", id: "event-1" },
          { table: "storeFrontAnalytics", id: "event-2" },
        ],
        limitedEvidence: true,
        status: "ready",
        summary: "Traffic changed.",
        title: "Review current storefront activity",
        updatedAt: 13,
      } as any,
      providerInvocations: [
        {
          _id: "invocation-1",
          completedAt: 16,
          error: {
            code: "provider_failure",
            diagnostic: "OpenAI rejected key [redacted]",
            message: "The intelligence provider could not complete the request.",
            retryable: true,
          },
          providerKey: "tanstack-openai",
          providerModel: "gpt-4.1-mini",
          rawPayloadStored: false,
          requestSummary: { prompt: "raw prompt", rows: [{ id: 1 }] },
          responseSummary: { response: { recommendation: "Follow up" } },
          startedAt: 15,
          status: "failed",
        } as any,
      ],
    });

    expect(payload.run.error).toEqual({
      code: "provider_failure",
      diagnostic: "Cannot find module @tanstack/ai",
      message: "The intelligence provider could not complete the request.",
      retryable: true,
    });
    expect(payload.snapshot?.sourceRefCount).toBe(1);
    expect(payload.snapshot?.payloadSummary).toEqual({
      compactAnalytics: { type: "array", count: 1 },
      nested: { type: "object", keys: ["hidden"] },
    });
    expect(payload.artifact?.evidenceCount).toBe(2);
    expect(payload.providerInvocations[0]?.error).toEqual({
      code: "provider_failure",
      diagnostic: "OpenAI rejected key [redacted]",
      message: "The intelligence provider could not complete the request.",
      retryable: true,
    });
    expect(payload.providerInvocations[0]?.requestSummary).toEqual({
      prompt: "raw prompt",
      rows: { type: "array", count: 1 },
    });
  });
});

describe("intelligence provider invocation lifecycle", () => {
  it("records started invocations without completion time and patches terminal status", async () => {
    const now = 1_000_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const insert = vi.fn(async () => "invocation-1");
    const patch = vi.fn(async () => undefined);
    const ctx = {
      db: {
        get: vi.fn(async () => ({
          _id: "run-1",
          capability: "storeInsights:v1",
          organizationId: "org-1",
          storeId: "store-1",
        })),
        insert,
        patch,
      },
    };

    await expect(
      getHandler(recordProviderInvocation)(ctx, {
        runId: "run-1",
        contextSnapshotId: "snapshot-1",
        providerKey: "tanstack-openai",
        providerModel: "gpt-4.1-mini",
        status: "started",
        requestSummary: {
          schema: "StoreInsights",
          promptCharacters: 1200,
        },
        rawPayloadStored: false,
      }),
    ).resolves.toBe("invocation-1");

    expect(insert).toHaveBeenCalledWith(
      "intelligenceProviderInvocation",
      expect.objectContaining({
        completedAt: undefined,
        requestSummary: {
          schema: "StoreInsights",
          promptCharacters: 1200,
        },
        startedAt: now,
        status: "started",
      }),
    );

    await getHandler(updateProviderInvocation)(ctx, {
      invocationId: "invocation-1",
      providerModel: "gpt-4.1-mini",
      status: "succeeded",
      responseSummary: {
        outputKeys: ["summary"],
      },
      rawPayloadStored: false,
    });

    expect(patch).toHaveBeenCalledWith(
      "intelligenceProviderInvocation",
      "invocation-1",
      {
        providerModel: "gpt-4.1-mini",
        status: "succeeded",
        responseSummary: {
          outputKeys: ["summary"],
        },
        rawPayloadStored: false,
        error: undefined,
        completedAt: now,
      },
    );
  });
});

function getHandler<T extends (...args: any[]) => any>(definition: unknown): T {
  return (definition as { _handler: T })._handler;
}

function baseEnsureRunArgs() {
  return {
    storeId: "store-1",
    organizationId: "org-1",
    capability: "storeInsights:v1",
    providerKey: "tanstack-openai",
    providerModel: "gpt-4.1-mini",
    idempotencyKey: "storeInsights:store-1",
    trigger: "operator",
    principalKind: "human",
    actorRef: "user-1",
    visibilityMode: "operator_private",
    sourceRefs: [{ table: "store", id: "store-1" }],
  };
}

function createDebugQueryRecorder({
  first,
  take,
}: {
  first: () => Promise<unknown>;
  take: () => Promise<unknown>;
}) {
  const calls: Array<{
    table: string;
    indexName: string;
    eqs: Array<[string, unknown]>;
  }> = [];
  const query = vi.fn((table: string) => ({
    withIndex: vi.fn((indexName: string, buildQuery: (q: unknown) => unknown) => {
      const eqs: Array<[string, unknown]> = [];
      const q = {
        eq(field: string, value: unknown) {
          eqs.push([field, value]);
          return q;
        },
      };

      buildQuery(q);
      calls.push({ table, indexName, eqs });

      return {
        order: vi.fn(() => ({
          first,
          take,
        })),
      };
    }),
  }));

  return { calls, query };
}
