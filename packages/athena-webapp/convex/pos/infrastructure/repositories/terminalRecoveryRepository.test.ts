import { describe, expect, it, vi } from "vitest";

import type { Id } from "../../../_generated/dataModel";
import {
  createTerminalRecoveryCommandReadRepository,
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
    const repository = createTerminalRecoveryCommandReadRepository(ctx as never);

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

  it("lists command documents with a query-shaped db that has no write APIs", async () => {
    const command = {
      _id: "command-1" as Id<"posTerminalRecoveryCommand">,
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    };
    const ctx = buildQueryCtx({
      posTerminalRecoveryCommand: [command],
    });
    const repository = createTerminalRecoveryCommandReadRepository(ctx as never);

    const result = await repository.listCommandsForTerminal({
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual([command]);
    expect("patch" in ctx.db).toBe(false);
    expect("insert" in ctx.db).toBe(false);
  });

  it("lists active command documents through status and expiry indexes", async () => {
    const expiredCommands = Array.from({ length: 75 }, (_, index) => ({
      _id: `command-expired-${index}` as Id<"posTerminalRecoveryCommand">,
      expiresAt: 100,
      status: "pending",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    }));
    const activeCommand = {
      _id: "command-active" as Id<"posTerminalRecoveryCommand">,
      expiresAt: 1_000,
      status: "pending",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    };
    const ctx = buildQueryCtx({
      posTerminalRecoveryCommand: [...expiredCommands, activeCommand],
    });
    const repository = createTerminalRecoveryCommandReadRepository(ctx as never);

    const result = await repository.listCommandsForTerminal({
      expiresAfter: 500,
      statuses: ["pending"],
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual([activeCommand]);
    expect(ctx.queryLog).toContain("by_store_terminal_status_expiresAt");
    expect(ctx.eqLog).toEqual([
      ["storeId", "store-1"],
      ["terminalId", "terminal-1"],
      ["status", "pending"],
    ]);
    expect(ctx.gtLog).toEqual([["expiresAt", 500]]);
  });

  it("rotates bounded verification-ready work while keeping newest commands prompt", async () => {
    const readyCommands = Array.from({ length: 40 }, (_, index) => ({
      _creationTime: index + 1,
      _id: `command-ready-${index}` as Id<"posTerminalRecoveryCommand">,
      status: "completed",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      verificationStatus: "runtime_verification_ready",
    }));
    const ctx = buildQueryCtx({
      posTerminalRecoveryCommand: [
        ...readyCommands,
        {
          _creationTime: 0,
          _id: "command-other-terminal",
          status: "completed",
          storeId: "store-1",
          terminalId: "terminal-2",
          verificationStatus: "runtime_verification_ready",
        },
        {
          _creationTime: 0,
          _id: "command-already-verified",
          status: "completed",
          storeId: "store-1",
          terminalId: "terminal-1",
          verificationStatus: "verified",
        },
      ],
    });
    const repository = createTerminalRecoveryCommandReadRepository(ctx as never);

    const first = await repository.listRuntimeVerificationReadyCommands({
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });
    const second = await repository.listRuntimeVerificationReadyCommands({
      cursor: first.nextCursor,
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });
    const third = await repository.listRuntimeVerificationReadyCommands({
      cursor: second.nextCursor,
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(first).toEqual({
      commands: [
        ...readyCommands.slice(-5).reverse(),
        ...readyCommands.slice(0, 15),
      ],
      nextCursor: "cursor:15",
    });
    expect(second).toEqual({
      commands: [
        ...readyCommands.slice(-5).reverse(),
        ...readyCommands.slice(15, 30),
      ],
      nextCursor: "cursor:30",
    });
    expect(third).toEqual({
      commands: [
        ...readyCommands.slice(-5).reverse(),
        ...readyCommands.slice(30, 35),
      ],
      nextCursor: undefined,
    });
    expect(
      new Set(
        [...first.commands, ...second.commands, ...third.commands].map(
          (command) => command._id,
        ),
      ).size,
    ).toBe(readyCommands.length);
    expect(ctx.queryLog).toHaveLength(6);
    expect(ctx.queryLog).toEqual(
      expect.arrayContaining(["by_store_terminal_verification"]),
    );
    expect(ctx.eqLog).toHaveLength(18);
  });

  it("writes command documents only through the mutation repository", async () => {
    const ctx = buildCtx();
    const repository = createTerminalRecoveryCommandRepository(ctx as never);
    const input = {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
      commandType: "retry_sync" as const,
      status: "pending" as const,
      verificationStatus: "waiting_for_acknowledgement" as const,
      commandContext: { reason: "Support requested sync retry." },
      expectedEvidence: {},
      issuedByUserId: "user-1" as Id<"athenaUser">,
      issuedAt: 1,
      expiresAt: 2,
    };

    await repository.insertCommand(input);
    await repository.patchCommand("command-1" as Id<"posTerminalRecoveryCommand">, {
      status: "expired",
    });

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "posTerminalRecoveryCommand",
      input,
    );
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "posTerminalRecoveryCommand",
      "command-1",
      { status: "expired" },
    );
  });

  it("lists repair conflicts through the scoped conflict status index", async () => {
    const conflict = {
      _id: "conflict-1" as Id<"posLocalSyncConflict">,
      conflictType: "inventory",
      details: {},
      localRegisterSessionId: "local-register-1",
      status: "needs_review",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
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
    expect(ctx.queryLog).toContain("by_store_terminal_status_type");
    expect(ctx.eqLog).toEqual(
      expect.arrayContaining([
        ["storeId", "store-1"],
        ["terminalId", "terminal-1"],
        ["status", "needs_review"],
        ["conflictType", "inventory"],
      ]),
    );
  });

  it("omits repair conflicts when their blocking register session is settled", async () => {
    const staleConflict = {
      _id: "conflict-stale" as Id<"posLocalSyncConflict">,
      conflictType: "permission",
      details: {
        blockingRegisterSessionId: "register-session-closed",
      },
      localRegisterSessionId: "local-register-new",
      status: "needs_review",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    };
    const activeConflict = {
      _id: "conflict-active" as Id<"posLocalSyncConflict">,
      conflictType: "permission",
      details: {
        blockingRegisterSessionId: "register-session-open",
      },
      localRegisterSessionId: "local-register-newer",
      status: "needs_review",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    };
    const ctx = buildCtx({
      posLocalSyncConflict: [staleConflict, activeConflict],
      registerSession: [
        {
          _id: "register-session-closed",
          status: "closed",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
        {
          _id: "register-session-open",
          status: "open",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      ],
    });

    const result = await listTerminalRecoveryConflictsForRepair(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual([activeConflict]);
  });

  it("keeps repairable inventory conflicts when stale register conflicts exceed the source cap", async () => {
    const staleRegisterConflicts = Array.from({ length: 5_010 }, (_, index) => ({
      _id: `conflict-stale-${index}` as Id<"posLocalSyncConflict">,
      conflictType: "permission",
      details: {
        blockingRegisterSessionId: "register-session-closed",
      },
      localRegisterSessionId: `local-register-stale-${index}`,
      sequence: index + 1,
      status: "needs_review",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    }));
    const inventoryConflict = {
      _id: "conflict-inventory" as Id<"posLocalSyncConflict">,
      conflictType: "inventory",
      details: {
        localTransactionId: "local-transaction-1",
        productSkuId: "sku-1",
      },
      localRegisterSessionId: "local-register-inventory",
      sequence: 6_000,
      status: "needs_review",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    };
    const ctx = buildCtx({
      posLocalSyncConflict: [...staleRegisterConflicts, inventoryConflict],
      registerSession: [
        {
          _id: "register-session-closed",
          status: "closed",
          storeId: "store-1",
          terminalId: "terminal-1",
        },
      ],
    });

    const result = await listTerminalRecoveryConflictsForRepair(ctx as never, {
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
    });

    expect(result).toEqual([inventoryConflict]);
  });

  it("loads the source local event for a terminal repair conflict", async () => {
    const event = {
      _id: "event-1" as Id<"posLocalSyncEvent">,
      localEventId: "local-event-1",
      storeId: "store-1" as Id<"store">,
      terminalId: "terminal-1" as Id<"posTerminal">,
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
  const gtLog: Array<[string, unknown]> = [];
  const ctx = {
    db: {
      get: vi.fn(async (tableName: string, id: string) =>
        (tables[tableName] ?? []).find(
          (row) => (row as Record<string, unknown>)._id === id,
        ) ?? null,
      ),
      insert: vi.fn(),
      patch: vi.fn(),
      query: vi.fn((tableName: string) => ({
        withIndex(indexName: string, callback: (q: unknown) => unknown) {
          queryLog.push(indexName);
          const filters: Array<(row: Record<string, unknown>) => boolean> = [];
          const q = {
            eq(fieldName: string, value: unknown) {
              eqLog.push([fieldName, value]);
              filters.push((row) => row[fieldName] === value);
              return q;
            },
            gt(fieldName: string, value: unknown) {
              gtLog.push([fieldName, value]);
              filters.push(
                (row) =>
                  typeof row[fieldName] === "number" &&
                  typeof value === "number" &&
                  row[fieldName] > value,
              );
              return q;
            },
          };
          callback(q);
          const buildResult = (direction: "asc" | "desc" = "asc") => ({
            first: vi.fn(
              async () =>
                orderedRows(tables[tableName], filters, direction)[0] ?? null,
            ),
            take: vi.fn(async (limit?: number) =>
              orderedRows(tables[tableName], filters, direction).slice(
                0,
                limit,
              ),
            ),
            paginate: vi.fn(
              async ({
                cursor,
                numItems,
              }: {
                cursor: string | null;
                numItems: number;
              }) => {
                const rows = orderedRows(tables[tableName], filters, direction);
                const offset = cursor
                  ? Number.parseInt(cursor.replace("cursor:", ""), 10)
                  : 0;
                const end = Math.min(offset + numItems, rows.length);
                return {
                  continueCursor: `cursor:${end}`,
                  isDone: end >= rows.length,
                  page: rows.slice(offset, end),
                };
              },
            ),
            unique: vi.fn(
              async () =>
                orderedRows(tables[tableName], filters, direction)[0] ?? null,
            ),
          });
          const result = buildResult();
          return {
            ...result,
            order: vi.fn((direction: "asc" | "desc") =>
              buildResult(direction),
            ),
          };
        },
      })),
    },
    eqLog,
    gtLog,
    queryLog,
  };
  return ctx;
}

function buildQueryCtx(tables: Record<string, unknown[]> = {}) {
  const writableCtx = buildCtx(tables);
  const { get, query } = writableCtx.db;
  return {
    db: {
      get,
      query,
    },
    eqLog: writableCtx.eqLog,
    gtLog: writableCtx.gtLog,
    queryLog: writableCtx.queryLog,
  };
}

function filterRows(
  rows: unknown[] | undefined,
  filters: Array<(row: Record<string, unknown>) => boolean>,
) {
  return (rows ?? []).filter((row) =>
    filters.every((filter) => filter(row as Record<string, unknown>)),
  );
}

function orderedRows(
  rows: unknown[] | undefined,
  filters: Array<(row: Record<string, unknown>) => boolean>,
  direction: "asc" | "desc",
) {
  const filtered = filterRows(rows, filters);
  return direction === "desc" ? filtered.reverse() : filtered;
}
