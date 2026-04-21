import { describe, expect, it } from "vitest";
import type { Id } from "../_generated/dataModel";
import {
  assertRegisterSessionIdentity,
  assertRegisterSessionMatchesTransaction,
  assertValidRegisterSessionTransition,
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

  it("requires a register or terminal identity when opening a session", () => {
    expect(() =>
      assertRegisterSessionIdentity({})
    ).toThrow("Register sessions require a register number or terminal.");

    expect(() =>
      assertRegisterSessionIdentity({ registerNumber: "A1" })
    ).not.toThrow();

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
      "Register session transactions must include a register number or terminal."
    );

    expect(() =>
      assertRegisterSessionMatchesTransaction(registerSession, {
        registerNumber: "B2",
      })
    ).toThrow("Register session does not match the transaction identity.");

    expect(() =>
      assertRegisterSessionMatchesTransaction(registerSession, {
        registerNumber: "A1",
      })
    ).not.toThrow();

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
});
