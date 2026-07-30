import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getStoreScheduleContextForStoreAtWithCtx: vi.fn(async () => ({
    context: {
      kind: "resolved" as const,
      timezone: "Africa/Accra",
      operatingDate: "2026-07-03",
      phase: "after_last_window" as const,
      isOpen: false,
      scheduleVersionId: "schedule-1",
      currentWindow: null,
      nextWindow: null,
    },
  })),
}));

vi.mock("../inventory/storeSchedule", () => ({
  getStoreScheduleContextForStoreAtWithCtx:
    mocks.getStoreScheduleContextForStoreAtWithCtx,
}));

import {
  formatRegisterCloseoutVarianceAlertOperatingDate,
  formatRegisterCloseoutVarianceAlertReason,
  getRegisterCloseoutMatchReportPayload,
} from "./registerCloseoutVarianceEmail";

function getHandler(definition: unknown) {
  return (definition as { _handler: Function })._handler;
}

describe("register closeout variance email", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds an exact-match report from the closed register session", async () => {
    const documents: Record<string, Record<string, unknown>> = {
      "organization:org-1": { _id: "org-1", slug: "wigclub" },
      "posTerminal:terminal-1": {
        _id: "terminal-1",
        displayName: "Front counter",
        registerNumber: "2",
      },
      "registerSession:register-session-1": {
        _creationTime: Date.parse("2026-07-03T20:42:00Z"),
        _id: "register-session-1",
        closeoutOperatingDate: "2026-07-03",
        closedAt: Date.parse("2026-07-03T20:42:00Z"),
        closedByStaffProfileId: "staff-1",
        countedCash: 124400,
        expectedCash: 124400,
        openedAt: Date.parse("2026-07-03T08:00:00Z"),
        openingFloat: 20000,
        status: "closed",
        storeId: "store-1",
        terminalId: "terminal-1",
        variance: 0,
      },
      "staffProfile:staff-1": {
        _id: "staff-1",
        fullName: "Ama Mensah",
      },
      "store:store-1": {
        _id: "store-1",
        currency: "GHS",
        name: "Wigclub",
        organizationId: "org-1",
        slug: "wigclub",
      },
    };
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) =>
          documents[`${tableName}:${id}`] ?? null,
        ),
      },
    };

    const payload = await getHandler(getRegisterCloseoutMatchReportPayload)(
      ctx,
      { registerSessionId: "register-session-1" },
    );

    expect(payload).toMatchObject({
      countedCash: "GH₵1,244",
      expectedCash: "GH₵1,244",
      operatingDate: "Friday, July 3",
      registerLabel: "Front counter / Register 2",
      registerSessionId: "register-session-1",
      storeName: "Wigclub",
      submittedAt: "8:42 PM",
      submittedBy: "Ama Mensah",
      variance: "GH₵0",
      varianceDirection: "matched",
    });
  });

  it("builds a register closed report for a policy-allowed variance", async () => {
    const documents: Record<string, Record<string, unknown>> = {
      "organization:org-1": { _id: "org-1", slug: "wigclub" },
      "posTerminal:terminal-1": {
        _id: "terminal-1",
        displayName: "Front counter",
        registerNumber: "2",
      },
      "registerSession:register-session-1": {
        _creationTime: Date.parse("2026-07-21T20:10:40Z"),
        _id: "register-session-1",
        closeoutOperatingDate: "2026-07-21",
        closedAt: Date.parse("2026-07-21T20:10:40Z"),
        closedByStaffProfileId: "staff-1",
        countedCash: 279000,
        expectedCash: 279100,
        openedAt: Date.parse("2026-07-21T09:13:44Z"),
        openingFloat: 20000,
        status: "closed",
        storeId: "store-1",
        terminalId: "terminal-1",
        variance: -100,
      },
      "staffProfile:staff-1": {
        _id: "staff-1",
        fullName: "Ama Mensah",
      },
      "store:store-1": {
        _id: "store-1",
        currency: "GHS",
        name: "Wigclub",
        organizationId: "org-1",
        slug: "wigclub",
      },
    };
    const ctx = {
      db: {
        get: vi.fn(async (tableName: string, id: string) =>
          documents[`${tableName}:${id}`] ?? null,
        ),
      },
    };

    const payload = await getHandler(getRegisterCloseoutMatchReportPayload)(
      ctx,
      { registerSessionId: "register-session-1" },
    );

    expect(payload).toMatchObject({
      countedCash: "GH₵2,790",
      expectedCash: "GH₵2,791",
      operatingDate: "Tuesday, July 21",
      registerLabel: "Front counter / Register 2",
      registerSessionId: "register-session-1",
      storeName: "Wigclub",
      submittedAt: "8:10 PM",
      submittedBy: "Ama Mensah",
      variance: "GH₵-1",
      varianceDirection: "short",
    });
  });

  it("formats stored variance amounts in review reasons with the store currency", () => {
    expect(
      formatRegisterCloseoutVarianceAlertReason(
        "GHS",
        "Variance of 2000 exceeded the closeout approval threshold.",
      ),
    ).toBe("Variance of GH₵20 exceeded the closeout approval threshold");
  });

  it("formats register closeout operating dates for the alert header", () => {
    expect(
      formatRegisterCloseoutVarianceAlertOperatingDate({
        closeoutScheduleContext: {
          kind: "resolved",
          timezone: "America/New_York",
          operatingDate: "2026-07-09",
          phase: "after_last_window",
          isOpen: false,
          scheduleVersionId: "schedule-1",
          currentWindow: null,
          nextWindow: null,
        },
        closeoutOperatingDate: "2026-07-08",
        openedOperatingDate: "2026-07-07",
      }),
    ).toBe("Wednesday, July 8");

    expect(
      formatRegisterCloseoutVarianceAlertOperatingDate({
        closeoutScheduleContext: {
          kind: "resolved",
          timezone: "America/New_York",
          operatingDate: "2026-07-08",
          phase: "after_last_window",
          isOpen: false,
          scheduleVersionId: "schedule-1",
          currentWindow: null,
          nextWindow: null,
        },
      }),
    ).toBe("Wednesday, July 8");
  });
});
