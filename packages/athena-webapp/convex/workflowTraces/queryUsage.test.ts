import { describe, expect, it, vi } from "vitest";

const authMock = vi.hoisted(() => ({
  getAuthUserId: vi.fn(),
}));

vi.mock("@convex-dev/auth/server", () => ({
  getAuthUserId: authMock.getAuthUserId,
}));

import type { Id } from "../_generated/dataModel";
import {
  appendWorkflowTraceEventWithCtx,
  createWorkflowTraceWithCtx,
  registerWorkflowTraceLookupWithCtx,
} from "./core";
import {
  getWorkflowTraceViewByIdWithCtx,
  getWorkflowTraceViewByLookupWithCtx,
} from "./public";
import type { WorkflowTraceAccessAuthorizer } from "./public";

type WorkflowTraceDoc = {
  _id: string;
  _creationTime: number;
  storeId: Id<"store">;
  organizationId?: Id<"organization">;
  traceId: string;
  workflowType: string;
  title: string;
  status: string;
  health: string;
  startedAt: number;
  completedAt?: number;
  primaryLookupType: string;
  primaryLookupValue: string;
  primarySubjectType?: string;
  primarySubjectId?: string;
  summary?: string;
};

type WorkflowTraceEventDoc = {
  _id: string;
  _creationTime: number;
  storeId: Id<"store">;
  traceId: string;
  workflowType: string;
  sequence: number;
  kind: string;
  step: string;
  status: string;
  message: string;
  occurredAt: number;
  details?: Record<string, unknown>;
  source: string;
  subjectRefs?: Record<string, string>;
  actorRefs?: Record<string, string>;
  eventKey?: string;
};

type WorkflowTraceLookupDoc = {
  _id: string;
  _creationTime: number;
  storeId: Id<"store">;
  workflowType: string;
  lookupType: string;
  lookupValue: string;
  traceId: string;
};

type WorkflowTraceTables = {
  workflowTrace: WorkflowTraceDoc[];
  workflowTraceEvent: WorkflowTraceEventDoc[];
  workflowTraceLookup: WorkflowTraceLookupDoc[];
};

const INDEX_FIELDS = {
  workflowTrace: {
    by_storeId_traceId: ["storeId", "traceId"],
  },
  workflowTraceEvent: {
    by_storeId_traceId_sequence: ["storeId", "traceId", "sequence"],
    by_storeId_traceId_eventKey: ["storeId", "traceId", "eventKey"],
  },
  workflowTraceLookup: {
    by_storeId_workflowType_lookup: [
      "storeId",
      "workflowType",
      "lookupType",
      "lookupValue",
    ],
  },
} as const;

function compareByFields(
  fields: readonly string[],
  left: Record<string, unknown>,
  right: Record<string, unknown>,
) {
  for (const field of fields) {
    if (left[field] === right[field]) {
      continue;
    }

    return left[field]! < right[field]! ? -1 : 1;
  }

  return 0;
}

function createTestCtx(seed?: Partial<WorkflowTraceTables>) {
  const tables: WorkflowTraceTables = {
    workflowTrace: [...(seed?.workflowTrace ?? [])],
    workflowTraceEvent: [...(seed?.workflowTraceEvent ?? [])],
    workflowTraceLookup: [...(seed?.workflowTraceLookup ?? [])],
  };
  let idCounter = 100;

  const db = {
    insert(tableName: keyof WorkflowTraceTables, value: Record<string, unknown>) {
      idCounter += 1;
      const row = {
        _id: `${tableName}:${idCounter}`,
        _creationTime: idCounter,
        ...value,
      } as WorkflowTraceDoc & WorkflowTraceEventDoc & WorkflowTraceLookupDoc;
      tables[tableName].push(row as never);
      return Promise.resolve(row._id);
    },
    patch(
      tableOrId: keyof WorkflowTraceTables | string,
      idOrValue: string | Record<string, unknown>,
      maybeValue?: Record<string, unknown>,
    ) {
      const tableNames =
        maybeValue && tableOrId in tables
          ? [tableOrId as keyof WorkflowTraceTables]
          : (Object.keys(tables) as Array<keyof WorkflowTraceTables>);
      const id = (maybeValue ? idOrValue : tableOrId) as string;
      const value = (maybeValue ?? idOrValue) as Record<string, unknown>;

      for (const tableName of tableNames) {
        const row = tables[tableName].find((entry) => entry._id === id);

        if (row) {
          Object.assign(row, value);
          return Promise.resolve();
        }
      }

      throw new Error(`Unknown row ${id}`);
    },
    query(tableName: keyof WorkflowTraceTables) {
      return {
        withIndex(
          indexName: string,
          apply: (builder: { eq(field: string, value: unknown): typeof builder }) => void,
        ) {
          const filters: Array<{ field: string; value: unknown }> = [];
          const builder = {
            eq(field: string, value: unknown) {
              filters.push({ field, value });
              return builder;
            },
          };

          apply(builder);

          const rows = tables[tableName]
            .filter((row) =>
              filters.every((filter) => row[filter.field as keyof typeof row] === filter.value)
            )
            .sort((left, right) =>
              compareByFields(
                INDEX_FIELDS[tableName][
                  indexName as keyof (typeof INDEX_FIELDS)[typeof tableName]
                ] ?? [],
                left,
                right,
              ),
            );

          return {
            collect: async () => rows,
            first: async () => rows[0] ?? null,
            unique: async () => rows[0] ?? null,
            order(direction: "asc" | "desc") {
              const ordered = direction === "desc" ? [...rows].reverse() : rows;
              return {
                first: async () => ordered[0] ?? null,
              };
            },
          };
        },
      };
    },
  };

  return { db, tables };
}

function createAdminTraceReadCtx(
  seed?: Partial<WorkflowTraceTables>,
  role = "full_admin",
) {
  const ctx = createTestCtx(seed);
  const baseQuery = ctx.db.query.bind(ctx.db);
  const db = {
    ...ctx.db,
    get: async (tableName: string, id: string) => {
      if (tableName === "users" && id === "auth-user-1") {
        return { _id: id, email: "manager@example.com" };
      }

      if (tableName === "store" && id === "store-a") {
        return { _id: id, organizationId: "org-1" };
      }

      return null;
    },
    query(tableName: string) {
      if (tableName === "athenaUser") {
        return {
          filter: () => ({
            first: async () => ({
              _id: "athena-user-1",
              email: "manager@example.com",
            }),
          }),
        };
      }

      if (tableName === "organizationMember") {
        return {
          filter: () => ({
            first: async () => ({
              _id: "member-1",
              organizationId: "org-1",
              role,
              userId: "athena-user-1",
            }),
          }),
        };
      }

      return baseQuery(tableName as keyof WorkflowTraceTables);
    },
  };

  return { ...ctx, db };
}

describe("workflow trace core and public helpers", () => {
  it("updates existing traces instead of duplicating the same store-scoped trace id", async () => {
    const storeId = "store-a" as Id<"store">;
    const ctx = createTestCtx();

    await createWorkflowTraceWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      title: "Repair order JOB-42",
      status: "started",
      health: "healthy",
      startedAt: 100,
      primaryLookupType: "reference_number",
      primaryLookupValue: " JOB-42 ",
    });

    await createWorkflowTraceWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      title: "Repair order JOB-42",
      status: "succeeded",
      health: "partial",
      startedAt: 100,
      completedAt: 200,
      primaryLookupType: "reference_number",
      primaryLookupValue: "JOB-42",
      summary: "Updated",
    });

    expect(ctx.tables.workflowTrace).toHaveLength(1);
    expect(ctx.tables.workflowTrace[0]?.health).toBe("partial");
    expect(ctx.tables.workflowTrace[0]?.primaryLookupValue).toBe("job-42");
  });

  it("uses store-scoped sequence assignment when appending events", async () => {
    const storeA = "store-a" as Id<"store">;
    const storeB = "store-b" as Id<"store">;
    const ctx = createTestCtx({
      workflowTraceEvent: [
        {
          _id: "event-1",
          _creationTime: 1,
          storeId: storeA,
          traceId: "repair_order:job-42",
          workflowType: "repair_order",
          sequence: 1,
          kind: "milestone",
          step: "workflow_started",
          status: "started",
          message: "Workflow started",
          occurredAt: 100,
          source: "workflow.shared",
        },
        {
          _id: "event-2",
          _creationTime: 2,
          storeId: storeB,
          traceId: "repair_order:job-42",
          workflowType: "repair_order",
          sequence: 9,
          kind: "milestone",
          step: "workflow_started",
          status: "started",
          message: "Other store workflow started",
          occurredAt: 110,
          source: "workflow.shared",
        },
      ],
    });

    const eventId = await appendWorkflowTraceEventWithCtx(ctx as never, {
      storeId: storeA,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      kind: "system_action",
      step: "repair_order_persisted",
      status: "succeeded",
      message: "Repair order persisted",
      occurredAt: 200,
      source: "workflow.shared",
    });

    const inserted = ctx.tables.workflowTraceEvent.find(
      (event) => event._id === eventId,
    );

    expect(inserted?.sequence).toBe(2);
  });

  it("skips replayed keyed events before assigning another sequence", async () => {
    const storeId = "store-a" as Id<"store">;
    const ctx = createTestCtx();

    const firstEventId = await appendWorkflowTraceEventWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      kind: "milestone",
      step: "repair_order_started",
      status: "started",
      message: "Repair order started",
      occurredAt: 100,
      source: "workflow.shared",
      eventKey: " Submission-123:Started ",
    });
    const replayedEventId = await appendWorkflowTraceEventWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      kind: "milestone",
      step: "repair_order_started",
      status: "started",
      message: "Repair order started again",
      occurredAt: 110,
      source: "workflow.shared",
      eventKey: "submission-123:started",
    });
    await appendWorkflowTraceEventWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      kind: "system_action",
      step: "repair_order_persisted",
      status: "succeeded",
      message: "Repair order persisted",
      occurredAt: 200,
      source: "workflow.shared",
    });

    expect(replayedEventId).toBe(firstEventId);
    expect(ctx.tables.workflowTraceEvent).toHaveLength(2);
    expect(ctx.tables.workflowTraceEvent.map((event) => event.sequence)).toEqual([
      1,
      2,
    ]);
    expect(ctx.tables.workflowTraceEvent[0]?.eventKey).toBe(
      "submission-123:started",
    );
    expect(ctx.tables.workflowTraceEvent[0]?.message).toBe(
      "Repair order started",
    );
  });

  it("rejects raw sensitive payload keys in trace and event details", async () => {
    const storeId = "store-a" as Id<"store">;
    const ctx = createTestCtx();

    await expect(
      createWorkflowTraceWithCtx(ctx as never, {
        storeId,
        traceId: "repair_order:job-42",
        workflowType: "repair_order",
        title: "Repair order JOB-42",
        status: "started",
        health: "healthy",
        startedAt: 100,
        primaryLookupType: "reference_number",
        primaryLookupValue: "JOB-42",
        details: {
          sourceRefs: {
            paymentId: "payment-1",
            rawProviderPayload: { authorization: "secret" },
          },
        },
      }),
    ).rejects.toThrow(
      "Workflow trace details must use refs or normalized summaries",
    );

    await expect(
      appendWorkflowTraceEventWithCtx(ctx as never, {
        storeId,
        traceId: "repair_order:job-42",
        workflowType: "repair_order",
        kind: "system_action",
        step: "payment_checked",
        status: "info",
        message: "Payment checked",
        occurredAt: 100,
        source: "workflow.shared",
        details: {
          customerEmail: "customer@example.com",
        },
      }),
    ).rejects.toThrow(
      "Workflow trace details must use refs or normalized summaries",
    );

    expect(ctx.tables.workflowTrace).toHaveLength(0);
    expect(ctx.tables.workflowTraceEvent).toHaveLength(0);
  });

  it("resolves trace views by id and normalized lookup value without leaking another store's events", async () => {
    const storeA = "store-a" as Id<"store">;
    const storeB = "store-b" as Id<"store">;
    const ctx = createTestCtx();
    const accessAuthorizers = {
      repair_order: async () => true,
    };

    await createWorkflowTraceWithCtx(ctx as never, {
      storeId: storeA,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      title: "Repair order JOB-42",
      status: "succeeded",
      health: "partial",
      startedAt: 100,
      primaryLookupType: "reference_number",
      primaryLookupValue: "JOB-42",
    });
    await createWorkflowTraceWithCtx(ctx as never, {
      storeId: storeB,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      title: "Repair order JOB-42 other store",
      status: "started",
      health: "healthy",
      startedAt: 100,
      primaryLookupType: "reference_number",
      primaryLookupValue: "JOB-42",
    });
    await registerWorkflowTraceLookupWithCtx(ctx as never, {
      storeId: storeA,
      workflowType: "repair_order",
      lookupType: "reference_number",
      lookupValue: " JOB-42 ",
      traceId: "repair_order:job-42",
    });
    await appendWorkflowTraceEventWithCtx(ctx as never, {
      storeId: storeA,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      kind: "milestone",
      step: "workflow_started",
      status: "started",
      message: "Workflow started",
      occurredAt: 100,
      source: "workflow.shared",
    });
    await appendWorkflowTraceEventWithCtx(ctx as never, {
      storeId: storeA,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      kind: "system_action",
      step: "repair_order_persisted",
      status: "succeeded",
      message: "Repair order persisted",
      occurredAt: 200,
      source: "workflow.shared",
    });
    await appendWorkflowTraceEventWithCtx(ctx as never, {
      storeId: storeB,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      kind: "system_action",
      step: "other_store_event",
      status: "info",
      message: "Other store event",
      occurredAt: 150,
      source: "workflow.shared",
    });

    const byLookup = await getWorkflowTraceViewByLookupWithCtx(ctx as never, {
      storeId: storeA,
      workflowType: "repair_order",
      lookupType: "reference_number",
      lookupValue: " job-42 ",
      accessAuthorizers,
    });
    const byId = await getWorkflowTraceViewByIdWithCtx(ctx as never, {
      storeId: storeA,
      traceId: "repair_order:job-42",
      accessAuthorizers,
    });

    expect(byLookup?.header.traceId).toBe("repair_order:job-42");
    expect(byLookup?.events.map((event) => event.message)).toEqual([
      "Workflow started",
      "Repair order persisted",
    ]);
    expect(byId?.events.map((event) => event.message)).toEqual([
      "Workflow started",
      "Repair order persisted",
    ]);
  });

  it("allows default trace reads for full-admin members", async () => {
    authMock.getAuthUserId.mockResolvedValue("auth-user-1");
    const storeId = "store-a" as Id<"store">;
    const ctx = createAdminTraceReadCtx();

    await createWorkflowTraceWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      title: "Repair order JOB-42",
      status: "started",
      health: "healthy",
      startedAt: 100,
      primaryLookupType: "reference_number",
      primaryLookupValue: "JOB-42",
    });
    await registerWorkflowTraceLookupWithCtx(ctx as never, {
      storeId,
      workflowType: "repair_order",
      lookupType: "reference_number",
      lookupValue: "JOB-42",
      traceId: "repair_order:job-42",
    });

    await expect(
      getWorkflowTraceViewByIdWithCtx(ctx as never, {
        storeId,
        traceId: "repair_order:job-42",
      }),
    ).resolves.toMatchObject({
      header: {
        traceId: "repair_order:job-42",
      },
    });
    await expect(
      getWorkflowTraceViewByLookupWithCtx(ctx as never, {
        storeId,
        workflowType: "repair_order",
        lookupType: "reference_number",
        lookupValue: "JOB-42",
      }),
    ).resolves.toMatchObject({
      header: {
        traceId: "repair_order:job-42",
      },
    });
  });

  it("does not allow default trace reads before store authorization", async () => {
    authMock.getAuthUserId.mockResolvedValue(null);
    const storeId = "store-a" as Id<"store">;
    const ctx = createTestCtx();

    await createWorkflowTraceWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      title: "Repair order JOB-42",
      status: "started",
      health: "healthy",
      startedAt: 100,
      primaryLookupType: "reference_number",
      primaryLookupValue: "JOB-42",
    });

    await expect(
      getWorkflowTraceViewByIdWithCtx(ctx as never, {
        storeId,
        traceId: "repair_order:job-42",
      }),
    ).rejects.toThrow("Authentication required.");
    await expect(
      getWorkflowTraceViewByIdWithCtx(ctx as never, {
        storeId,
        traceId: "repair_order:missing",
      }),
    ).rejects.toThrow("Authentication required.");
    await expect(
      getWorkflowTraceViewByLookupWithCtx(ctx as never, {
        storeId,
        workflowType: "repair_order",
        lookupType: "reference_number",
        lookupValue: "MISSING",
      }),
    ).rejects.toThrow("Authentication required.");
  });

  it("does not allow default trace reads for signed-in non-admin members", async () => {
    authMock.getAuthUserId.mockResolvedValue("auth-user-1");
    const storeId = "store-a" as Id<"store">;
    const ctx = createAdminTraceReadCtx(undefined, "inventory_manager");

    await createWorkflowTraceWithCtx(ctx as never, {
      storeId,
      traceId: "repair_order:job-42",
      workflowType: "repair_order",
      title: "Repair order JOB-42",
      status: "started",
      health: "healthy",
      startedAt: 100,
      primaryLookupType: "reference_number",
      primaryLookupValue: "JOB-42",
    });
    await registerWorkflowTraceLookupWithCtx(ctx as never, {
      storeId,
      workflowType: "repair_order",
      lookupType: "reference_number",
      lookupValue: "JOB-42",
      traceId: "repair_order:job-42",
    });

    await expect(
      getWorkflowTraceViewByIdWithCtx(ctx as never, {
        storeId,
        traceId: "repair_order:job-42",
      }),
    ).rejects.toThrow("Only full admins can access stock operations.");
    await expect(
      getWorkflowTraceViewByLookupWithCtx(ctx as never, {
        storeId,
        workflowType: "repair_order",
        lookupType: "reference_number",
        lookupValue: "JOB-42",
      }),
    ).rejects.toThrow("Only full admins can access stock operations.");
  });

  it("routes lookup reads through the same workflow authorizer as direct trace reads", async () => {
    const storeId = "store-a" as Id<"store">;
    const ctx = createTestCtx();
    const deniedAuthorizer: WorkflowTraceAccessAuthorizer = async () => false;

    await createWorkflowTraceWithCtx(ctx as never, {
      storeId,
      traceId: "sensitive_workflow:case-42",
      workflowType: "sensitive_workflow",
      title: "Sensitive workflow CASE-42",
      status: "started",
      health: "healthy",
      startedAt: 100,
      primaryLookupType: "case_number",
      primaryLookupValue: "CASE-42",
      primarySubjectType: "service_case",
      primarySubjectId: "service-case-42",
    });
    await registerWorkflowTraceLookupWithCtx(ctx as never, {
      storeId,
      workflowType: "sensitive_workflow",
      lookupType: "case_number",
      lookupValue: "CASE-42",
      traceId: "sensitive_workflow:case-42",
    });

    const accessAuthorizers = {
      sensitive_workflow: deniedAuthorizer,
    };

    await expect(
      getWorkflowTraceViewByIdWithCtx(ctx as never, {
        storeId,
        traceId: "sensitive_workflow:case-42",
        accessAuthorizers,
      }),
    ).rejects.toThrow("Workflow trace access denied.");
    await expect(
      getWorkflowTraceViewByLookupWithCtx(ctx as never, {
        storeId,
        workflowType: "sensitive_workflow",
        lookupType: "case_number",
        lookupValue: "CASE-42",
        accessAuthorizers,
      }),
    ).rejects.toThrow("Workflow trace access denied.");
  });
});
