import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  assertRegisterSessionIdentity,
  assertRegisterSessionMatchesTransaction,
  assertValidRegisterSessionTransition,
  buildClosedRegisterSessionPatch,
  buildRegisterSessionDepositPatch,
  buildRegisterSessionCloseoutPatch,
  buildRegisterSession,
  buildRegisterSessionTransactionPatch,
  calculateRegisterSessionCashDelta,
} from "../operations/registerSessions";

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
});
