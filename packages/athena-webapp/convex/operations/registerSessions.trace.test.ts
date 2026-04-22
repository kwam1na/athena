import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  traceRecord: vi.fn(),
}));

vi.mock("./registerSessionTracing", () => ({
  recordRegisterSessionTraceBestEffort: mocks.traceRecord,
}));

import { openRegisterSession, recordRegisterSessionTransaction } from "./registerSessions";

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
      withIndex(indexName: string) {
        if (table !== "registerSession") {
          throw new Error(`Unsupported query table ${table}`);
        }

        if (
          indexName !== "by_storeId_registerNumber" &&
          indexName !== "by_terminalId"
        ) {
          throw new Error(`Unsupported registerSession index ${indexName}`);
        }

        return {
          order() {
            return {
              first: async () => null,
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
