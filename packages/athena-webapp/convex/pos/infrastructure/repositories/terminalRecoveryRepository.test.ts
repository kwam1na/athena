import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  createTerminalRecoveryCommandRepository,
  getTerminalRecoverySourceEvent,
  listTerminalRecoveryConflictsForRepair,
  patchTerminalRecoveryConflict,
} from "./terminalRecoveryRepository";

describe("terminalRecoveryRepository", () => {
  it("lists command documents through the terminal recovery command index", async () => {
    const command = {
      _id: "command-1" as Id<"posTerminalRecoveryCommand">,
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    };
    const ctx = buildCtx({
      posTerminalRecoveryCommand: [command],
    });
    const repository = createTerminalRecoveryCommandRepository(ctx as never);

    const result = await repository.listCommandsForTerminal({
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual([command]);
    expect(ctx.db.query).toHaveBeenCalledWith("posTerminalRecoveryCommand");
    expect(ctx.queryLog).toContain("by_store_terminal_status");
    expect(ctx.eqLog).toEqual([
      ["storeId", "store-1"],
      ["terminalId", "terminal-1"],
    ]);
  });

  it("lists repair conflicts through the scoped conflict status index", async () => {
    const conflict = {
      _id: "conflict-1" as Id<"posLocalSyncConflict">,
    };
    const ctx = buildCtx({
      posLocalSyncConflict: [conflict],
    });

    const result = await listTerminalRecoveryConflictsForRepair(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual([conflict]);
    expect(ctx.db.query).toHaveBeenCalledWith("posLocalSyncConflict");
    expect(ctx.queryLog).toContain("by_store_terminal_status");
    expect(ctx.eqLog).toEqual([
      ["storeId", "store-1"],
      ["terminalId", "terminal-1"],
      ["status", "needs_review"],
    ]);
  });

  it("loads the source local event for a terminal repair conflict", async () => {
    const event = {
      _id: "event-1" as Id<"posLocalSyncEvent">,
      localEventId: "local-event-1",
    };
    const ctx = buildCtx({
      posLocalSyncEvent: [event],
    });

    const result = await getTerminalRecoverySourceEvent(ctx as never, {
      localEventId: "local-event-1",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual(event);
    expect(ctx.db.query).toHaveBeenCalledWith("posLocalSyncEvent");
    expect(ctx.queryLog).toContain("by_store_terminal_localEvent");
    expect(ctx.eqLog).toEqual([
      ["storeId", "store-1"],
      ["terminalId", "terminal-1"],
      ["localEventId", "local-event-1"],
    ]);
  });

  it("patches conflicts by id for safe cloud repairs", async () => {
    const ctx = buildCtx();

    await patchTerminalRecoveryConflict(
      ctx as never,
      "conflict-1" as Id<"posLocalSyncConflict">,
      { status: "resolved" },
    );

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posLocalSyncConflict",
      "conflict-1",
      { status: "resolved" },
    );
  });
});

function buildCtx(tables: Record<string, unknown[]> = {}) {
  const queryLog: string[] = [];
  const eqLog: Array<[string, unknown]> = [];
  const ctx = {
    db: {
      get: vi.fn(),
      insert: vi.fn(),
      patch: vi.fn(),
      query: vi.fn((tableName: string) => ({
        withIndex(indexName: string, callback: (q: unknown) => unknown) {
          queryLog.push(indexName);
          const q = {
            eq(fieldName: string, value: unknown) {
              eqLog.push([fieldName, value]);
              return q;
            },
          };
          callback(q);
          return {
            first: vi.fn(async () => tables[tableName]?.[0] ?? null),
            take: vi.fn(async () => tables[tableName] ?? []),
          };
        },
      })),
    },
    eqLog,
    queryLog,
  };
  return ctx;
}
