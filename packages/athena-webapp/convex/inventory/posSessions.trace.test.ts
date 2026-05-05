import { beforeEach, describe, expect, it, vi } from "vitest";
import { ok } from "../../shared/commandResult";

const mocks = vi.hoisted(() => ({
  createTransactionFromSessionHandler: vi.fn(),
  recordRegisterSessionSale: vi.fn(),
  releaseInventoryHoldsBatch: vi.fn(),
  traceRecord: vi.fn(),
}));

vi.mock("./pos", () => ({
  createTransactionFromSessionHandler: mocks.createTransactionFromSessionHandler,
  recordRegisterSessionSale: mocks.recordRegisterSessionSale,
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
  expireAllSessionsForStaff,
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
  staffProfileId?: string;
  customerId?: string;
  customerProfileId?: string;
  registerSessionId?: string;
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
  checkoutStateVersion?: number;
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

type RegisterSessionRecord = {
  _id: string;
  storeId: string;
  terminalId?: string;
  registerNumber?: string;
  status: "open" | "active" | "closing" | "closed";
};

type QueryBuilderFilters = {
  status?: string;
  expiresBefore?: number;
  staffProfileId?: string;
  sessionId?: string;
};

function createMutationCtx(seed?: {
  sessions?: SessionRecord[];
  items?: SessionItemRecord[];
  registerSessions?: RegisterSessionRecord[];
}) {
  const sessions = [...(seed?.sessions ?? [])];
  const items = [...(seed?.items ?? [])];
  const registerSessions = [
    ...(seed?.registerSessions ?? []),
    {
      _id: "drawer-1",
      storeId: "store-1",
      terminalId: "terminal-1",
      registerNumber: "1",
      status: "open",
    } satisfies RegisterSessionRecord,
  ];

  const db = {
    get: vi.fn(async (tableNameOrId: string, maybeId?: string) => {
      const tableName = maybeId ? tableNameOrId : "posSession";
      const id = maybeId ?? tableNameOrId;
      if (tableName === "posSession") {
        return sessions.find((session) => session._id === id) ?? null;
      }

      if (tableName === "registerSession") {
        return (
          registerSessions.find((session) => session._id === id) ?? null
        );
      }

      return null;
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
            if (field === "staffProfileId") {
              filters.staffProfileId = String(value);
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
            take: async () => page,
            paginate: async () => ({
              page,
              isDone: true,
              continueCursor: "",
            }),
          };
        }

        if (tableName === "posSession" && indexName === "by_expiresAt") {
          const page = sessions.filter(
            (session) =>
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

        if (
          tableName === "posSession" &&
          indexName === "by_staffProfileId_and_status"
        ) {
          const page = sessions.filter(
            (session) =>
              session.staffProfileId === filters.staffProfileId &&
              session.status === filters.status,
          );

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
    items,
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
    staffProfileId: "cashier-1",
    registerNumber: "1",
    registerSessionId: "drawer-1",
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
          registerSessionId: "drawer-1",
          subtotal: 100,
          tax: 15,
          total: 115,
        }),
      ],
    });

    mocks.createTransactionFromSessionHandler.mockResolvedValue(
      ok({
        transactionId: "txn-1",
        transactionNumber: "POS-1001",
        transactionItems: ["txn-item-1"],
      }),
    );

    const result = await getHandler(completeSession)(ctx as never, {
      sessionId: "session-1",
      staffProfileId: "cashier-1",
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      notes: "Completed in test",
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-1",
        transactionNumber: "POS-1001",
      },
    });
    expect(mocks.createTransactionFromSessionHandler).toHaveBeenCalledWith(
      ctx,
      expect.objectContaining({
        sessionId: "session-1",
        staffProfileId: "cashier-1",
        recordRegisterSale: false,
      }),
    );
    expect(mocks.traceRecord).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        stage: "checkoutSubmitted",
        paymentMethod: "cash",
        paymentCount: 1,
      }),
    );
    expect(mocks.traceRecord).toHaveBeenNthCalledWith(
      2,
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

  it("refuses to complete a session for a different cashier before transaction side effects", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-1",
          staffProfileId: "cashier-1",
          registerSessionId: "drawer-1",
          subtotal: 100,
          tax: 15,
          total: 115,
        }),
      ],
    });

    const result = await getHandler(completeSession)(ctx as never, {
      sessionId: "session-1",
      staffProfileId: "cashier-2",
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result).toEqual(
      expect.objectContaining({
        kind: "user_error",
        error: expect.objectContaining({
          code: "precondition_failed",
          message: "This session is not associated with your cashier.",
        }),
      }),
    );
    expect(mocks.createTransactionFromSessionHandler).not.toHaveBeenCalled();
    expect(mocks.traceRecord).not.toHaveBeenCalled();
    expect(ctx.db.patch).not.toHaveBeenCalled();
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
      kind: "ok",
      data: {
        sessionId: "session-2",
      },
    });
    expect(mocks.releaseInventoryHoldsBatch).toHaveBeenCalledWith(ctx.db, {
      sessionId: "session-2",
      items: [{ skuId: "sku-1", quantity: 2 }],
      now: expect.any(Number),
    });
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

  it("voids an empty session without deleting audit items", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-empty-void",
        }),
      ],
    });

    const result = await getHandler(voidSession)(ctx as never, {
      sessionId: "session-empty-void",
      voidReason: "No items added",
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-empty-void",
      },
    });
    expect(mocks.releaseInventoryHoldsBatch).toHaveBeenCalledWith(ctx.db, {
      sessionId: "session-empty-void",
      items: [],
      now: expect.any(Number),
    });
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(ctx.sessions[0]).toEqual(
      expect.objectContaining({
        status: "void",
        notes: "No items added",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "voided",
        session: expect.objectContaining({
          _id: "session-empty-void",
          status: "void",
        }),
      }),
    );
  });

  it("aggregates SKU quantities before releasing holds while voiding a session", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-aggregate-void",
        }),
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-aggregate-void",
          productSkuId: "sku-1",
          quantity: 2,
        },
        {
          _id: "item-2",
          sessionId: "session-aggregate-void",
          productSkuId: "sku-1",
          quantity: 3,
        },
        {
          _id: "item-3",
          sessionId: "session-aggregate-void",
          productSkuId: "sku-2",
          quantity: 1,
        },
      ],
    });

    await getHandler(voidSession)(ctx as never, {
      sessionId: "session-aggregate-void",
      voidReason: "Duplicate SKU lines",
    });

    expect(mocks.releaseInventoryHoldsBatch).toHaveBeenCalledWith(ctx.db, {
      sessionId: "session-aggregate-void",
      items: [
        { skuId: "sku-1", quantity: 5 },
        { skuId: "sku-2", quantity: 1 },
      ],
      now: expect.any(Number),
    });
    expect(ctx.items).toHaveLength(3);
    expect(ctx.db.delete).not.toHaveBeenCalled();
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
      staffProfileId: "cashier-1",
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
      kind: "ok",
      data: {
        sessionId: "session-customer",
        expiresAt: expect.any(Number),
      },
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

  it("preserves customerProfileId and records customer profile metadata milestones", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-customer-profile",
          customerProfileId: undefined,
          customerInfo: undefined,
        }),
      ],
    });

    await getHandler(updateSession)(ctx as never, {
      sessionId: "session-customer-profile",
      staffProfileId: "cashier-1",
      customerProfileId: "profile-1",
      customerInfo: {
        name: "Ama Serwa",
        email: "ama@example.com",
      },
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(
      ctx.sessions.find((session) => session._id === "session-customer-profile"),
    ).toEqual(
      expect.objectContaining({
        customerProfileId: "profile-1",
        customerInfo: expect.objectContaining({
          name: "Ama Serwa",
          email: "ama@example.com",
        }),
      }),
    );
    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "customerLinked",
        customerName: "Ama Serwa",
        session: expect.objectContaining({
          _id: "session-customer-profile",
          customerProfileId: "profile-1",
        }),
      }),
    );

    await getHandler(updateSession)(ctx as never, {
      sessionId: "session-customer-profile",
      staffProfileId: "cashier-1",
      customerProfileId: "profile-1",
      customerInfo: {
        name: "Ama Serwa Mensah",
        email: "ama@example.com",
      },
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "customerUpdated",
        customerName: "Ama Serwa Mensah",
        session: expect.objectContaining({
          _id: "session-customer-profile",
          customerProfileId: "profile-1",
          customerInfo: expect.objectContaining({
            name: "Ama Serwa Mensah",
          }),
        }),
      }),
    );

    await getHandler(updateSession)(ctx as never, {
      sessionId: "session-customer-profile",
      staffProfileId: "cashier-1",
      customerProfileId: undefined,
      customerInfo: undefined,
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "customerCleared",
        customerName: "Ama Serwa Mensah",
        session: expect.objectContaining({
          _id: "session-customer-profile",
          customerProfileId: undefined,
          customerInfo: undefined,
        }),
      }),
    );
  });

  it("records a customer-cleared milestone when session metadata removes the linked customer", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-customer-cleared",
          customerId: "customer-1",
          customerInfo: {
            name: "Ama Serwa",
            email: "ama@example.com",
          },
        }),
      ],
    });

    const result = await getHandler(updateSession)(ctx as never, {
      sessionId: "session-customer-cleared",
      staffProfileId: "cashier-1",
      customerId: undefined,
      customerInfo: undefined,
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-customer-cleared",
        expiresAt: expect.any(Number),
      },
    });
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "customerCleared",
        customerName: "Ama Serwa",
        session: expect.objectContaining({
          _id: "session-customer-cleared",
          customerId: undefined,
          customerInfo: undefined,
        }),
      }),
    );
  });

  it("treats stale completed sessions as a no-op metadata update", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-completed",
          status: "completed",
        }),
      ],
    });

    const result = await getHandler(updateSession)(ctx as never, {
      sessionId: "session-completed",
      staffProfileId: "cashier-1",
      customerId: "customer-1",
      customerInfo: {
        name: "Ama Serwa",
      },
      subtotal: 100,
      tax: 15,
      total: 115,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-completed",
        expiresAt: 4_102_444_800_000,
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "posSession",
      "session-completed",
      expect.anything(),
    );
    expect(mocks.traceRecord).not.toHaveBeenCalled();
  });

  it.each([
    ["voided", "void", 4_102_444_800_000],
    ["expired", "active", 500],
  ] as const)(
    "treats stale %s sessions owned by the cashier as a no-op metadata update",
    async (_label, status, expiresAt) => {
      const ctx = createMutationCtx({
        sessions: [
          buildSession({
            _id: `session-${_label}`,
            status,
            expiresAt,
            customerProfileId: "profile-original",
          }),
        ],
      });

      const result = await getHandler(updateSession)(ctx as never, {
        sessionId: `session-${_label}`,
        staffProfileId: "cashier-1",
        customerProfileId: "profile-new",
        customerInfo: {
          name: "Ama Serwa",
        },
        subtotal: 100,
        tax: 15,
        total: 115,
      });

      expect(result).toEqual({
        kind: "ok",
        data: {
          sessionId: `session-${_label}`,
          expiresAt,
        },
      });
      expect(ctx.sessions[0]).toEqual(
        expect.objectContaining({
          customerProfileId: "profile-original",
          expiresAt,
        }),
      );
      expect(ctx.db.patch).not.toHaveBeenCalledWith(
        "posSession",
        `session-${_label}`,
        expect.anything(),
      );
      expect(mocks.traceRecord).not.toHaveBeenCalled();
    },
  );

  it("records a cart-cleared milestone and clears pending payments", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-clear",
          checkoutStateVersion: 2,
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
        staffProfileId: "cashier-1",
        checkoutStateVersion: 4,
      },
    );

    expect(result).toEqual({
      kind: "ok",
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
          checkoutStateVersion: 4,
          payments: [],
        }),
      }),
    );
    expect(
      ctx.sessions.find((session) => session._id === "session-clear"),
    ).toEqual(
      expect.objectContaining({
        payments: [],
        checkoutStateVersion: 4,
      }),
    );
  });

  it("refuses to clear the cart when the session has no drawer binding", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-clear-no-drawer",
          registerSessionId: undefined,
          checkoutStateVersion: 2,
        }),
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-clear-no-drawer",
          productSkuId: "sku-1",
          quantity: 1,
        },
      ],
    });

    const result = await getHandler(releaseSessionInventoryHoldsAndDeleteItems)(
      ctx as never,
      {
        sessionId: "session-clear-no-drawer",
        staffProfileId: "cashier-1",
        checkoutStateVersion: 4,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "validation_failed",
        message: "Open the cash drawer before modifying this sale.",
      }),
    });
    expect(mocks.releaseInventoryHoldsBatch).not.toHaveBeenCalled();
    expect(ctx.db.delete).not.toHaveBeenCalled();
  });

  it("refuses to clear the cart when the bound drawer is closed", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-clear-closed-drawer",
          checkoutStateVersion: 2,
        }),
      ],
      registerSessions: [
        {
          _id: "drawer-1",
          storeId: "store-1",
          terminalId: "terminal-1",
          registerNumber: "1",
          status: "closed",
        },
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-clear-closed-drawer",
          productSkuId: "sku-1",
          quantity: 1,
        },
      ],
    });

    const result = await getHandler(releaseSessionInventoryHoldsAndDeleteItems)(
      ctx as never,
      {
        sessionId: "session-clear-closed-drawer",
        staffProfileId: "cashier-1",
        checkoutStateVersion: 4,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "validation_failed",
        message: "Open the cash drawer before modifying this sale.",
      }),
    });
    expect(mocks.releaseInventoryHoldsBatch).not.toHaveBeenCalled();
    expect(ctx.db.delete).not.toHaveBeenCalled();
  });

  it("refuses to clear the cart when the bound drawer identity is mismatched", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-clear-mismatched-drawer",
          registerSessionId: "drawer-9",
          checkoutStateVersion: 2,
        }),
      ],
      registerSessions: [
        {
          _id: "drawer-9",
          storeId: "store-1",
          terminalId: "terminal-9",
          registerNumber: "9",
          status: "open",
        },
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-clear-mismatched-drawer",
          productSkuId: "sku-1",
          quantity: 1,
        },
      ],
    });

    const result = await getHandler(releaseSessionInventoryHoldsAndDeleteItems)(
      ctx as never,
      {
        sessionId: "session-clear-mismatched-drawer",
        staffProfileId: "cashier-1",
        checkoutStateVersion: 4,
      },
    );

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "validation_failed",
        message: "Open the cash drawer before modifying this sale.",
      }),
    });
    expect(mocks.releaseInventoryHoldsBatch).not.toHaveBeenCalled();
    expect(ctx.db.delete).not.toHaveBeenCalled();
  });

  it.each([
    [
      "closing",
      {
        _id: "drawer-1",
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "1",
        status: "closing",
      },
    ],
    [
      "mismatched-store",
      {
        _id: "drawer-1",
        storeId: "store-2",
        terminalId: "terminal-1",
        registerNumber: "1",
        status: "open",
      },
    ],
  ] as const)(
    "refuses to clear the cart when the bound drawer is %s and preserves items and holds",
    async (label, drawer) => {
      const ctx = createMutationCtx({
        sessions: [
          buildSession({
            _id: `session-clear-${label}`,
            checkoutStateVersion: 2,
          }),
        ],
        registerSessions: [drawer],
        items: [
          {
            _id: "item-1",
            sessionId: `session-clear-${label}`,
            productSkuId: "sku-1",
            quantity: 1,
          },
        ],
      });

      const result = await getHandler(releaseSessionInventoryHoldsAndDeleteItems)(
        ctx as never,
        {
          sessionId: `session-clear-${label}`,
          staffProfileId: "cashier-1",
          checkoutStateVersion: 4,
        },
      );

      expect(result).toEqual({
        kind: "user_error",
        error: expect.objectContaining({
          code: "validation_failed",
          message: "Open the cash drawer before modifying this sale.",
        }),
      });
      expect(mocks.releaseInventoryHoldsBatch).not.toHaveBeenCalled();
      expect(ctx.db.delete).not.toHaveBeenCalled();
      expect(ctx.items).toEqual([
        expect.objectContaining({
          _id: "item-1",
          sessionId: `session-clear-${label}`,
        }),
      ]);
    },
  );

  it("keeps cleared carts fenced off from older payment-sync writes", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-clear-ordering",
          checkoutStateVersion: 2,
          payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
        }),
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-clear-ordering",
          productSkuId: "sku-1",
          quantity: 1,
        },
      ],
    });

    mocks.traceRecord.mockClear();

    await getHandler(releaseSessionInventoryHoldsAndDeleteItems)(ctx as never, {
      sessionId: "session-clear-ordering",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 4,
    });

    await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-clear-ordering",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 3,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
      stage: "paymentAdded",
      paymentMethod: "cash",
      amount: 120,
    });

    expect(
      ctx.sessions.find((session) => session._id === "session-clear-ordering"),
    ).toEqual(
      expect.objectContaining({
        payments: [],
        checkoutStateVersion: 4,
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledTimes(1);
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "cartCleared",
      }),
    );
  });

  it("ignores stale cart-cleared writes that arrive after a newer checkout sync", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-stale-clear",
          checkoutStateVersion: 5,
          payments: [{ method: "card", amount: 80, timestamp: 2_000 }],
        }),
      ],
      items: [
        {
          _id: "item-1",
          sessionId: "session-stale-clear",
          productSkuId: "sku-1",
          quantity: 1,
        },
      ],
    });

    mocks.traceRecord.mockClear();

    const result = await getHandler(releaseSessionInventoryHoldsAndDeleteItems)(
      ctx as never,
      {
        sessionId: "session-stale-clear",
        staffProfileId: "cashier-1",
        checkoutStateVersion: 4,
      },
    );

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-stale-clear",
      },
    });
    expect(
      ctx.sessions.find((session) => session._id === "session-stale-clear"),
    ).toEqual(
      expect.objectContaining({
        payments: [{ method: "card", amount: 80, timestamp: 2_000 }],
        checkoutStateVersion: 5,
      }),
    );
    expect(mocks.releaseInventoryHoldsBatch).not.toHaveBeenCalled();
    expect(ctx.db.delete).not.toHaveBeenCalled();
    expect(mocks.traceRecord).not.toHaveBeenCalled();
  });

  it("records payment milestones while syncing checkout state", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-checkout",
        }),
      ],
    });

    const paymentResult = await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-checkout",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 1,
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      stage: "paymentAdded",
      paymentMethod: "cash",
      amount: 115,
    });

    expect(paymentResult).toEqual({
      kind: "ok",
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
  });

  it("refuses to sync checkout payments when the session has no drawer binding", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-checkout-no-drawer",
          registerSessionId: undefined,
        }),
      ],
    });

    const result = await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-checkout-no-drawer",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 1,
      payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
      stage: "paymentAdded",
      paymentMethod: "cash",
      amount: 120,
    });

    expect(result).toEqual({
      kind: "user_error",
      error: expect.objectContaining({
        code: "validation_failed",
        message: "Open the cash drawer before modifying this sale.",
      }),
    });
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "posSession",
      "session-checkout-no-drawer",
      expect.anything(),
    );
  });

  it.each([
    [
      "closed",
      {
        _id: "drawer-1",
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "1",
        status: "closed",
      },
    ],
    [
      "closing",
      {
        _id: "drawer-1",
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "1",
        status: "closing",
      },
    ],
    [
      "mismatched-store",
      {
        _id: "drawer-1",
        storeId: "store-2",
        terminalId: "terminal-1",
        registerNumber: "1",
        status: "open",
      },
    ],
    [
      "mismatched-terminal",
      {
        _id: "drawer-1",
        storeId: "store-1",
        terminalId: "terminal-9",
        registerNumber: "1",
        status: "open",
      },
    ],
  ] as const)(
    "refuses to sync checkout payments when the bound drawer is %s before patching",
    async (label, drawer) => {
      const ctx = createMutationCtx({
        sessions: [
          buildSession({
            _id: `session-checkout-${label}`,
            payments: [{ method: "cash", amount: 60, timestamp: 1_000 }],
            checkoutStateVersion: 2,
          }),
        ],
        registerSessions: [drawer],
      });

      const result = await getHandler(syncSessionCheckoutState)(ctx as never, {
        sessionId: `session-checkout-${label}`,
        staffProfileId: "cashier-1",
        checkoutStateVersion: 3,
        payments: [{ method: "cash", amount: 120, timestamp: 1_000 }],
        stage: "paymentUpdated",
        paymentMethod: "cash",
        amount: 120,
        previousAmount: 60,
      });

      expect(result).toEqual({
        kind: "user_error",
        error: expect.objectContaining({
          code: "validation_failed",
          message: "Open the cash drawer before modifying this sale.",
        }),
      });
      expect(ctx.db.patch).not.toHaveBeenCalledWith(
        "posSession",
        `session-checkout-${label}`,
        expect.anything(),
      );
      expect(mocks.traceRecord).not.toHaveBeenCalled();
      expect(ctx.sessions[0]).toEqual(
        expect.objectContaining({
          payments: [{ method: "cash", amount: 60, timestamp: 1_000 }],
          checkoutStateVersion: 2,
        }),
      );
    },
  );

  it("ignores stale checkout-state sync writes without patching or tracing", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-stale-checkout-only",
          checkoutStateVersion: 5,
          payments: [{ method: "card", amount: 80, timestamp: 2_000 }],
        }),
      ],
    });

    const result = await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-stale-checkout-only",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 4,
      payments: [{ method: "cash", amount: 80, timestamp: 1_000 }],
      stage: "paymentAdded",
      paymentMethod: "cash",
      amount: 80,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-stale-checkout-only",
        expiresAt: 4_102_444_800_000,
      },
    });
    expect(ctx.db.patch).not.toHaveBeenCalledWith(
      "posSession",
      "session-stale-checkout-only",
      expect.anything(),
    );
    expect(mocks.traceRecord).not.toHaveBeenCalled();
    expect(ctx.sessions[0]).toEqual(
      expect.objectContaining({
        payments: [{ method: "card", amount: 80, timestamp: 2_000 }],
        checkoutStateVersion: 5,
      }),
    );
  });

  it("records payment update, removal, and clear milestones while syncing checkout state", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-payment-mutations",
          payments: [
            { method: "cash", amount: 60, timestamp: 1_000 },
            { method: "card", amount: 55, timestamp: 2_000 },
          ],
        }),
      ],
    });

    await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-payment-mutations",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 1,
      payments: [
        { method: "cash", amount: 70, timestamp: 1_000 },
        { method: "card", amount: 55, timestamp: 2_000 },
      ],
      stage: "paymentUpdated",
      paymentMethod: "cash",
      amount: 70,
      previousAmount: 60,
    });

    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "paymentUpdated",
        paymentMethod: "cash",
        amount: 70,
        previousAmount: 60,
        paymentCount: 2,
      }),
    );

    await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-payment-mutations",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 2,
      payments: [{ method: "cash", amount: 70, timestamp: 1_000 }],
      stage: "paymentRemoved",
      paymentMethod: "card",
      amount: 55,
    });

    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "paymentRemoved",
        paymentMethod: "card",
        amount: 55,
        paymentCount: 1,
      }),
    );

    await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-payment-mutations",
      staffProfileId: "cashier-1",
      checkoutStateVersion: 3,
      payments: [],
      stage: "paymentsCleared",
    });

    expect(mocks.traceRecord).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stage: "paymentsCleared",
        paymentCount: 0,
      }),
    );
    expect(
      ctx.sessions.find((session) => session._id === "session-payment-mutations")?.payments,
    ).toEqual([]);
  });

  it("ignores stale checkout-state sync writes that arrive after a newer payment snapshot", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-payment-ordering",
        }),
      ],
    });

    mocks.traceRecord.mockClear();

    await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-payment-ordering",
      staffProfileId: "cashier-1",
      payments: [
        { method: "cash", amount: 60, timestamp: 1_000 },
        { method: "card", amount: 55, timestamp: 2_000 },
      ],
      stage: "paymentAdded",
      paymentMethod: "card",
      amount: 55,
      checkoutStateVersion: 2,
    });

    await getHandler(syncSessionCheckoutState)(ctx as never, {
      sessionId: "session-payment-ordering",
      staffProfileId: "cashier-1",
      payments: [{ method: "cash", amount: 60, timestamp: 1_000 }],
      stage: "paymentRemoved",
      paymentMethod: "card",
      amount: 55,
      checkoutStateVersion: 1,
    });

    expect(
      ctx.sessions.find((session) => session._id === "session-payment-ordering")?.payments,
    ).toEqual([
      { method: "cash", amount: 60, timestamp: 1_000 },
      { method: "card", amount: 55, timestamp: 2_000 },
    ]);
    expect(mocks.traceRecord).toHaveBeenCalledTimes(1);
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "paymentAdded",
        paymentCount: 2,
      }),
    );
  });

  it("keeps checkout-state sync successful when trace recording fails", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
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
      staffProfileId: "cashier-1",
      checkoutStateVersion: 1,
      payments: [{ method: "cash", amount: 115, timestamp: 1_000 }],
      stage: "paymentAdded",
      paymentMethod: "cash",
      amount: 115,
    });

    expect(result).toEqual({
      kind: "ok",
      data: {
        sessionId: "session-trace-failure",
        expiresAt: expect.any(Number),
      },
    });
    expect(
      ctx.sessions.find((session) => session._id === "session-trace-failure")?.payments,
    ).toEqual([{ method: "cash", amount: 115, timestamp: 1_000 }]);
    expect(consoleError).toHaveBeenCalledWith(
      "[workflow-trace] pos.session.lifecycle.paymentAdded",
      expect.any(Error),
    );
  });

  it("does not overwrite a voided session trace when cron expires old sessions", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
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

    expect(result.releasedCount).toBe(2);
    expect(new Set(result.sessionIds)).toEqual(
      new Set(["session-active", "session-void"]),
    );
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
    expect(consoleLog).toHaveBeenCalledWith(
      "[POS] Found 2 expired sessions to process",
    );
  });

  it("releases expired held sessions through cron", async () => {
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-held",
          sessionNumber: "SES-HELD",
          status: "held",
          expiresAt: 500,
        }),
      ],
      items: [
        {
          _id: "item-held",
          sessionId: "session-held",
          productSkuId: "sku-1",
          quantity: 4,
        },
      ],
    });

    const result = await getHandler(releasePosSessionItems)(ctx as never, {});

    expect(result).toEqual({
      releasedCount: 1,
      sessionIds: ["session-held"],
    });
    expect(ctx.sessions[0]).toMatchObject({
      _id: "session-held",
      status: "expired",
      notes: "Session expired - inventory holds released",
    });
    expect(mocks.traceRecord).toHaveBeenCalledTimes(1);
    expect(consoleLog).toHaveBeenCalledWith(
      "[POS] Found 1 expired sessions to process",
    );
  });

  it("expires other-terminal sessions immediately during cashier recovery", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildSession({
          _id: "session-current",
          terminalId: "terminal-1",
          status: "active",
        }),
        buildSession({
          _id: "session-other-active",
          sessionNumber: "SES-OTHER-ACTIVE",
          terminalId: "terminal-2",
          status: "active",
        }),
        buildSession({
          _id: "session-other-held",
          sessionNumber: "SES-OTHER-HELD",
          terminalId: "terminal-3",
          status: "held",
        }),
      ],
      items: [
        {
          _id: "item-current",
          sessionId: "session-current",
          productSkuId: "sku-current",
          quantity: 1,
        },
        {
          _id: "item-other-active",
          sessionId: "session-other-active",
          productSkuId: "sku-active",
          quantity: 3,
        },
        {
          _id: "item-other-held",
          sessionId: "session-other-held",
          productSkuId: "sku-held",
          quantity: 2,
        },
      ],
    });

    const result = await getHandler(expireAllSessionsForStaff)(ctx as never, {
      staffProfileId: "cashier-1",
      terminalId: "terminal-1",
    });

    expect(result).toEqual({
      success: true,
      data: { staffProfileId: "cashier-1" },
    });
    expect(ctx.sessions.find((session) => session._id === "session-current")).toEqual(
      expect.objectContaining({
        status: "active",
        terminalId: "terminal-1",
      }),
    );
    expect(
      ctx.sessions.find((session) => session._id === "session-other-active"),
    ).toEqual(
      expect.objectContaining({
        status: "expired",
        notes: "Session expired - inventory holds released",
      }),
    );
    expect(
      ctx.sessions.find((session) => session._id === "session-other-held"),
    ).toEqual(
      expect.objectContaining({
        status: "expired",
        notes: "Session expired - inventory holds released",
      }),
    );
    expect(mocks.releaseInventoryHoldsBatch.mock.calls).toEqual(
      expect.arrayContaining([
        [
          ctx.db,
          {
            sessionId: "session-other-active",
            items: [{ skuId: "sku-active", quantity: 3 }],
            now: expect.any(Number),
          },
        ],
        [
          ctx.db,
          {
            sessionId: "session-other-held",
            items: [{ skuId: "sku-held", quantity: 2 }],
            now: expect.any(Number),
          },
        ],
      ]),
    );
    expect(mocks.releaseInventoryHoldsBatch).toHaveBeenCalledTimes(2);
    expect(mocks.traceRecord).toHaveBeenCalledTimes(2);
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "expired",
        session: expect.objectContaining({
          _id: "session-other-active",
          status: "expired",
        }),
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "expired",
        session: expect.objectContaining({
          _id: "session-other-held",
          status: "expired",
        }),
      }),
    );
  });
});
