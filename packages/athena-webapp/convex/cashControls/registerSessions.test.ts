import { describe, expect, it, vi } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  assertRegisterSessionIdentity,
  assertRegisterSessionMatchesTransaction,
  assertValidRegisterSessionTransition,
  buildClosedRegisterSessionPatch,
  buildRegisterSessionDepositPatch,
  buildRegisterSessionDateDerivationPatch,
  buildRegisterSessionCloseoutPatch,
  buildRegisterSessionOpeningFloatCorrectionPatch,
  buildRejectedRegisterSessionCloseoutPatch,
  buildReopenedRegisterSessionPatch,
  buildRegisterSession,
  buildRegisterSessionTransactionPatch,
  openRegisterSession,
  calculateRegisterSessionCashDelta,
  recordRegisterSessionDeposit,
  recordRegisterSessionTransaction,
} from "../operations/registerSessions";
import { recordRegisterSessionTraceBestEffort } from "../operations/registerSessionTracing";
import type { StoreScheduleContext } from "../lib/storeScheduleTime";

vi.mock("../operations/registerSessionTracing", () => ({
  recordRegisterSessionTraceBestEffort: vi.fn(() => ({
    traceCreated: false,
  })),
}));

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("cash controls register sessions", () => {
  it("opens sessions with opening float as the initial expected cash", () => {
    const session = buildRegisterSession({
      storeId: "store_1" as Id<"store">,
      openingFloat: 5000,
      registerNumber: "A1",
    });

    expect(session).toMatchObject({
      expectedCash: 5000,
      openingFloat: 5000,
      registerNumber: "A1",
      status: "open",
    });
    expect(session.openedAt).toEqual(expect.any(Number));
  });

  it("derives register-session operating date evidence from store schedule context", () => {
    const resolvedContext = {
      kind: "resolved",
      timezone: "America/New_York",
      operatingDate: "2026-06-28",
      phase: "during_window",
      isOpen: true,
      scheduleVersionId: "schedule_1",
      currentWindow: {
        localDate: "2026-06-28",
        startMinute: 600,
        endMinute: 120,
        startsAt: 1_800_000,
        endsAt: 1_860_000,
        crossesDateBoundary: true,
        localStartLabel: "10:00",
        localEndLabel: "02:00",
      },
      nextWindow: null,
    } satisfies StoreScheduleContext;

    expect(
      buildRegisterSessionDateDerivationPatch({
        closeoutContext: resolvedContext,
        closeoutOwnedAt: 1_850_000,
        closeoutOwnershipSource: "closed_record",
        openedAt: 1_800_000,
        openedContext: resolvedContext,
      }),
    ).toEqual({
      closeoutOwnedAt: 1_850_000,
      closeoutOwnershipSource: "closed_record",
      closeoutOperatingDate: "2026-06-28",
      closeoutOperatingDateDerivationStatus: "resolved",
      closeoutOperatingDateEndAt: 1_860_000,
      closeoutOperatingDateScheduleVersionId: "schedule_1",
      closeoutOperatingDateStartAt: 1_800_000,
      openedOperatingDate: "2026-06-28",
      openedOperatingDateDerivationStatus: "resolved",
      openedOperatingDateEndAt: 1_860_000,
      openedOperatingDateScheduleVersionId: "schedule_1",
      openedOperatingDateStartAt: 1_800_000,
    });

    expect(
      buildRegisterSessionDateDerivationPatch({
        closeoutContext: {
          kind: "missing_schedule",
          timezone: null,
          operatingDate: "2026-06-28",
          phase: "unavailable",
          isOpen: false,
          scheduleVersionId: null,
          currentWindow: null,
          nextWindow: null,
        },
        closeoutOwnedAt: 1_850_000,
        closeoutOwnershipSource: "closeout_submission",
      }),
    ).toMatchObject({
      closeoutOwnedAt: 1_850_000,
      closeoutOwnershipSource: "closeout_submission",
      closeoutOperatingDate: undefined,
      closeoutOperatingDateDerivationStatus: "missing_schedule",
    });
  });

  it("counts only net cash tendered toward expected cash", () => {
    expect(
      calculateRegisterSessionCashDelta({
        changeGiven: 1000,
        payments: [
          { amount: 9000, method: "cash", timestamp: 1 },
          { amount: 3000, method: "card", timestamp: 2 },
        ],
      })
    ).toBe(8000);

    expect(
      calculateRegisterSessionCashDelta({
        payments: [{ amount: 4500, method: "mobile_money", timestamp: 1 }],
      })
    ).toBe(0);
  });

  it("blocks invalid register closeout transitions", () => {
    expect(() =>
      assertValidRegisterSessionTransition("open", "closed")
    ).toThrow("Cannot change register session from open to closed.");

    expect(() =>
      assertValidRegisterSessionTransition("active", "open")
    ).toThrow("Cannot change register session from active to open.");

    expect(() =>
      assertValidRegisterSessionTransition("open", "active")
    ).not.toThrow();

    expect(() =>
      assertValidRegisterSessionTransition("active", "closing")
    ).not.toThrow();

    expect(() =>
      assertValidRegisterSessionTransition("closing", "closed")
    ).not.toThrow();

    expect(() =>
      assertValidRegisterSessionTransition("closing", "active")
    ).not.toThrow();

    expect(() =>
      assertValidRegisterSessionTransition("closed", "closed")
    ).toThrow("Register session is already closed.");
  });

  it("requires terminal identity when opening a session", () => {
    expect(() =>
      assertRegisterSessionIdentity({})
    ).toThrow("Register sessions require a terminal.");

    expect(() =>
      assertRegisterSessionIdentity({ registerNumber: "A1" })
    ).toThrow("Register sessions require a terminal.");

    expect(() =>
      assertRegisterSessionIdentity({
        terminalId: "terminal_1" as Id<"posTerminal">,
      })
    ).not.toThrow();
  });

  it("rejects transaction activity that does not match the register session identity", () => {
    const registerSession = buildRegisterSession({
      storeId: "store_1" as Id<"store">,
      openingFloat: 5000,
      registerNumber: "A1",
      terminalId: "terminal_1" as Id<"posTerminal">,
    });

    expect(() =>
      assertRegisterSessionMatchesTransaction(registerSession, {})
    ).toThrow(
      "Register session transactions must include a terminal."
    );

    expect(() =>
      assertRegisterSessionMatchesTransaction(registerSession, {
        terminalId: "terminal-2" as Id<"posTerminal">,
      })
    ).toThrow("Register session does not match the transaction identity.");

    expect(() =>
      assertRegisterSessionMatchesTransaction(registerSession, {
        terminalId: "terminal_1" as Id<"posTerminal">,
      })
    ).not.toThrow();
  });

  it("builds register-session cash updates for sales and voids", () => {
    const registerSession = {
      ...buildRegisterSession({
        storeId: "store_1" as Id<"store">,
        openingFloat: 5000,
        registerNumber: "A1",
      }),
      expectedCash: 5000,
    };

    expect(
      buildRegisterSessionTransactionPatch(registerSession, {
        adjustmentKind: "sale",
        changeGiven: 1000,
        payments: [{ amount: 9000, method: "cash", timestamp: 1 }],
      })
    ).toEqual({
      expectedCash: 13000,
      status: "active",
    });

    expect(
      buildRegisterSessionTransactionPatch(
        {
          ...registerSession,
          countedCash: 12000,
          expectedCash: 13000,
          status: "closed" as const,
        },
        {
          adjustmentKind: "void",
          changeGiven: 1000,
          payments: [{ amount: 9000, method: "cash", timestamp: 1 }],
        }
      )
    ).toEqual({
      expectedCash: 5000,
      variance: 7000,
    });
  });

  it("skips duplicate register-session transaction writes by idempotency key", async () => {
    const session = {
      ...buildRegisterSession({
        storeId: "store_1" as Id<"store">,
        openingFloat: 5000,
        registerNumber: "A1",
        terminalId: "terminal_1" as Id<"posTerminal">,
      }),
      _id: "register_session_1",
      expectedCash: 13000,
      recordedTransactionKeys: ["posTransaction:txn-1:void"],
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => session),
        patch,
      },
    };

    await expect(
      getHandler(recordRegisterSessionTransaction)(ctx, {
        adjustmentKind: "void",
        changeGiven: 1000,
        idempotencyKey: "posTransaction:txn-1:void",
        payments: [{ amount: 9000, method: "cash", timestamp: 1 }],
        registerSessionId: "register_session_1",
        storeId: "store_1",
        terminalId: "terminal_1",
      }),
    ).resolves.toEqual(session);

    expect(patch).not.toHaveBeenCalled();
    expect(recordRegisterSessionTraceBestEffort).not.toHaveBeenCalled();
  });

  it("rejects sale writes against closeout-rejected sessions", async () => {
    const session = {
      ...buildRegisterSession({
        storeId: "store_1" as Id<"store">,
        openingFloat: 5000,
        registerNumber: "A1",
        terminalId: "terminal_1" as Id<"posTerminal">,
      }),
      _id: "register_session_1",
      status: "closeout_rejected" as const,
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => session),
        patch,
      },
    };

    await expect(
      getHandler(recordRegisterSessionTransaction)(ctx, {
        adjustmentKind: "sale",
        payments: [{ amount: 9000, method: "cash", timestamp: 1 }],
        registerSessionId: "register_session_1",
        storeId: "store_1",
        terminalId: "terminal_1",
      }),
    ).rejects.toThrow("Register session is not accepting new transactions.");

    expect(patch).not.toHaveBeenCalled();
    expect(recordRegisterSessionTraceBestEffort).not.toHaveBeenCalled();
  });

  it("opens replacement sessions after submitted or rejected closeouts", async () => {
    const existingSessions = [
      {
        _id: "register_session_closing",
        countedCash: 4500,
        expectedCash: 5000,
        status: "closing",
        storeId: "store_1",
        terminalId: "terminal_1",
        registerNumber: "A1",
        variance: -500,
      },
      {
        _id: "register_session_rejected",
        countedCash: 4500,
        expectedCash: 5000,
        status: "closeout_rejected",
        storeId: "store_1",
        terminalId: "terminal_2",
        registerNumber: "B2",
        variance: -500,
      },
    ];
    const insertedSessions: unknown[] = [];
    const ctx = {
      db: {
        get: vi.fn(async (_table: string, id: string) =>
          insertedSessions.find((session) => (session as { _id: string })._id === id) ??
          null,
        ),
        insert: vi.fn(async (_table: string, value: unknown) => {
          const id = `register_session_new_${insertedSessions.length + 1}`;
          insertedSessions.push({ ...(value as object), _id: id });
          return id;
        }),
        patch: vi.fn(),
        query: vi.fn((tableName: string) => ({
          withIndex: vi.fn((indexName: string) => ({
            take: vi.fn(async () =>
              tableName === "storeSchedule" ? [] : existingSessions,
            ),
            order: vi.fn(() => ({
              take: vi.fn(async () =>
                tableName === "storeSchedule" ? [] : existingSessions,
              ),
              first: vi.fn(async () =>
                indexName === "by_terminalId"
                  ? existingSessions.shift() ?? null
                  : null,
              ),
            })),
          })),
        })),
      },
    };

    await expect(
      getHandler(openRegisterSession)(ctx, {
        storeId: "store_1",
        terminalId: "terminal_1",
        registerNumber: "A1",
        openingFloat: 1000,
      }),
    ).resolves.toMatchObject({ status: "open" });
    await expect(
      getHandler(openRegisterSession)(ctx, {
        storeId: "store_1",
        terminalId: "terminal_2",
        registerNumber: "B2",
        openingFloat: 1000,
      }),
    ).resolves.toMatchObject({ status: "open" });
  });

  it("computes closeout variance before final signoff", () => {
    const registerSession = buildRegisterSession({
      storeId: "store_1" as Id<"store">,
      openingFloat: 5000,
      registerNumber: "A1",
    });

    expect(
      buildRegisterSessionCloseoutPatch(registerSession, {
        countedCash: 4800,
        notes: "Counted after shift.",
      })
    ).toEqual({
      countedCash: 4800,
      notes: "Counted after shift.",
      status: "closing",
      variance: -200,
    });

    const closedPatch = buildClosedRegisterSessionPatch(
      {
        ...registerSession,
        status: "closing" as const,
      },
      {
        countedCash: 5200,
      }
    );

    expect(closedPatch).toMatchObject({
      countedCash: 5200,
      status: "closed",
      variance: 200,
    });
    expect(closedPatch.closedAt).toEqual(expect.any(Number));
  });

  it("reopens closeout sessions by clearing closeout draft fields", () => {
    expect(
      buildReopenedRegisterSessionPatch({
        status: "closing",
      })
    ).toMatchObject({
      countedCash: undefined,
      closeoutOwnedAt: undefined,
      closeoutOperatingDate: undefined,
      closeoutOwnershipSource: undefined,
      managerApprovalRequestId: undefined,
      status: "active",
      variance: undefined,
    });
  });

  it("moves rejected closeout reviews into review-only state without clearing evidence", () => {
    expect(
      buildRejectedRegisterSessionCloseoutPatch({
        countedCash: 45000,
        expectedCash: 50000,
        managerApprovalRequestId: "approval-1" as Id<"approvalRequest">,
        notes: "cash count issue",
        status: "closing",
        variance: -5000,
      }),
    ).toEqual({
      managerApprovalRequestId: undefined,
      status: "closeout_rejected",
    });

    expect(() =>
      buildRejectedRegisterSessionCloseoutPatch({
        expectedCash: 50000,
        status: "active",
      }),
    ).toThrow(
      "Active register sessions require reviewed closeout evidence before rejection.",
    );

    expect(
      buildRejectedRegisterSessionCloseoutPatch(
        {
          countedCash: 45000,
          expectedCash: 50000,
          notes: "cash count issue",
          status: "active",
          variance: -5000,
        },
        { allowActiveReviewedCloseoutEvidence: true },
      ),
    ).toEqual({
      managerApprovalRequestId: undefined,
      status: "closeout_rejected",
    });
  });

  it("subtracts recorded deposits from expected cash without letting the drawer go negative", () => {
    const registerSession = {
      ...buildRegisterSession({
        storeId: "store_1" as Id<"store">,
        openingFloat: 5000,
        registerNumber: "A1",
      }),
      countedCash: 12000,
      expectedCash: 13000,
      status: "active" as const,
    };

    expect(
      buildRegisterSessionDepositPatch(registerSession, {
        amount: 2500,
      })
    ).toEqual({
      expectedCash: 10500,
      variance: 1500,
    });

    expect(() =>
      buildRegisterSessionDepositPatch(registerSession, {
        amount: 15000,
      })
    ).toThrow("Register session expected cash cannot be negative.");
  });

  it("rejects deposits against closeout-rejected sessions", async () => {
    const session = {
      ...buildRegisterSession({
        storeId: "store_1" as Id<"store">,
        openingFloat: 5000,
        registerNumber: "A1",
        terminalId: "terminal_1" as Id<"posTerminal">,
      }),
      _id: "register_session_1",
      status: "closeout_rejected" as const,
    };
    const patch = vi.fn();
    const ctx = {
      db: {
        get: vi.fn(async () => session),
        patch,
      },
    };

    await expect(
      getHandler(recordRegisterSessionDeposit)(ctx, {
        amount: 2500,
        registerSessionId: "register_session_1",
      }),
    ).rejects.toThrow(
      "Cannot record a deposit for a closed register session.",
    );
    expect(patch).not.toHaveBeenCalled();
  });

  it("corrects opening float by applying only the float delta to expected cash", () => {
    const registerSession = {
      ...buildRegisterSession({
        storeId: "store_1" as Id<"store">,
        openingFloat: 30000,
        registerNumber: "A1",
      }),
      countedCash: 37000,
      expectedCash: 45000,
      status: "active" as const,
    };

    expect(
      buildRegisterSessionOpeningFloatCorrectionPatch(registerSession, {
        correctedOpeningFloat: 20000,
      })
    ).toEqual({
      expectedCash: 35000,
      openingFloat: 20000,
      variance: 2000,
    });
  });

  it("does not create a patch when the corrected opening float is unchanged", () => {
    const registerSession = buildRegisterSession({
      storeId: "store_1" as Id<"store">,
      openingFloat: 30000,
      registerNumber: "A1",
    });

    expect(
      buildRegisterSessionOpeningFloatCorrectionPatch(registerSession, {
        correctedOpeningFloat: 30000,
      })
    ).toEqual({});
  });
});
