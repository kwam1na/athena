import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createTransactionFromSessionHandler: vi.fn(),
  releaseInventoryHoldsBatch: vi.fn(),
  traceRecord: vi.fn(),
}));

vi.mock("./pos", () => ({
  createTransactionFromSessionHandler: mocks.createTransactionFromSessionHandler,
}));

vi.mock("./helpers/inventoryHolds", () => ({
  acquireInventoryHoldsBatch: vi.fn(),
  releaseInventoryHoldsBatch: mocks.releaseInventoryHoldsBatch,
  validateInventoryAvailability: vi.fn(),
}));

vi.mock("../pos/application/commands/posSessionTracing", () => ({
  createPosSessionTraceRecorder: vi.fn(() => ({
    record: mocks.traceRecord,
  })),
}));

import {
  completeSession,
  releaseSessionInventoryHoldsAndDeleteItems,
  releasePosSessionItems,
  syncSessionCheckoutState,
  updateSession,
  voidSession,
} from "./posSessions";

type SessionRecord = {
  _id: string;
  sessionNumber: string;
  storeId: string;
  terminalId: string;
  status: "active" | "held" | "completed" | "void" | "expired";
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
  cashierId?: string;
  customerId?: string;
  customerInfo?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  registerNumber?: string;
  notes?: string;
  workflowTraceId?: string;
  payments?: Array<{
    method: string;
    amount: number;
    timestamp: number;
  }>;
  subtotal?: number;
  tax?: number;
  total?: number;
};

type SessionItemRecord = {
  _id: string;
  sessionId: string;
  productSkuId: string;
  quantity: number;
};

type QueryBuilderFilters = {
  status?: string;
  expiresBefore?: number;
  sessionId?: string;
};

function createMutationCtx(seed?: {
  sessions?: SessionRecord[];
  items?: SessionItemRecord[];
}) {
  const sessions = [...(seed?.sessions ?? [])];
  const items = [...(seed?.items ?? [])];

  const db = {
    get: vi.fn(async (tableNameOrId: string, maybeId?: string) => {
      const tableName = maybeId ? tableNameOrId : "posSession";
      const id = maybeId ?? tableNameOrId;
      if (tableName !== "posSession") {
        return null;
      }

      return sessions.find((session) => session._id === id) ?? null;
    }),
    patch: vi.fn(
      async (tableName: string, id: string, patch: Record<string, unknown>) => {
        if (tableName !== "posSession") {
          return;
        }

        const session = sessions.find((entry) => entry._id === id);
        if (!session) {
          return;
        }

        Object.assign(session, patch);
      },
    ),
    delete: vi.fn(async (tableName: string, id: string) => {
      if (tableName !== "posSessionItem") {
        return;
      }

      const index = items.findIndex((item) => item._id === id);
      if (index >= 0) {
        items.splice(index, 1);
      }
    }),
    query: vi.fn((tableName: string) => ({
      withIndex(indexName: string, apply: (builder: {
        eq(field: string, value: unknown): unknown;
        lt(field: string, value: unknown): unknown;
      }) => void) {
        const filters: QueryBuilderFilters = {};
        const builder = {
          eq(field: string, value: unknown) {
            if (field === "status") {
              filters.status = String(value);
            }
            if (field === "sessionId") {
              filters.sessionId = String(value);
            }

            return builder;
          },
          lt(field: string, value: unknown) {
            if (field === "expiresAt") {
              filters.expiresBefore = Number(value);
            }

            return builder;
          },
        };

        apply(builder);

        if (tableName === "posSession" && indexName === "by_status_and_expiresAt") {
          const page = sessions.filter(
            (session) =>
              session.status === filters.status &&
              session.expiresAt < (filters.expiresBefore ?? Number.POSITIVE_INFINITY),
          );

          return {
            paginate: async () => ({
              page,
              isDone: true,
              continueCursor: "",
            }),
          };
        }

        if (tableName === "posSessionItem" && indexName === "by_sessionId") {
          const page = items.filter((item) => item.sessionId === filters.sessionId);

          return {
            take: async () => page,
          };
        }

        throw new Error(`Unsupported query ${tableName}.${indexName}`);
      },
    })),
  };

  return {
    db,
    sessions,
  };
}

function buildSession(overrides: Partial<SessionRecord>): SessionRecord {
  return {
    _id: "session-1",
    sessionNumber: "SES-001",
    storeId: "store-1",
    terminalId: "terminal-1",
    status: "active",
    createdAt: 100,
    updatedAt: 100,
    expiresAt: 4_102_444_800_000,
    cashierId: "cashier-1",
    registerNumber: "1",
    ...overrides,
  };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("pos session lifecycle trace handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.traceRecord.mockResolvedValue({
      traceCreated: true,
      traceId: "pos_session:ses-001",
    });
  });

  it("records a completed lifecycle trace after completing a session", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-1",
          subtotal: 100,
          tax: 15,
          total: 115,
        }),
      ],
    });

    mocks.createTransactionFromSessionHandler.mockResolvedValue({
      success: true,
      transactionId: "txn-1",
      transactionNumber: "POS-1001",
    });

    const result = await getHandler(completeSession)(ctx as never, {
      sessionId: "session-1",
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      notes: "Completed in test",
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result).toEqual({
      success: true,
      data: {
        sessionId: "session-1",
        transactionNumber: "POS-1001",
      },
    });
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "completed",
        transactionId: "txn-1",
        session: expect.objectContaining({
          _id: "session-1",
          status: "completed",
          transactionId: "txn-1",
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("posSession", "session-1", {
      workflowTraceId: "pos_session:ses-001",
    });
  });

  it("records a voided lifecycle trace when voiding a session", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-2",
        }),
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-2",
          productSkuId: "sku-1",
          quantity: 2,
        },
      ],
    });

    const result = await getHandler(voidSession)(ctx as never, {
      sessionId: "session-2",
      voidReason: "Customer changed mind",
    });

    expect(result).toEqual({
      success: true,
      data: {
        sessionId: "session-2",
      },
    });
    expect(mocks.releaseInventoryHoldsBatch).toHaveBeenCalledWith(ctx.db, [
      { skuId: "sku-1", quantity: 2 },
    ]);
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "voided",
        voidReason: "Customer changed mind",
        session: expect.objectContaining({
          _id: "session-2",
          status: "void",
          notes: "Customer changed mind",
        }),
      }),
    );
  });

  it("records customer milestones when session metadata links a customer", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-customer",
          customerId: undefined,
          customerInfo: undefined,
        }),
      ],
    });

    const result = await getHandler(updateSession)(ctx as never, {
      sessionId: "session-customer",
      cashierId: "cashier-1",
      customerId: "customer-1",
      customerInfo: {
        name: "Ama Serwa",
        email: "ama@example.com",
      },
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result).toEqual({
      sessionId: "session-customer",
      expiresAt: expect.any(Number),
    });
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "customerLinked",
        customerName: "Ama Serwa",
        session: expect.objectContaining({
          _id: "session-customer",
          customerId: "customer-1",
          customerInfo: expect.objectContaining({
            name: "Ama Serwa",
            email: "ama@example.com",
          }),
        }),
      }),
    );
  });

  it("records a cart-cleared milestone and clears pending payments", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-clear",
          payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
        }),
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-clear",
          productSkuId: "sku-1",
          quantity: 1,
        },
        {
          _id: "item-2",
          sessionId: "session-clear",
          productSkuId: "sku-2",
          quantity: 2,
        },
      ],
    });

    const result = await getHandler(releaseSessionInventoryHoldsAndDeleteItems)(
      ctx as never,
      {
        sessionId: "session-clear",
      },
    );

    expect(result).toEqual({
      success: true,
      data: {
        sessionId: "session-clear",
      },
    });
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "cartCleared",
        itemCount: 2,
        session: expect.objectContaining({
          _id: "session-clear",
          payments: [],
        }),
      }),
    );
    expect(ctx.sessions.find((session) => session._id === "session-clear")?.payments).toEqual(
      [],
    );
  });

  it("records payment and checkout milestones while syncing checkout state", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-checkout",
        }),
      ],
    });

    const paymentResult = await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-checkout",
      cashierId: "cashier-1",
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      stage: "paymentAdded",
      paymentMethod: "cash",
      amount: 115,
    });

    expect(paymentResult).toEqual({
      success: true,
      data: {
        sessionId: "session-checkout",
        expiresAt: expect.any(Number),
      },
    });
    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "paymentAdded",
        paymentMethod: "cash",
        amount: 115,
        paymentCount: 1,
      }),
    );

    const checkoutResult = await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-checkout",
      cashierId: "cashier-1",
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      stage: "checkoutSubmitted",
      paymentMethod: "cash",
    });

    expect(checkoutResult).toEqual({
      success: true,
      data: {
        sessionId: "session-checkout",
        expiresAt: expect.any(Number),
      },
    });
    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "checkoutSubmitted",
        paymentCount: 1,
      }),
    );
  });

  it("keeps checkout-state sync successful when trace recording fails", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-trace-failure",
        }),
      ],
    });

    mocks.traceRecord.mockRejectedValueOnce(new Error("trace unavailable"));

    const result = await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-trace-failure",
      cashierId: "cashier-1",
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      stage: "paymentAdded",
      paymentMethod: "cash",
      amount: 115,
    });

    expect(result).toEqual({
      success: true,
      data: {
        sessionId: "session-trace-failure",
        expiresAt: expect.any(Number),
      },
    });
    expect(
      ctx.sessions.find((session) => session._id === "session-trace-failure")?.payments,
    ).toEqual([{ method: "cash", amount: 115, timestamp: 1_000 }]);
  });

  it("does not overwrite a voided session trace when cron expires old sessions", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-void",
          sessionNumber: "SES-VOID",
          status: "void",
          expiresAt: 500,
          notes: "Cashier voided this session",
          workflowTraceId: "pos_session:ses-void",
        }),
        buildSession({
          _id: "session-active",
          sessionNumber: "SES-ACTIVE",
          status: "active",
          expiresAt: 500,
        }),
      ],
      items: [
        {
          _id: "item-void",
          sessionId: "session-void",
          productSkuId: "sku-1",
          quantity: 1,
        },
        {
          _id: "item-active",
          sessionId: "session-active",
          productSkuId: "sku-2",
          quantity: 2,
        },
      ],
    });

    mocks.traceRecord
      .mockResolvedValueOnce({
        traceCreated: true,
        traceId: "pos_session:ses-active",
      })
      .mockResolvedValue({
        traceCreated: true,
        traceId: "pos_session:ses-active",
      });

    const result = await getHandler(releasePosSessionItems)(ctx as never, {});

    expect(result).toEqual({
      releasedCount: 2,
      sessionIds: ["session-active", "session-void"],
    });
    expect(mocks.traceRecord).toHaveBeenCalledTimes(1);
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "expired",
        session: expect.objectContaining({
          _id: "session-active",
          status: "expired",
        }),
      }),
    );
    expect(ctx.sessions.find((session) => session._id === "session-void")?.notes).toBe(
      "Cashier voided this session",
    );
  });
});
