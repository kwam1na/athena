import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  traceRecord: vi.fn(),
}));

vi.mock("./registerSessionTracing", () => ({
  recordRegisterSessionTraceBestEffort: mocks.traceRecord,
}));

import {
  buildClosedRegisterSessionPatch,
  buildReopenedClosedRegisterSessionPatch,
  getOpenRegisterSession,
  getRegisterSessionForRegisterState,
  openRegisterSession,
  recordRegisterSessionTransaction,
} from "./registerSessions";

type RegisterSessionRecord = {
  _id: string;
  expectedCash: number;
  openingFloat: number;
  openedAt: number;
  organizationId?: string;
  registerNumber?: string;
  status: "open" | "active" | "closing" | "closed";
  storeId: string;
  terminalId?: string;
  workflowTraceId?: string;
};

function buildRegisterSession(
  overrides?: Partial<RegisterSessionRecord>,
): RegisterSessionRecord {
  return {
    _id: "session-1",
    expectedCash: 5_000,
    openingFloat: 5_000,
    openedAt: 111,
    organizationId: "org-1",
    registerNumber: "A1",
    status: "open",
    storeId: "store-1",
    terminalId: "terminal-1",
    ...overrides,
  };
}

function createMutationCtx(seed?: { sessions?: RegisterSessionRecord[] }) {
  const sessions = [...(seed?.sessions ?? [])];
  const db = {
    get: vi.fn(async (table: string, id: string) => {
      if (table !== "registerSession") {
        return null;
      }

      return sessions.find((session) => session._id === id) ?? null;
    }),
    insert: vi.fn(async (table: string, value: Omit<RegisterSessionRecord, "_id">) => {
      if (table !== "registerSession") {
        throw new Error(`Unsupported insert into ${table}`);
      }

      const record = {
        _id: `session-${sessions.length + 1}`,
        ...value,
      } as RegisterSessionRecord;
      sessions.push(record);
      return record._id;
    }),
    patch: vi.fn(async (table: string, id: string, patch: Record<string, unknown>) => {
      if (table !== "registerSession") {
        return;
      }

      const session = sessions.find((entry) => entry._id === id);
      if (!session) {
        return;
      }

      Object.assign(session, patch);
    }),
    query: vi.fn((table: string) => ({
      withIndex(indexName: string, buildQuery?: (q: {
        eq: (field: string, value: string) => unknown;
      }) => unknown) {
        if (table !== "registerSession") {
          throw new Error(`Unsupported query table ${table}`);
        }

        if (
          indexName !== "by_storeId_registerNumber" &&
          indexName !== "by_terminalId"
        ) {
          throw new Error(`Unsupported registerSession index ${indexName}`);
        }

        const filters = new Map<string, string>();
        const queryBuilder = {
          eq(field: string, value: string) {
            filters.set(field, value);
            return queryBuilder;
          },
        };
        buildQuery?.(queryBuilder);

        return {
          order() {
            return {
              first: async () =>
                [...sessions]
                  .reverse()
                  .find((session) =>
                    [...filters].every(
                      ([field, value]) =>
                        session[field as keyof RegisterSessionRecord] === value,
                    ),
                  ) ?? null,
            };
          },
        };
      },
    })),
  };

  return {
    db,
    sessions,
  };
}

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("register session workflow trace handlers", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.spyOn(Date, "now").mockReturnValue(999);
    mocks.traceRecord.mockResolvedValue({
      traceCreated: true,
      traceId: "register_session:session-1",
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("appends closeout ledger entries when closing and reopening a closed drawer", () => {
    const closedPatch = buildClosedRegisterSessionPatch(
      buildRegisterSession({ status: "closing" }) as never,
      {
        closedByStaffProfileId: "staff-1" as never,
        closedByUserId: "user-1" as never,
        countedCash: 5_500,
        notes: "Initial count.",
      },
    );

    expect(closedPatch).toMatchObject({
      closeoutRecords: [
        {
          actorStaffProfileId: "staff-1",
          actorUserId: "user-1",
          countedCash: 5_500,
          expectedCash: 5_000,
          notes: "Initial count.",
          type: "closed",
          variance: 500,
        },
      ],
      countedCash: 5_500,
      status: "closed",
      variance: 500,
    });

    const reopenPatch = buildReopenedClosedRegisterSessionPatch(
      {
        ...buildRegisterSession({ status: "closed" }),
        ...closedPatch,
      } as never,
      {
        actorStaffProfileId: "staff-2" as never,
        actorUserId: "user-2" as never,
      },
    );

    expect(reopenPatch).toMatchObject({
      closedAt: undefined,
      closedByStaffProfileId: undefined,
      closedByUserId: undefined,
      closeoutRecords: [
        expect.objectContaining({ type: "closed" }),
        expect.objectContaining({
          actorStaffProfileId: "staff-2",
          actorUserId: "user-2",
          countedCash: 5_500,
          expectedCash: 5_000,
          reason: "Closed register closeout reopened for correction.",
          type: "reopened",
          variance: 500,
        }),
      ],
      managerApprovalRequestId: undefined,
      status: "closing",
    });
  });

  it("records an opened trace after opening a register session", async () => {
    const ctx = createMutationCtx();

    const session = await getHandler(openRegisterSession)(ctx as never, {
      storeId: "store-1",
      organizationId: "org-1",
      terminalId: "terminal-1",
      registerNumber: "A1",
      openingFloat: 5_000,
    });

    expect(session).toEqual(
      expect.objectContaining({
        _id: "session-1",
        registerNumber: "A1",
        status: "open",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: "opened",
        session: expect.objectContaining({
          _id: "session-1",
          status: "open",
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("does not persist workflowTraceId when the trace row was not created", async () => {
    mocks.traceRecord.mockResolvedValueOnce({
      traceCreated: false,
      traceId: "register_session:session-1",
    });
    const ctx = createMutationCtx();

    await getHandler(openRegisterSession)(ctx as never, {
      storeId: "store-1",
      organizationId: "org-1",
      terminalId: "terminal-1",
      registerNumber: "A1",
      openingFloat: 5_000,
    });

    expect(ctx.db.patch).not.toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("returns an open register session for POS active drawer lookup", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "open",
        }),
      ],
    });

    const session = await getHandler(getOpenRegisterSession)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      registerNumber: "A1",
    });

    expect(session).toEqual(expect.objectContaining({ _id: "session-1" }));
  });

  it("does not resolve POS active drawer lookup without terminal identity", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "open",
        }),
      ],
    });

    const session = await getHandler(getOpenRegisterSession)(ctx as never, {
      storeId: "store-1",
      registerNumber: "A1",
    });

    expect(session).toBeNull();
  });

  it("does not return a closing register session for POS active drawer lookup", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "closing",
        }),
      ],
    });

    const session = await getHandler(getOpenRegisterSession)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      registerNumber: "A1",
    });

    expect(session).toBeNull();
  });

  it("does not return an open register session from a different terminal", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "open",
          terminalId: "terminal-2",
        }),
      ],
    });

    const session = await getHandler(getOpenRegisterSession)(ctx as never, {
      storeId: "store-1",
      terminalId: "terminal-1",
      registerNumber: "A1",
    });

    expect(session).toBeNull();
  });

  it("returns a closing register session for POS register-state gate display", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "closing",
        }),
      ],
    });

    const session = await getHandler(getRegisterSessionForRegisterState)(
      ctx as never,
      {
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "A1",
      },
    );

    expect(session).toEqual(
      expect.objectContaining({ _id: "session-1", status: "closing" }),
    );
  });

  it("does not return a closed register session for POS register-state gate display", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "closed",
        }),
      ],
    });

    const session = await getHandler(getRegisterSessionForRegisterState)(
      ctx as never,
      {
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "A1",
      },
    );

    expect(session).toBeNull();
  });

  it("does not return POS register-state session without terminal identity", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "closing",
        }),
      ],
    });

    const session = await getHandler(getRegisterSessionForRegisterState)(
      ctx as never,
      {
        storeId: "store-1",
        registerNumber: "A1",
      },
    );

    expect(session).toBeNull();
  });

  it("does not return register-state session for a different terminal", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "closing",
          terminalId: "terminal-2",
        }),
      ],
    });

    const session = await getHandler(getRegisterSessionForRegisterState)(
      ctx as never,
      {
        storeId: "store-1",
        terminalId: "terminal-1",
        registerNumber: "A1",
      },
    );

    expect(session).toBeNull();
  });

  it("still blocks opening a duplicate drawer while the latest session is closing", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "closing",
        }),
      ],
    });

    await expect(
      getHandler(openRegisterSession)(ctx as never, {
        storeId: "store-1",
        organizationId: "org-1",
        terminalId: "terminal-1",
        registerNumber: "A1",
        openingFloat: 5_000,
      }),
    ).rejects.toThrow("A register session is already open for this terminal.");
  });

  it("blocks opening the same register number on a different terminal", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "open",
          terminalId: "terminal-2",
          registerNumber: "A1",
        }),
      ],
    });

    await expect(
      getHandler(openRegisterSession)(ctx as never, {
        storeId: "store-1",
        organizationId: "org-1",
        terminalId: "terminal-1",
        registerNumber: "A1",
        openingFloat: 5_000,
      }),
    ).rejects.toThrow("A register session is already open for this register number.");
  });

  it("still blocks opening a drawer when terminal identity is missing", async () => {
    const ctx = createMutationCtx({
      sessions: [
        buildRegisterSession({
          _id: "session-1",
          status: "open",
          terminalId: "terminal-2",
          registerNumber: "A1",
        }),
      ],
    });

    await expect(
      getHandler(openRegisterSession)(ctx as never, {
        storeId: "store-1",
        organizationId: "org-1",
        registerNumber: "A1",
        openingFloat: 5_000,
      }),
    ).rejects.toThrow("Register sessions require a terminal.");
  });

  it("records a sale adjustment trace when register-session cash changes", async () => {
    const ctx = createMutationCtx({
      sessions: [buildRegisterSession()],
    });

    const updatedSession = await getHandler(recordRegisterSessionTransaction)(
      ctx as never,
      {
        registerSessionId: "session-1",
        storeId: "store-1",
        adjustmentKind: "sale",
        payments: [{ method: "cash", amount: 9_000, timestamp: 1 }],
        changeGiven: 1_000,
        registerNumber: "A1",
        terminalId: "terminal-1",
      },
    );

    expect(updatedSession).toEqual(
      expect.objectContaining({
        _id: "session-1",
        expectedCash: 13_000,
        status: "active",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: "sale_recorded",
        occurredAt: 999,
        amount: 8_000,
        session: expect.objectContaining({
          _id: "session-1",
          status: "active",
        }),
      }),
    );
    expect(ctx.db.patch).toHaveBeenCalledWith("registerSession", "session-1", {
      workflowTraceId: "register_session:session-1",
    });
  });

  it("records a void adjustment trace when register-session cash decreases", async () => {
    const ctx = createMutationCtx({
      sessions: [buildRegisterSession({ expectedCash: 13_000, status: "closing" })],
    });

    const updatedSession = await getHandler(recordRegisterSessionTransaction)(
      ctx as never,
      {
        registerSessionId: "session-1",
        storeId: "store-1",
        adjustmentKind: "void",
        payments: [{ method: "cash", amount: 4_000, timestamp: 1 }],
        changeGiven: 500,
        registerNumber: "A1",
        terminalId: "terminal-1",
      },
    );

    expect(updatedSession).toEqual(
      expect.objectContaining({
        _id: "session-1",
        expectedCash: 9_500,
        status: "closing",
      }),
    );
    expect(mocks.traceRecord).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        stage: "void_recorded",
        occurredAt: 999,
        amount: 3_500,
      }),
    );
  });
});
