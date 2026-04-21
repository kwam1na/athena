import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Id } from "../_generated/dataModel";
import {
  assertValidRegisterSessionTransition,
  buildRegisterSession,
  calculateRegisterSessionCashDelta,
} from "../operations/registerSessions";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
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
  });

  it("guards duplicate open sessions and wires POS cash activity back to register sessions", () => {
    const registerSessionsSource = getSource("../operations/registerSessions.ts");
    const posSource = getSource("../inventory/pos.ts");
    const posTransactionSchemaSource = getSource("../schemas/pos/posTransaction.ts");

    expect(registerSessionsSource).toContain('.withIndex("by_storeId_registerNumber"');
    expect(registerSessionsSource).toContain(
      'throw new Error("A register session is already open for this register.");'
    );
    expect(registerSessionsSource).toContain(
      'throw new Error("A register session is already open for this terminal.");'
    );
    expect(registerSessionsSource).toContain(
      "export const recordRegisterSessionTransaction = internalMutation({"
    );
    expect(posSource).toContain("recordRegisterSessionTransaction");
    expect(posTransactionSchemaSource).toContain(
      'registerSessionId: v.optional(v.id("registerSession"))'
    );
  });
});
