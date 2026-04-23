import { describe, expect, it, vi } from "vitest";
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
  releaseExpenseSessionInventoryHoldsAndDeleteItems,
  updateExpenseSession,
} from "./expenseSessions";

type SessionRecord = {
  _id: string;
  status: "active" | "held" | "completed" | "void" | "expired";
  expiresAt: number;
  staffProfileId: string;
  updatedAt?: number;
  completedAt?: number;
  notes?: string;
};

function createMutationCtx(seed?: { sessions?: SessionRecord[] }) {
  const sessions = [...(seed?.sessions ?? [])];

  const db = {
    get: vi.fn(async (tableNameOrId: string, maybeId?: string) => {
      const tableName = maybeId ? tableNameOrId : "expenseSession";
      const id = maybeId ?? tableNameOrId;

      if (tableName !== "expenseSession") {
        return null;
      }

      return sessions.find((session) => session._id === id) ?? null;
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
    query: vi.fn(() => ({
      withIndex: vi.fn(() => ({
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
    status: "active",
    expiresAt: 4_102_444_800_000,
    staffProfileId: "staff-1",
    ...overrides,
  };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("expense session command results", () => {
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
    expect(mocks.createExpenseTransactionFromSessionHandler).toHaveBeenCalledWith(
      ctx,
      {
        notes: "Complete in test",
        sessionId: "expense-session-1",
      },
    );
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
