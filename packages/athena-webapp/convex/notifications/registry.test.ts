import { getFunctionName } from "convex/server";
import { describe, expect, it } from "vitest";

import type { Id } from "../_generated/dataModel";
import { approvalRequestPendingPreviewProps } from "../emails/ApprovalRequestPending";
import { dailyManagerReportPreviewProps } from "../emails/DailyManagerReport";
import { posTerminalHealthAlertPreviewProps } from "../emails/PosTerminalHealthAlert";
import { registerCloseoutVarianceAlertPreviewProps } from "../emails/RegisterCloseoutVarianceAlert";
import { reportVerificationAlertPreviewProps } from "../emails/ReportVerificationAlert";
import { weeklyManagerReportPreviewProps } from "../emails/WeeklyManagerReport";
import {
  findNotificationKind,
  getNotificationKind,
  listNotificationKinds,
  type NotificationPayload,
  weeklyReportCorrectionPreview,
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
  const callArgs: Array<Record<string, unknown>> = [];
  let index = 0;
  return {
    calls,
    callArgs,
    ctx: {
      runQuery: async (reference: unknown, args: unknown) => {
        calls.push(getFunctionName(reference as never));
        callArgs.push((args ?? {}) as Record<string, unknown>);
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
  const { ctx, calls, callArgs } = stubCtx(responses);
  const prepared = await getNotificationKind(kind).prepareEmail(ctx, payload);
  return { prepared, calls, callArgs };
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
  it("registers exactly the eight shipped kinds with their categories and channels", () => {
    expect(listNotificationKinds().sort()).toEqual([
      "approvals.request_created",
      "eod.daily_manager_report",
      "eod.stale_daily_close",
      "eod.weekly_manager_report",
      "pos.terminal_health",
      "register.closeout_match",
      "register.closeout_variance",
      "reports.verification_discrepancy",
    ]);
    // Reuses system_health rather than minting a category: no TS union,
    // schema validator, or subscription-seeding change ships with this kind.
    expect(
      getNotificationKind("reports.verification_discrepancy").category,
    ).toBe("system_health");
    expect(getNotificationKind("approvals.request_created").category).toBe(
      "approvals",
    );
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
    expect(getNotificationKind("eod.stale_daily_close").category).toBe("eod");
    expect(getNotificationKind("eod.weekly_manager_report").category).toBe(
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

describe("weekly manager report preparation", () => {
  it("loads the accepted baseline and renders the weekly report", async () => {
    const acceptedWeekId = "accepted-week-1" as Id<"reportWeekAccepted">;
    const { prepared, calls } = await prepare(
      "eod.weekly_manager_report",
      { acceptedWeekId },
      [weeklyManagerReportPreviewProps],
    );

    expect(calls).toEqual([
      "operations/weeklyManagerReportEmail:getAcceptedWeeklyManagerReportPayload",
    ]);
    expect(prepared?.subject).toBe("Wigclub weekly report - Aug 3–8, 2026");
    expect(prepared?.html).toContain("Top items by units sold");
  });
});

describe("weekly corrected report preview", () => {
  it("renders the explicit correction without creating notification rail state", async () => {
    const acceptedWeekId = "accepted-week-1" as Id<"reportWeekAccepted">;
    const calls: string[] = [];
    const ctx = {
      runQuery: async (reference: unknown) => {
        calls.push(getFunctionName(reference as never));
        return {
          ...weeklyManagerReportPreviewProps,
          presentation: {
            ...weeklyManagerReportPreviewProps.presentation,
            previewText: "Wigclub corrected weekly report preview · Not sent",
            timestampLabel: "Corrected",
          },
          statusLabel: "Report corrected",
        };
      },
    } as never;

    const result = await (
      weeklyReportCorrectionPreview as unknown as {
        _handler: (
          ctx: unknown,
          args: {
            acceptedWeekId: Id<"reportWeekAccepted">;
            candidateFingerprint: string;
          },
        ) => Promise<{
          subject: string;
          html: string;
          contentDigest: string;
        } | null>;
      }
    )._handler(ctx, {
      acceptedWeekId,
      candidateFingerprint: "candidate-v1",
    });

    expect(calls).toEqual([
      "operations/weeklyManagerReportEmail:getCorrectedWeeklyManagerReportPayload",
    ]);
    expect(result?.subject).toContain("corrected weekly report preview");
    expect(result?.html).toContain("Report corrected");
    expect(result?.html).toContain("Not sent");
    expect(result?.contentDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(ctx).not.toHaveProperty("scheduler");
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

    expect(prepared?.subject).toBe(
      "Accra terminal needs attention - Front Desk",
    );
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

    expect(prepared?.subject).toBe(
      "Accra register variance - Register 2 - 2026-07-28",
    );
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

    expect(prepared?.subject).toBe(
      "Accra register closed - Register 2 - 2026-07-28",
    );
    expect(calls).toEqual([
      "operations/registerCloseoutVarianceEmail:getRegisterCloseoutMatchReportPayload",
    ]);
  });

  it("builds the pending approval subject from fresh payload data", async () => {
    const { prepared, calls } = await prepare(
      "approvals.request_created",
      {
        approvalRequestId: APPROVAL_REQUEST_ID,
        storeId: STORE_ID,
        requestType: "pos_transaction_void",
      },
      [approvalRequestPendingPreviewProps],
    );

    expect(prepared?.subject).toBe(
      "Wigclub approval needed - Transaction void - #532108",
    );
    expect(prepared?.html).toContain("#532108");
    expect(calls).toEqual([
      "operations/approvalRequestEmail:getApprovalRequestPendingPayload",
    ]);
  });

  it("falls back to the generic approval descriptor for an unmapped request type", async () => {
    const { prepared } = await prepare(
      "approvals.request_created",
      {
        approvalRequestId: APPROVAL_REQUEST_ID,
        storeId: STORE_ID,
        requestType: "register_sync_review",
      },
      [
        {
          ...approvalRequestPendingPreviewProps,
          requestType: "register_sync_review",
          identifier: "2026-07-28",
          data: {},
        },
      ],
    );

    // Unmapped types must still send a clear generic email, never drop.
    expect(prepared?.subject).toBe(
      "Wigclub approval needed - Approval request - 2026-07-28",
    );
  });

  it("suppresses the pending approval email when the payload query returns null", async () => {
    const { prepared, calls } = await prepare(
      "approvals.request_created",
      {
        approvalRequestId: APPROVAL_REQUEST_ID,
        storeId: STORE_ID,
        requestType: "pos_transaction_void",
      },
      [null],
    );

    // Null from the payload query means missing-or-decided: genuinely no
    // longer sendable, so prepareEmail suppresses instead of rendering.
    expect(prepared).toBeNull();
    expect(calls).toEqual([
      "operations/approvalRequestEmail:getApprovalRequestPendingPayload",
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

    expect(prepared?.subject).toBe(
      "Action required: Accra EOD Review - 2026-07-28",
    );
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

describe("eod.stale_daily_close preparation", () => {
  it("builds the aligned still-open email from a fresh daily-close read", async () => {
    const { prepared, calls, callArgs } = await prepare(
      "eod.stale_daily_close",
      {
        ageInDays: 2,
        operatingDate: "2026-07-28",
        storeId: STORE_ID,
      },
      [
        {
          ...dailyReport,
          blockers: [
            {
              message:
                "Close or review the register, then complete EOD Review.",
              title: "Open register session",
            },
          ],
        },
      ],
    );

    expect(calls).toEqual([
      "operations/dailyManagerReportEmail:getStaleDailyManagerReportPayloadForDate",
    ]);
    expect(callArgs).toEqual([
      { operatingDate: "2026-07-28", storeId: STORE_ID },
    ]);
    expect(prepared?.subject).toBe("Still open: Accra EOD Review - 2026-07-28");
    expect(prepared?.html).toContain("Open register session");
    expect(prepared?.html).toContain("has remained open for 2 days");
  });

  it("suppresses the stale email when the day has since closed", async () => {
    const { prepared } = await prepare(
      "eod.stale_daily_close",
      {
        ageInDays: 2,
        operatingDate: "2026-07-28",
        storeId: STORE_ID,
      },
      [null],
    );

    expect(prepared).toBeNull();
  });
});

describe("report verification discrepancy preparation", () => {
  const payload = {
    storeId: STORE_ID,
    subjectKind: "day" as const,
    subjectKey: "2026-08-08",
    fingerprint: "a1b2c3d4e5f60718",
    reArmEpoch: 2,
  };

  it("renders checked-and-wrong and not-checked from a fresh run-row read", async () => {
    const { prepared, calls } = await prepare(
      "reports.verification_discrepancy",
      payload,
      [reportVerificationAlertPreviewProps],
    );

    expect(calls).toEqual([
      "operations/reportVerificationAlertEmail:getReportVerificationAlertPayload",
    ]);
    expect(prepared?.subject).toBe(
      "Wigclub report verification - day Saturday, August 8",
    );
    expect(prepared?.html).toContain("Checked and wrong");
    expect(prepared?.html).toContain("Net sales");
    // R4: the withheld fields are rendered, and rendered separately.
    expect(prepared?.html).toContain("Not checked");
    expect(prepared?.html).toContain("Payments refunded");
  });

  it("suppresses when the subject resolved between emit and send", async () => {
    // The run row was re-verified clean (or moved to a different unexplained
    // set), so this alert is no longer true: null suppresses, and dispatch
    // records the operational event for the dropped alert.
    const { prepared } = await prepare(
      "reports.verification_discrepancy",
      payload,
      [null],
    );

    expect(prepared).toBeNull();
  });

  it("forwards the intent's alertSeq to the payload query, omitting it on legacy intents", async () => {
    // F7: the payload query re-checks alertSeq against the run row so a
    // DELAYED dispatch of an oscillated fingerprint (A -> B -> A: fingerprint
    // and epoch both match the first A-intent) cannot double-send. The
    // registry has to actually hand the intent's counter over for that check
    // to exist.
    const withSeq = await prepare(
      "reports.verification_discrepancy",
      { ...payload, alertSeq: 3 },
      [reportVerificationAlertPreviewProps],
    );
    expect(withSeq.callArgs[0]?.alertSeq).toBe(3);
    expect(withSeq.callArgs[0]?.fingerprint).toBe(payload.fingerprint);

    // Legacy intents minted before the column carry none: absent, not 0 —
    // the query treats absent as unknown and never suppresses on it.
    const legacy = await prepare("reports.verification_discrepancy", payload, [
      reportVerificationAlertPreviewProps,
    ]);
    expect("alertSeq" in (legacy.callArgs[0] ?? {})).toBe(false);
  });

  it("propagates a transient payload read fault instead of suppressing", async () => {
    // Collapsing a read fault into null would permanently silence a real
    // discrepancy — the rail must retry instead.
    const ctx = {
      runQuery: async () => {
        throw new Error("Report verification alert store was not found.");
      },
    } as never;

    await expect(
      getNotificationKind("reports.verification_discrepancy").prepareEmail(
        ctx,
        payload,
      ),
    ).rejects.toThrow("Report verification alert store was not found.");
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

  it("keys the pending approval by the approval request with the kind prefix", () => {
    // The documented kind-prefixed joined shape shared by every recipe:
    // "approvals.request_created:{approvalRequestId}" with percent-encoded
    // components.
    expect(
      dedupeKey("approvals.request_created", {
        approvalRequestId: APPROVAL_REQUEST_ID,
        storeId: STORE_ID,
        requestType: "pos_transaction_void",
      }),
    ).toBe(`approvals.request_created:${APPROVAL_REQUEST_ID}`);
  });

  it("keys the daily report by store, operating date, and status bucket", () => {
    const base = { storeId: STORE_ID, operatingDate: "2026-07-28" };
    const prefix = `eod.daily_manager_report:${STORE_ID}:2026-07-28`;

    expect(
      dedupeKey("eod.daily_manager_report", { ...base, status: "applied" }),
    ).toBe(`${prefix}:applied`);
    expect(
      dedupeKey("eod.daily_manager_report", { ...base, status: "prepared" }),
    ).toBe(`${prefix}:prepared`);
    expect(
      dedupeKey("eod.daily_manager_report", { ...base, status: "skipped" }),
    ).toBe(`${prefix}:action_required`);
    expect(
      dedupeKey("eod.daily_manager_report", { ...base, status: "failed" }),
    ).toBe(`${prefix}:action_required`);
  });

  it("keys a stale close email once per store day", () => {
    expect(
      dedupeKey("eod.stale_daily_close", {
        ageInDays: 2,
        operatingDate: "2026-07-28",
        storeId: STORE_ID,
      }),
    ).toBe(`eod.stale_daily_close:${STORE_ID}:2026-07-28`);
  });

  it("keys the weekly report by its immutable accepted baseline", () => {
    const acceptedWeekId = "accepted-week-1" as Id<"reportWeekAccepted">;
    expect(dedupeKey("eod.weekly_manager_report", { acceptedWeekId })).toBe(
      `eod.weekly_manager_report:${acceptedWeekId}`,
    );
  });

  it("keys a verification discrepancy by store, subject, fingerprint, re-arm epoch, and alert sequence", () => {
    expect(
      dedupeKey("reports.verification_discrepancy", {
        storeId: STORE_ID,
        subjectKind: "day",
        subjectKey: "2026-08-08",
        fingerprint: "a1b2c3d4e5f60718",
        reArmEpoch: 0,
        alertSeq: 1,
      }),
    ).toBe(
      `reports.verification_discrepancy:${STORE_ID}:day:2026-08-08:a1b2c3d4e5f60718:0:1`,
    );
  });

  it("mints a distinct key when a fingerprint oscillates back with no clean run", () => {
    // A -> B -> A leaves reArmEpoch untouched, so without the monotonic
    // alertSeq the third alert would rebuild the first one's key byte for byte
    // and the rail's permanent unique lookup would drop it.
    const base = {
      storeId: STORE_ID,
      subjectKind: "day" as const,
      subjectKey: "2026-08-08",
      reArmEpoch: 0,
    };
    const first = dedupeKey("reports.verification_discrepancy", {
      ...base,
      fingerprint: "aaaa1111aaaa1111",
      alertSeq: 1,
    });
    const returned = dedupeKey("reports.verification_discrepancy", {
      ...base,
      fingerprint: "aaaa1111aaaa1111",
      alertSeq: 3,
    });
    expect(returned).not.toBe(first);
  });

  it("re-alerts the same fingerprint after a clean run re-armed the subject", () => {
    // The rail's dedupe is a permanent unique lookup: without the epoch this
    // second, genuinely new discrepancy would be swallowed forever.
    const base = {
      storeId: STORE_ID,
      subjectKind: "day" as const,
      subjectKey: "2026-08-08",
      fingerprint: "a1b2c3d4e5f60718",
      alertSeq: 1,
    };
    expect(
      dedupeKey("reports.verification_discrepancy", {
        ...base,
        reArmEpoch: 0,
      }),
    ).not.toBe(
      dedupeKey("reports.verification_discrepancy", {
        ...base,
        reArmEpoch: 1,
      }),
    );

    // ...while the same fingerprint within one streak stays a single alert.
    expect(
      dedupeKey("reports.verification_discrepancy", {
        ...base,
        reArmEpoch: 1,
      }),
    ).toBe(
      dedupeKey("reports.verification_discrepancy", {
        ...base,
        reArmEpoch: 1,
      }),
    );
  });

  it("keeps day and week subjects with the same key distinct", () => {
    const base = {
      storeId: STORE_ID,
      subjectKey: "2026-08-03",
      fingerprint: "a1b2c3d4e5f60718",
      reArmEpoch: 0,
    };
    expect(
      dedupeKey("reports.verification_discrepancy", {
        ...base,
        subjectKind: "day",
      }),
    ).not.toBe(
      dedupeKey("reports.verification_discrepancy", {
        ...base,
        subjectKind: "week",
      }),
    );
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
