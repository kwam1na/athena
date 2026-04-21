import { describe, expect, it } from "vitest";

import type { Doc, Id } from "../../../_generated/dataModel";
import {
  selectRegisterStateLookupStrategy,
  summarizeRegisterStateSessions,
} from "./sessionRepository";

const storeId = "store-1" as Id<"store">;
const terminalId = "terminal-1" as Id<"posTerminal">;
const otherTerminalId = "terminal-2" as Id<"posTerminal">;
const cashierId = "cashier-1" as Id<"cashier">;

describe("selectRegisterStateLookupStrategy", () => {
  it("prefers the terminal lookup path when terminal and cashier are both known", () => {
    expect(
      selectRegisterStateLookupStrategy({
        storeId,
        terminalId,
        cashierId,
      }),
    ).toBe("terminal");
  });
});

describe("summarizeRegisterStateSessions", () => {
  it("filters out expired sessions before they can drive register state", () => {
    const summaries = summarizeRegisterStateSessions(
      [
        buildSession({
          _id: "expired-session" as Id<"posSession">,
          terminalId,
          cashierId,
          expiresAt: 100,
          updatedAt: 200,
        }),
        buildSession({
          _id: "active-session" as Id<"posSession">,
          terminalId,
          cashierId,
          expiresAt: 5_000,
          updatedAt: 300,
        }),
      ],
      {
        storeId,
        terminalId,
        cashierId,
      },
      1_000,
    );

    expect(summaries.map((session) => session._id)).toEqual(["active-session"]);
  });

  it("keeps only sessions for the requested terminal identity", () => {
    const summaries = summarizeRegisterStateSessions(
      [
        buildSession({
          _id: "wrong-terminal" as Id<"posSession">,
          terminalId: otherTerminalId,
          cashierId,
          expiresAt: 5_000,
          updatedAt: 300,
        }),
        buildSession({
          _id: "matching-terminal" as Id<"posSession">,
          terminalId,
          cashierId,
          expiresAt: 5_000,
          updatedAt: 200,
        }),
      ],
      {
        storeId,
        terminalId,
        cashierId,
      },
      1_000,
    );

    expect(summaries.map((session) => session._id)).toEqual([
      "matching-terminal",
    ]);
  });
});

function buildSession(
  overrides: Partial<Doc<"posSession">> & {
    _id: Id<"posSession">;
    terminalId: Id<"posTerminal">;
    expiresAt: number;
    updatedAt: number;
  },
): Doc<"posSession"> {
  return {
    _id: overrides._id,
    _creationTime: 0,
    sessionNumber: overrides.sessionNumber ?? "POS-001",
    storeId,
    cashierId: overrides.cashierId,
    registerNumber: overrides.registerNumber,
    status: overrides.status ?? "active",
    transactionId: overrides.transactionId,
    terminalId: overrides.terminalId,
    customerId: overrides.customerId,
    customerInfo: overrides.customerInfo,
    createdAt: overrides.createdAt ?? 0,
    updatedAt: overrides.updatedAt,
    expiresAt: overrides.expiresAt,
    heldAt: overrides.heldAt,
    resumedAt: overrides.resumedAt,
    completedAt: overrides.completedAt,
    subtotal: overrides.subtotal,
    tax: overrides.tax,
    total: overrides.total,
    payments: overrides.payments,
    holdReason: overrides.holdReason,
    notes: overrides.notes,
  };
}
