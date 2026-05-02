import { afterEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../shared/commandResult";

const mocks = vi.hoisted(() => ({
  createExpenseTransactionFromSessionHandler: vi.fn(),
}));

vi.mock("./expenseTransactions", () => ({
  createExpenseTransactionFromSessionHandler:
    mocks.createExpenseTransactionFromSessionHandler,
}));

import {
  completeExpenseSession,
  createExpenseSession,
  releaseExpenseSessionInventoryHoldsAndDeleteItems,
  updateExpenseSession,
} from "./expenseSessions";

afterEach(() => {
  vi.restoreAllMocks();
});

type SessionRecord = {
  _id: string;
  sessionNumber: string;
  storeId: string;
  terminalId: string;
  status: "active" | "held" | "completed" | "void" | "expired";
  expiresAt: number;
  staffProfileId: string;
  createdAt: number;
  updatedAt?: number;
  completedAt?: number;
  notes?: string;
  workflowTraceId?: string;
};

function createMutationCtx(seed?: {
  latestSession?: SessionRecord;
  sessions?: SessionRecord[];
  terminals?: Array<{ _id: string; registerNumber?: string | null }>;
}) {
  const sessions = [...(seed?.sessions ?? [])];
  const terminals = [...(seed?.terminals ?? [])];
  const workflowTraces: Array<Record<string, unknown>> = [];
  const workflowTraceLookups: Array<Record<string, unknown>> = [];
  const workflowTraceEvents: Array<Record<string, unknown>> = [];

  const db = {
    get: vi.fn(async (tableNameOrId: string, maybeId?: string) => {
      const tableName = maybeId ? tableNameOrId : "expenseSession";
      const id = maybeId ?? tableNameOrId;

      if (tableName === "expenseSession") {
        return sessions.find((session) => session._id === id) ?? null;
      }

      if (tableName === "posTerminal") {
        return terminals.find((terminal) => terminal._id === id) ?? null;
      }

      return null;
    }),
    insert: vi.fn(async (tableName: string, doc: Record<string, unknown>) => {
      if (tableName === "workflowTrace") {
        const id = `workflow-trace-${workflowTraces.length + 1}`;
        workflowTraces.push({ _id: id, ...doc });
        return id;
      }

      if (tableName === "workflowTraceLookup") {
        const id = `workflow-trace-lookup-${workflowTraceLookups.length + 1}`;
        workflowTraceLookups.push({ _id: id, ...doc });
        return id;
      }

      if (tableName === "workflowTraceEvent") {
        const id = `workflow-trace-event-${workflowTraceEvents.length + 1}`;
        workflowTraceEvents.push({ _id: id, ...doc });
        return id;
      }

      if (tableName !== "expenseSession") {
        return "inserted-id";
      }

      sessions.push({
        _id: "expense-session-inserted",
        sessionNumber: doc.sessionNumber as string,
        storeId: doc.storeId as string,
        terminalId: doc.terminalId as string,
        expiresAt: doc.expiresAt as number,
        staffProfileId: doc.staffProfileId as string,
        createdAt: doc.createdAt as number,
        updatedAt: doc.updatedAt as number,
        status: doc.status as SessionRecord["status"],
      });
      return "expense-session-inserted";
    }),
    patch: vi.fn(
      async (tableName: string, id: string, patch: Record<string, unknown>) => {
        if (tableName !== "expenseSession") {
          return;
        }

        const session = sessions.find((entry) => entry._id === id);
        if (!session) {
          return;
        }

        Object.assign(session, patch);
      },
    ),
    query: vi.fn((tableName: string) => ({
      withIndex: vi.fn(() => ({
        unique: vi.fn(async () => {
          if (tableName === "workflowTrace") {
            return workflowTraces[0] ?? null;
          }

          if (tableName === "workflowTraceLookup") {
            return workflowTraceLookups[0] ?? null;
          }

          return null;
        }),
        first: vi.fn(async () => seed?.latestSession ?? null),
        order: vi.fn(() => ({
          first: vi.fn(async () => {
            if (tableName === "workflowTraceEvent") {
              return workflowTraceEvents.at(-1) ?? null;
            }

            return seed?.latestSession ?? null;
          }),
        })),
        take: vi.fn(async () => []),
      })),
    })),
  };

  return {
    db,
    runMutation: vi.fn(),
  };
}

function buildSession(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    _id: "expense-session-1",
    sessionNumber: "EXP-001",
    storeId: "store-1",
    terminalId: "terminal-1",
    status: "active",
    expiresAt: 4_102_444_800_000,
    staffProfileId: "staff-1",
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("expense session command results", () => {
  it("creates an expense session without requiring a register number", async () => {
    const ctx = createMutationCtx({
      terminals: [
        {
          _id: "terminal-1",
          registerNumber: null,
        },
      ],
    });

    const result = await getHandler(createExpenseSession)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      staffProfileId: "staff-1",
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        expiresAt: expect.any(Number),
        sessionId: "expense-session-inserted",
      },
    });
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "expenseSession",
      expect.objectContaining({
        registerNumber: undefined,
        staffProfileId: "staff-1",
        status: "active",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    );
  });

  it("completes expense sessions through the in-mutation transaction helper", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "expense-session-1",
          status: "active",
        }),
      ],
    });

    mocks.createExpenseTransactionFromSessionHandler.mockResolvedValue(
      ok({
        transactionId: "expense-transaction-1",
        transactionNumber: "EXP-1001",
      }),
    );

    const result = await getHandler(completeExpenseSession)(ctx as never, {
      notes: "Complete in test",
      sessionId: "expense-session-1",
      totalValue: 150,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "expense-session-1",
        transactionNumber: "EXP-1001",
      },
    });
    expect(
      mocks.createExpenseTransactionFromSessionHandler,
    ).toHaveBeenCalledWith(ctx, {
      notes: "Complete in test",
      sessionId: "expense-session-1",
    });
    expect(ctx.runMutation).not.toHaveBeenCalled();
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "expenseSession",
      "expense-session-1",
      expect.objectContaining({
        status: "completed",
      }),
    );
  });

  it("returns a user_error when completing a missing expense session", async () => {
    const ctx = createMutationCtx();

    const result = await getHandler(completeExpenseSession)(ctx as never, {
      notes: "Missing session",
      sessionId: "expense-session-1",
      totalValue: 150,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Session not found",
      },
    });
  });

  it("treats stale completed session note updates as a no-op for the owning staff member", async () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "expense-session-1",
          status: "completed",
          expiresAt: 123_456,
          staffProfileId: "staff-1",
        }),
      ],
    });

    const result = await getHandler(updateExpenseSession)(ctx as never, {
      notes: "Should not explode",
      sessionId: "expense-session-1",
      staffProfileId: "staff-1",
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        expiresAt: 123_456,
        sessionId: "expense-session-1",
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(consoleWarn).toHaveBeenCalledWith(
      "Attempted to update completed expense session expense-session-1. Ignoring update.",
    );
  });

  it("returns a user_error when clearing holds for a missing expense session", async () => {
    const ctx = createMutationCtx();

    const result = await getHandler(
      releaseExpenseSessionInventoryHoldsAndDeleteItems,
    )(ctx as never, {
      sessionId: "expense-session-1",
    });

    expect(result).toEqual({
      kind: "user_error",
      error: {
        code: "not_found",
        message: "Session not found",
      },
    });
  });
});
