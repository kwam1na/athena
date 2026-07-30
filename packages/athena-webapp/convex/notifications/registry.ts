import { render } from "@react-email/components";
import { internal } from "../_generated/api";
import type { ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { joinKeyComponents } from "./deliveryPolicy";
import DailyManagerReport from "../emails/DailyManagerReport";
import PosTerminalHealthAlert from "../emails/PosTerminalHealthAlert";
import RegisterCloseoutVarianceAlert from "../emails/RegisterCloseoutVarianceAlert";

export type NotificationCategory =
  | "cash_controls"
  | "eod"
  | "system_health"
  | "approvals";
export type NotificationChannel = "email" | "in_app";
export type NotificationPayload = Record<string, unknown>;
export type PreparedNotificationEmail = { subject: string; html: string };

// The code-owned catalog. Every notification kind the platform can send is
// declared here: its category (what subscriptions match), channels, the
// structural dedupe recipe that makes emits idempotent, and prepareEmail —
// which loads FRESH payload data via the kind's existing internal query and
// renders the existing template at send time. Returning null means the
// subject is no longer sendable and suppresses the delivery rather than
// sending stale content; throwing is treated as a transient fault and
// retried.
//
// Adding a new communication = one entry here + one template. Call sites only
// ever emit intents.
export type NotificationKindDefinition = {
  category: NotificationCategory;
  channels: NotificationChannel[];
  dedupeKey: (payload: NotificationPayload) => string;
  prepareEmail: (
    ctx: Pick<ActionCtx, "runQuery">,
    payload: NotificationPayload,
  ) => Promise<PreparedNotificationEmail | null>;
};

type TerminalHealthPayload = {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  conditions: Array<"storage_critical" | "sync_stuck">;
  observedAt: number;
};

type CloseoutVariancePayload = { approvalRequestId: Id<"approvalRequest"> };

type CloseoutMatchPayload = {
  registerSessionId: Id<"registerSession">;
  localEventId: string;
};

export type DailyManagerReportSendStatus =
  | "applied"
  | "prepared"
  | "skipped"
  | "failed";

type DailyManagerReportPayload = {
  storeId: Id<"store">;
  operatingDate: string;
  status: DailyManagerReportSendStatus;
  preparedAt?: number;
  automationRunId?: Id<"automationRun">;
};

const NOTIFICATION_KINDS: Record<string, NotificationKindDefinition> = {
  "pos.terminal_health": {
    category: "system_health",
    channels: ["email"],
    dedupeKey: (payload) => {
      const p = payload as TerminalHealthPayload;
      return joinKeyComponents([
        "pos.terminal_health",
        String(p.terminalId),
        String(p.observedAt),
      ]);
    },
    prepareEmail: async (ctx, payload) => {
      const p = payload as TerminalHealthPayload;
      const report = await ctx.runQuery(
        internal.operations.posTerminalHealthAlertEmail
          .getPosTerminalHealthAlertPayload,
        {
          storeId: p.storeId,
          terminalId: p.terminalId,
          conditions: p.conditions,
          observedAt: p.observedAt,
        },
      );
      return {
        subject: `${report.storeName} terminal needs attention - ${report.terminalLabel}`,
        html: await render(PosTerminalHealthAlert(report)),
      };
    },
  },
  "register.closeout_variance": {
    category: "cash_controls",
    channels: ["email"],
    dedupeKey: (payload) => {
      const p = payload as CloseoutVariancePayload;
      return joinKeyComponents([
        "register.closeout_variance",
        String(p.approvalRequestId),
      ]);
    },
    prepareEmail: async (ctx, payload) => {
      const p = payload as CloseoutVariancePayload;
      const report = await ctx.runQuery(
        internal.operations.registerCloseoutVarianceEmail
          .getRegisterCloseoutVarianceAlertPayload,
        { approvalRequestId: p.approvalRequestId },
      );
      return {
        subject: `${report.storeName} register variance - ${report.registerLabel} - ${report.operatingDate}`,
        html: await render(RegisterCloseoutVarianceAlert(report)),
      };
    },
  },
  "register.closeout_match": {
    category: "cash_controls",
    channels: ["email"],
    dedupeKey: (payload) => {
      const p = payload as CloseoutMatchPayload;
      return joinKeyComponents([
        "register.closeout_match",
        String(p.registerSessionId),
        p.localEventId,
      ]);
    },
    prepareEmail: async (ctx, payload) => {
      const p = payload as CloseoutMatchPayload;
      const report = await ctx.runQuery(
        internal.operations.registerCloseoutVarianceEmail
          .getRegisterCloseoutMatchReportPayload,
        { registerSessionId: p.registerSessionId },
      );
      return {
        subject: `${report.storeName} register closed - ${report.registerLabel} - ${report.operatingDate}`,
        html: await render(RegisterCloseoutVarianceAlert(report)),
      };
    },
  },
  "eod.daily_manager_report": {
    category: "eod",
    channels: ["email"],
    dedupeKey: (payload) => {
      const p = payload as DailyManagerReportPayload;
      // Action-required (skipped/failed) collapses to one key per store-day,
      // preserving the legacy once-per-store-day guarantee across automation
      // re-runs with different run ids.
      const suffix =
        p.status === "skipped" || p.status === "failed"
          ? "action_required"
          : p.status;
      return joinKeyComponents([
        "eod.daily_manager_report",
        String(p.storeId),
        p.operatingDate,
        suffix,
      ]);
    },
    prepareEmail: async (ctx, payload) => {
      const p = payload as DailyManagerReportPayload;
      const actionRequired = p.status === "skipped" || p.status === "failed";
      let report;
      if (p.status === "prepared") {
        report = await ctx.runQuery(
          internal.operations.dailyManagerReportEmail
            .getPreparedDailyManagerReportPayloadForDate,
          {
            operatingDate: p.operatingDate,
            preparedAt: p.preparedAt,
            storeId: p.storeId,
          },
        );
      } else if (actionRequired) {
        if (!p.automationRunId) return null;
        report = await ctx.runQuery(
          internal.operations.dailyManagerReportEmail
            .getActionRequiredDailyManagerReportPayloadForRun,
          { automationRunId: p.automationRunId },
        );
      } else {
        report = (
          await ctx.runQuery(
            internal.operations.dailyManagerReportEmail
              .getDailyManagerReportPayloadsForDateRange,
            {
              endOperatingDate: p.operatingDate,
              startOperatingDate: p.operatingDate,
              storeId: p.storeId,
            },
          )
        )[0];
      }
      if (!report) return null;
      return {
        subject: actionRequired
          ? `Action required: ${report.storeName} EOD Review - ${report.operatingDate}`
          : `${report.storeName} daily report - ${report.operatingDate}`,
        html: await render(DailyManagerReport(report)),
      };
    },
  },
};

// Non-throwing lookup for dispatch-side code: an intent whose kind was
// renamed or removed by a later deploy must be terminalized, not left to
// throw on every sweep forever.
export function findNotificationKind(
  kind: string,
): NotificationKindDefinition | null {
  // hasOwn, not a bare index: a stored kind of "constructor" would otherwise
  // resolve a prototype member and blow up downstream on .channels.
  return Object.hasOwn(NOTIFICATION_KINDS, kind)
    ? NOTIFICATION_KINDS[kind]
    : null;
}

export function getNotificationKind(kind: string): NotificationKindDefinition {
  const definition = findNotificationKind(kind);
  if (!definition) {
    throw new Error(`Unknown notification kind: ${kind}`);
  }
  return definition;
}

export function listNotificationKinds(): string[] {
  return Object.keys(NOTIFICATION_KINDS);
}
