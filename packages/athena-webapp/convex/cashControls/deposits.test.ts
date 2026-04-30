import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { Id } from "../_generated/dataModel";
import {
  buildCashControlsDashboardSnapshot,
  buildRegisterSessionDepositTargetId,
} from "./deposits";

function getSource(relativePath: string) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

describe("cash control deposits", () => {
  it("builds a stable session-scoped submission target for idempotent deposit writes", () => {
    expect(
      buildRegisterSessionDepositTargetId({
        registerSessionId: "session_1" as Id<"registerSession">,
        submissionKey: "submission_1",
      })
    ).toBe("session_1:submission_1");
  });

  it("builds dashboard sections from register sessions and recorded deposits", () => {
    const snapshot = buildCashControlsDashboardSnapshot({
      approvalRequestsBySessionId: new Map([
        [
          "session_closing" as Id<"registerSession">,
          {
            _id: "approval_1" as Id<"approvalRequest">,
            reason: "Variance review required.",
            status: "pending",
          },
        ],
      ]),
      deposits: [
        {
          _id: "deposit_1" as Id<"paymentAllocation">,
          amount: 1200,
          externalReference: "BANK-001",
          notes: "Midday bank drop",
          recordedAt: 30,
          registerSessionId: "session_open" as Id<"registerSession">,
        },
        {
          _id: "deposit_2" as Id<"paymentAllocation">,
          amount: 500,
          recordedAt: 40,
          registerSessionId: "session_closing" as Id<"registerSession">,
        },
      ],
      registerSessions: [
        {
          _id: "session_open" as Id<"registerSession">,
          countedCash: undefined,
          expectedCash: 13800,
          openedAt: 10,
          openingFloat: 5000,
          registerNumber: "A1",
          status: "active",
          terminalId: "terminal_1" as Id<"posTerminal">,
          variance: undefined,
        },
        {
          _id: "session_closing" as Id<"registerSession">,
          countedCash: 9000,
          expectedCash: 9500,
          managerApprovalRequestId: "approval_1" as Id<"approvalRequest">,
          openedAt: 20,
          openingFloat: 5000,
          registerNumber: "B2",
          status: "closing",
          terminalId: "terminal_2" as Id<"posTerminal">,
          variance: -500,
        },
        {
          _id: "session_closed" as Id<"registerSession">,
          countedCash: 5000,
          expectedCash: 5000,
          openedAt: 5,
          openingFloat: 5000,
          registerNumber: "C3",
          status: "closed",
          variance: 0,
        },
      ],
      staffNamesById: new Map(),
      terminalNamesById: new Map([
        ["terminal_1" as Id<"posTerminal">, "Front counter"],
        ["terminal_2" as Id<"posTerminal">, "Back counter"],
      ]),
    });

    expect(snapshot.registerSessions).toHaveLength(3);
    expect(snapshot.registerSessions.map((session) => session._id)).toEqual([
      "session_closing",
      "session_open",
      "session_closed",
    ]);

    expect(snapshot.openSessions).toHaveLength(1);
    expect(snapshot.openSessions[0]).toMatchObject({
      _id: "session_open",
      registerNumber: "A1",
      terminalName: "Front counter",
      totalDeposited: 1200,
    });

    expect(snapshot.pendingCloseouts).toHaveLength(1);
    expect(snapshot.pendingCloseouts[0]).toMatchObject({
      _id: "session_closing",
      pendingApprovalRequest: {
        _id: "approval_1",
        status: "pending",
      },
      terminalName: "Back counter",
      totalDeposited: 500,
    });

    expect(snapshot.unresolvedVariances).toHaveLength(1);
    expect(snapshot.unresolvedVariances[0]).toMatchObject({
      _id: "session_closing",
      variance: -500,
    });

    expect(snapshot.recentDeposits).toEqual([
      expect.objectContaining({
        _id: "deposit_2",
        amount: 500,
        registerNumber: "B2",
      }),
      expect.objectContaining({
        _id: "deposit_1",
        amount: 1200,
        reference: "BANK-001",
        registerNumber: "A1",
      }),
    ]);
  });

  it("writes through payment allocations, register-session math, and operational events", () => {
    const source = getSource("./deposits.ts");

    expect(source).toContain("recordPaymentAllocationWithCtx");
    expect(source).toContain("recordRegisterSessionDeposit");
    expect(source).toContain("recordOperationalEventWithCtx");
  });
});
