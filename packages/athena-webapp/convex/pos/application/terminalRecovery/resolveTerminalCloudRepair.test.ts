import { describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import { buildTerminalCloudRepairPreconditionHash } from "./cloudRepairPolicy";
import { resolveTerminalCloudRepair } from "./resolveTerminalCloudRepair";

const now = 3_000_000;
const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;

describe("resolveTerminalCloudRepair", () => {
  it("resolves only conflicts whose safe preview precondition still matches", async () => {
    const conflict = buildConflict();
    const ctx = buildCtx({
      posLocalSyncConflict: [conflict],
      posLocalSyncEvent: [buildEvent()],
    });

    const result = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: buildTerminalCloudRepairPreconditionHash({
        safeConflictIds: [conflict._id],
        storeId,
        terminalId,
      }),
      now,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        preconditionHash: expect.any(String),
        resolvedConflictIds: [conflict._id],
        skippedConflictIds: [],
      },
    });
    expect(ctx.db.patch).toHaveBeenCalledWith("posLocalSyncConflict", conflict._id, {
      resolvedAt: now,
      resolvedByStaffProfileId: undefined,
      resolvedByUserId: "user-1",
      status: "resolved",
    });
  });

  it("stops without patching when the preview precondition drifted", async () => {
    const ctx = buildCtx({
      posLocalSyncConflict: [buildConflict()],
      posLocalSyncEvent: [buildEvent()],
    });

    const result = await resolveTerminalCloudRepair(ctx as never, {
      expectedPreconditionHash: "terminal-cloud-repair:stale",
      now,
      resolvedByUserId: "user-1" as Id<"athenaUser">,
      storeId,
      terminalId,
    });

    expect(result).toMatchObject({
      error: {
        code: "precondition_failed",
        metadata: {
          preconditionDrift: true,
        },
      },
      kind: "user_error",
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
  });
});

function buildCtx(seed: {
  posLocalSyncConflict: Array<Doc<"posLocalSyncConflict">>;
  posLocalSyncEvent: Array<Doc<"posLocalSyncEvent">>;
}) {
  return {
    db: {
      patch: vi.fn(async () => undefined),
      query: vi.fn((tableName: keyof typeof seed) =>
        buildQuery(seed[tableName] as Array<Record<string, unknown>>),
      ),
    },
  };
}

function buildQuery(rows: Array<Record<string, unknown>>) {
  let currentRows = [...rows];
  return {
    withIndex: vi.fn((_indexName: string, build: (q: {
      eq: (field: string, value: unknown) => unknown;
    }) => unknown) => {
      const q = {
        eq: vi.fn((field: string, value: unknown) => {
          currentRows = currentRows.filter((row) => row[field] === value);
          return q;
        }),
      };
      build(q);
      return {
        first: vi.fn(async () => currentRows[0] ?? null),
        take: vi.fn(async (count: number) => currentRows.slice(0, count)),
      };
    }),
  };
}

function buildConflict(
  overrides: Partial<Doc<"posLocalSyncConflict">> = {},
): Doc<"posLocalSyncConflict"> {
  return {
    _id: "conflict-1" as Id<"posLocalSyncConflict">,
    _creationTime: now - 20 * 60 * 1000,
    storeId,
    terminalId,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    sequence: 1,
    conflictType: "duplicate_local_id",
    status: "needs_review",
    summary: "Duplicate register-open attempt for an already opened drawer.",
    details: { reason: "duplicate_register_opened" },
    createdAt: now - 20 * 60 * 1000,
    ...overrides,
  } as Doc<"posLocalSyncConflict">;
}

function buildEvent(
  overrides: Partial<Doc<"posLocalSyncEvent">> = {},
): Doc<"posLocalSyncEvent"> {
  return {
    _id: "event-1-id" as Id<"posLocalSyncEvent">,
    _creationTime: now - 20 * 60 * 1000,
    storeId,
    terminalId,
    localRegisterSessionId: "register-1",
    localEventId: "event-1",
    eventType: "register_opened",
    occurredAt: now - 20 * 60 * 1000,
    staffProfileId: "staff-1" as Id<"staffProfile">,
    payload: {
      openingFloat: 100,
      registerNumber: "A1",
    },
    status: "conflicted",
    submittedAt: now - 19 * 60 * 1000,
    ...overrides,
  } as Doc<"posLocalSyncEvent">;
}
