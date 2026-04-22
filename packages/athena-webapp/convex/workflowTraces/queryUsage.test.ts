import { describe, expect, it } from "vitest";

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
    patch(id: string, value: Record<string, unknown>) {
      for (const tableName of Object.keys(tables) as Array<
        keyof WorkflowTraceTables
      >) {
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

  it("resolves trace views by id and normalized lookup value without leaking another store's events", async () => {
    const storeA = "store-a" as Id<"store">;
    const storeB = "store-b" as Id<"store">;
    const ctx = createTestCtx();

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
    });
    const byId = await getWorkflowTraceViewByIdWithCtx(ctx as never, {
      storeId: storeA,
      traceId: "repair_order:job-42",
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
});
