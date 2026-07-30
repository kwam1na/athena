import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import { dailyManagerReportPreviewProps } from "../emails/DailyManagerReport";
import { posTerminalHealthAlertPreviewProps } from "../emails/PosTerminalHealthAlert";
import { registerCloseoutVarianceAlertPreviewProps } from "../emails/RegisterCloseoutVarianceAlert";
import {
  findNotificationKind,
  getNotificationKind,
  listNotificationKinds,
  type NotificationPayload,
} from "./registry";

const STORE_ID = "store-1" as Id<"store">;
const TERMINAL_ID = "terminal-1" as Id<"posTerminal">;
const APPROVAL_REQUEST_ID = "approval-1" as Id<"approvalRequest">;
const REGISTER_SESSION_ID = "session-1" as Id<"registerSession">;
const AUTOMATION_RUN_ID = "run-1" as Id<"automationRun">;
const OBSERVED_AT = Date.parse("2026-07-29T12:00:00Z");

// Drives prepareEmail with a recording stub in place of the kind's internal
// payload query, so the subject line and the branch selection are asserted
// without standing up the whole rail.
function stubCtx(responses: unknown[]) {
  const calls: string[] = [];
  let index = 0;
  return {
    calls,
    ctx: {
      runQuery: async (reference: unknown) => {
        calls.push(getFunctionName(reference as never));
        const response = responses[index] ?? responses[responses.length - 1];
        index += 1;
        return response;
      },
    } as never,
  };
}

async function prepare(
  kind: string,
  payload: NotificationPayload,
  responses: unknown[],
) {
  const { ctx, calls } = stubCtx(responses);
  const prepared = await getNotificationKind(kind).prepareEmail(ctx, payload);
  return { prepared, calls };
}

const terminalHealthReport = {
  ...posTerminalHealthAlertPreviewProps,
  storeName: "Accra",
  terminalLabel: "Front Desk",
};

const registerReport = {
  ...registerCloseoutVarianceAlertPreviewProps,
  storeName: "Accra",
  registerLabel: "Register 2",
  operatingDate: "2026-07-28",
};

const dailyReport = {
  ...dailyManagerReportPreviewProps,
  storeName: "Accra",
  operatingDate: "2026-07-28",
};

describe("registry catalog", () => {
  it("registers exactly the four shipped kinds with their categories and channels", () => {
    expect(listNotificationKinds().sort()).toEqual([
      "eod.daily_manager_report",
      "pos.terminal_health",
      "register.closeout_match",
      "register.closeout_variance",
    ]);
    expect(getNotificationKind("pos.terminal_health").category).toBe(
      "system_health",
    );
    expect(getNotificationKind("register.closeout_variance").category).toBe(
      "cash_controls",
    );
    expect(getNotificationKind("register.closeout_match").category).toBe(
      "cash_controls",
    );
    expect(getNotificationKind("eod.daily_manager_report").category).toBe(
      "eod",
    );
    for (const kind of listNotificationKinds()) {
      expect(getNotificationKind(kind).channels).toEqual(["email"]);
    }
  });

  it("looks up unknown kinds without throwing, and throws on the strict path", () => {
    expect(findNotificationKind("not.a_kind")).toBeNull();
    expect(() => getNotificationKind("not.a_kind")).toThrow(
      "Unknown notification kind: not.a_kind",
    );
  });

  it("does not resolve prototype members as notification kinds", () => {
    // An intent kind is stored data, so a row reading "constructor" must not
    // resolve Object.prototype.constructor and blow up downstream on
    // .channels — a bare index lookup would return a function here.
    for (const kind of ["constructor", "toString", "__proto__", "valueOf"]) {
      expect(findNotificationKind(kind)).toBeNull();
      expect(() => getNotificationKind(kind)).toThrow(
        `Unknown notification kind: ${kind}`,
      );
    }
    expect(listNotificationKinds()).not.toContain("constructor");
  });
});

describe("registry subjects", () => {
  it("builds the terminal health subject from fresh payload data", async () => {
    const { prepared, calls } = await prepare(
      "pos.terminal_health",
      {
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
        conditions: ["storage_critical"],
        observedAt: OBSERVED_AT,
      },
      [terminalHealthReport],
    );

    expect(prepared?.subject).toBe("Accra terminal needs attention - Front Desk");
    expect(prepared?.html).toContain("Front Desk");
    expect(calls).toEqual([
      "operations/posTerminalHealthAlertEmail:getPosTerminalHealthAlertPayload",
    ]);
  });

  it("builds the register variance subject from fresh payload data", async () => {
    const { prepared, calls } = await prepare(
      "register.closeout_variance",
      { approvalRequestId: APPROVAL_REQUEST_ID },
      [registerReport],
    );

    expect(prepared?.subject).toBe("Accra register variance - Register 2 - 2026-07-28");
    expect(calls).toEqual([
      "operations/registerCloseoutVarianceEmail:getRegisterCloseoutVarianceAlertPayload",
    ]);
  });

  it("builds the register closed subject from fresh payload data", async () => {
    const { prepared, calls } = await prepare(
      "register.closeout_match",
      {
        registerSessionId: REGISTER_SESSION_ID,
        localEventId: "evt-1",
      },
      [registerReport],
    );

    expect(prepared?.subject).toBe("Accra register closed - Register 2 - 2026-07-28");
    expect(calls).toEqual([
      "operations/registerCloseoutVarianceEmail:getRegisterCloseoutMatchReportPayload",
    ]);
  });

  it("builds the daily report subject for an applied report", async () => {
    const { prepared } = await prepare(
      "eod.daily_manager_report",
      {
        storeId: STORE_ID,
        operatingDate: "2026-07-28",
        status: "applied",
      },
      [[dailyReport]],
    );

    expect(prepared?.subject).toBe("Accra daily report - 2026-07-28");
  });

  it("builds the action-required subject for a skipped report", async () => {
    const { prepared } = await prepare(
      "eod.daily_manager_report",
      {
        storeId: STORE_ID,
        operatingDate: "2026-07-28",
        status: "skipped",
        automationRunId: AUTOMATION_RUN_ID,
      },
      [dailyReport],
    );

    expect(prepared?.subject).toBe("Action required: Accra EOD Review - 2026-07-28");
  });
});

describe("eod.daily_manager_report payload branching", () => {
  it("reads the prepared-snapshot query for a prepared report", async () => {
    const { prepared, calls } = await prepare(
      "eod.daily_manager_report",
      {
        storeId: STORE_ID,
        operatingDate: "2026-07-28",
        status: "prepared",
        preparedAt: OBSERVED_AT,
      },
      [dailyReport],
    );

    expect(calls).toEqual([
      "operations/dailyManagerReportEmail:getPreparedDailyManagerReportPayloadForDate",
    ]);
    expect(prepared?.subject).toBe("Accra daily report - 2026-07-28");
  });

  it("reads the date-range query for an applied report", async () => {
    const { calls } = await prepare(
      "eod.daily_manager_report",
      {
        storeId: STORE_ID,
        operatingDate: "2026-07-28",
        status: "applied",
      },
      [[dailyReport]],
    );

    expect(calls).toEqual([
      "operations/dailyManagerReportEmail:getDailyManagerReportPayloadsForDateRange",
    ]);
  });

  it.each(["skipped", "failed"] as const)(
    "reads the action-required run query for a %s report",
    async (status) => {
      const { prepared, calls } = await prepare(
        "eod.daily_manager_report",
        {
          storeId: STORE_ID,
          operatingDate: "2026-07-28",
          status,
          automationRunId: AUTOMATION_RUN_ID,
        },
        [dailyReport],
      );

      expect(calls).toEqual([
        "operations/dailyManagerReportEmail:getActionRequiredDailyManagerReportPayloadForRun",
      ]);
      expect(prepared?.subject).toBe(
        "Action required: Accra EOD Review - 2026-07-28",
      );
    },
  );

  it.each(["skipped", "failed"] as const)(
    "suppresses a %s report with no automationRunId instead of querying",
    async (status) => {
      const { prepared, calls } = await prepare(
        "eod.daily_manager_report",
        {
          storeId: STORE_ID,
          operatingDate: "2026-07-28",
          status,
        },
        [dailyReport],
      );

      // Nothing to rebuild the action-required content from: suppress rather
      // than query blindly or send stale content.
      expect(prepared).toBeNull();
      expect(calls).toEqual([]);
    },
  );

  it("suppresses when the date-range query returns no rows", async () => {
    const { prepared } = await prepare(
      "eod.daily_manager_report",
      {
        storeId: STORE_ID,
        operatingDate: "2026-07-28",
        status: "applied",
      },
      [[]],
    );

    expect(prepared).toBeNull();
  });

  it("suppresses when the prepared-snapshot query returns nothing", async () => {
    const { prepared } = await prepare(
      "eod.daily_manager_report",
      {
        storeId: STORE_ID,
        operatingDate: "2026-07-28",
        status: "prepared",
      },
      [undefined],
    );

    expect(prepared).toBeNull();
  });

  it("suppresses when the action-required run query returns nothing", async () => {
    const { prepared } = await prepare(
      "eod.daily_manager_report",
      {
        storeId: STORE_ID,
        operatingDate: "2026-07-28",
        status: "failed",
        automationRunId: AUTOMATION_RUN_ID,
      },
      [null],
    );

    expect(prepared).toBeNull();
  });
});

describe("registry dedupe key recipes", () => {
  function dedupeKey(kind: string, payload: NotificationPayload) {
    return getNotificationKind(kind).dedupeKey(payload);
  }

  it("keys terminal health by terminal and observation time", () => {
    expect(
      dedupeKey("pos.terminal_health", {
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
        conditions: ["storage_critical"],
        observedAt: OBSERVED_AT,
      }),
    ).toBe(`pos.terminal_health:${TERMINAL_ID}:${OBSERVED_AT}`);
  });

  it("keys register variance by the approval request", () => {
    expect(
      dedupeKey("register.closeout_variance", {
        approvalRequestId: APPROVAL_REQUEST_ID,
      }),
    ).toBe(`register.closeout_variance:${APPROVAL_REQUEST_ID}`);
  });

  it("keys register match by session and local event id, encoding the separator", () => {
    expect(
      dedupeKey("register.closeout_match", {
        registerSessionId: REGISTER_SESSION_ID,
        localEventId: "evt-1",
      }),
    ).toBe(`register.closeout_match:${REGISTER_SESSION_ID}:evt-1`);

    // localEventId is client-supplied, so a ":" in it must not be able to
    // forge extra key components.
    expect(
      dedupeKey("register.closeout_match", {
        registerSessionId: REGISTER_SESSION_ID,
        localEventId: "evt:1",
      }),
    ).toBe(`register.closeout_match:${REGISTER_SESSION_ID}:evt%3A1`);
  });

  it("keys the daily report by store, operating date, and status bucket", () => {
    const base = { storeId: STORE_ID, operatingDate: "2026-07-28" };
    const prefix = `eod.daily_manager_report:${STORE_ID}:2026-07-28`;

    expect(dedupeKey("eod.daily_manager_report", { ...base, status: "applied" }))
      .toBe(`${prefix}:applied`);
    expect(
      dedupeKey("eod.daily_manager_report", { ...base, status: "prepared" }),
    ).toBe(`${prefix}:prepared`);
    expect(dedupeKey("eod.daily_manager_report", { ...base, status: "skipped" }))
      .toBe(`${prefix}:action_required`);
    expect(dedupeKey("eod.daily_manager_report", { ...base, status: "failed" }))
      .toBe(`${prefix}:action_required`);
  });

  it("collapses skipped and failed to one key per store-day but keeps applied and prepared distinct", () => {
    const base = { storeId: STORE_ID, operatingDate: "2026-07-28" };
    const keyFor = (status: string, automationRunId?: Id<"automationRun">) =>
      dedupeKey("eod.daily_manager_report", {
        ...base,
        status,
        automationRunId,
      });

    // Automation re-runs produce different run ids; the once-per-store-day
    // guarantee must survive them.
    expect(keyFor("skipped", AUTOMATION_RUN_ID)).toBe(
      keyFor("failed", "run-2" as Id<"automationRun">),
    );

    const distinct = new Set([
      keyFor("applied"),
      keyFor("prepared"),
      keyFor("skipped"),
    ]);
    expect(distinct.size).toBe(3);
  });
});
