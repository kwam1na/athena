import { render } from "@react-email/components";
import { v } from "convex/values";
import { internal } from "../_generated/api";
import { internalAction, type ActionCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { joinKeyComponents } from "./deliveryPolicy";
import {
  ApprovalRequestPending,
  buildApprovalRequestPendingSubject,
} from "../emails/ApprovalRequestPending";
import DailyManagerReport from "../emails/DailyManagerReport";
import { WeeklyManagerReport } from "../emails/WeeklyManagerReport";
import { PosTerminalHealthAlert } from "../emails/PosTerminalHealthAlert";
import { RegisterCloseoutVarianceAlert } from "../emails/RegisterCloseoutVarianceAlert";
import { ReportVerificationAlert } from "../emails/ReportVerificationAlert";

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

// Refs only, never rendered content: the email is built from a FRESH read of
// the approval request at send time via the internal payload query.
type ApprovalRequestCreatedPayload = {
  approvalRequestId: Id<"approvalRequest">;
  storeId: Id<"store">;
  requestType: string;
};

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

type WeeklyManagerReportPayload = {
  acceptedWeekId: Id<"reportWeekAccepted">;
};

// Refs only. `fingerprint` identifies the unexplained difference set,
// `reArmEpoch` the run row's re-arm generation, and `alertSeq` the subject's
// monotonic alert count. All three are dedupe components; the first two are
// re-checked against the run row at send time.
type ReportVerificationDiscrepancyPayload = {
  storeId: Id<"store">;
  subjectKind: "day" | "week";
  subjectKey: string;
  fingerprint: string;
  reArmEpoch: number;
  alertSeq?: number;
};

const NOTIFICATION_KINDS: Record<string, NotificationKindDefinition> = {
  "approvals.request_created": {
    category: "approvals",
    channels: ["email"],
    dedupeKey: (payload) => {
      const p = payload as ApprovalRequestCreatedPayload;
      return joinKeyComponents([
        "approvals.request_created",
        String(p.approvalRequestId),
      ]);
    },
    prepareEmail: async (ctx, payload) => {
      const p = payload as ApprovalRequestCreatedPayload;
      const report = await ctx.runQuery(
        internal.operations.approvalRequestEmail
          .getApprovalRequestPendingPayload,
        { approvalRequestId: p.approvalRequestId },
      );
      // A null payload means the request is gone or already decided — the
      // "approval needed" email is no longer true, so suppress rather than
      // send stale content.
      if (!report) return null;
      return {
        subject: buildApprovalRequestPendingSubject(report),
        html: await render(ApprovalRequestPending(report)),
      };
    },
  },
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
  "reports.verification_discrepancy": {
    // The scheduled verifier disagreeing with the reporting pipeline is a
    // platform-health signal, not a cash-controls or EOD one — same audience
    // and same "the system may be lying to you" reading as terminal health,
    // so it reuses `system_health` rather than minting a category (which
    // would touch the TS union, the schema validator, and subscription
    // seeding, and split an audience that wants both signals).
    category: "system_health",
    channels: ["email"],
    dedupeKey: (payload) => {
      const p = payload as ReportVerificationDiscrepancyPayload;
      // The rail's dedupe is a PERMANENT unique lookup with no expiry, so the
      // key must distinguish every emission the streak logic decides to make.
      // Store + subject + fingerprint alone would silently swallow a
      // recurring identical discrepancy after an intervening clean run — the
      // re-arm epoch (bumped on each clean-run re-arm) is what makes that
      // second, genuinely new alert reach anyone. `alertSeq` closes the
      // remaining hole: a fingerprint that oscillates A -> B -> A without any
      // intervening clean run leaves the epoch untouched and would rebuild a
      // byte-identical key, which this rail's permanent unique lookup drops.
      return joinKeyComponents([
        "reports.verification_discrepancy",
        String(p.storeId),
        p.subjectKind,
        p.subjectKey,
        p.fingerprint,
        String(p.reArmEpoch),
        // `?? 0` because the run row's column is optional: rows written before
        // it landed have no honest value, and a missing component must not
        // stringify to "undefined" inside a permanent unique key.
        String(p.alertSeq ?? 0),
      ]);
    },
    prepareEmail: async (ctx, payload) => {
      const p = payload as ReportVerificationDiscrepancyPayload;
      const report = await ctx.runQuery(
        internal.operations.reportVerificationAlertEmail
          .getReportVerificationAlertPayload,
        {
          storeId: p.storeId,
          subjectKind: p.subjectKind,
          subjectKey: p.subjectKey,
          fingerprint: p.fingerprint,
          reArmEpoch: p.reArmEpoch,
          // Forwarded so the payload query can refuse an intent whose emission
          // was superseded by a later alertSeq on the same fingerprint/epoch
          // (an A -> B -> A oscillation dispatched late would double-send).
          // Absent on legacy intents; the query treats absent as unknown.
          ...(p.alertSeq !== undefined ? { alertSeq: p.alertSeq } : {}),
        },
      );
      // Null means the run row no longer carries this discrepancy — the
      // subject was re-verified clean, or its unexplained set changed and a
      // different intent owns it. Suppress instead of alerting on a state
      // that has already resolved. A THROW from the query is a transient read
      // fault and stays retryable.
      if (!report) return null;
      return {
        subject: `${report.storeName} report verification - ${report.subjectKindLabel.toLowerCase()} ${report.subjectLabel}`,
        html: await render(ReportVerificationAlert(report)),
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
  "eod.weekly_manager_report": {
    category: "eod",
    channels: ["email"],
    dedupeKey: (payload) => {
      const p = payload as WeeklyManagerReportPayload;
      return joinKeyComponents([
        "eod.weekly_manager_report",
        String(p.acceptedWeekId),
      ]);
    },
    prepareEmail: async (ctx, payload) => {
      const p = payload as WeeklyManagerReportPayload;
      const report = await ctx.runQuery(
        internal.operations.weeklyManagerReportEmail
          .getAcceptedWeeklyManagerReportPayload,
        { acceptedWeekId: p.acceptedWeekId },
      );
      if (!report) return null;
      return {
        subject: `${report.storeName} weekly report - ${report.operatingDate}`,
        html: await render(WeeklyManagerReport(report)),
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

/**
 * Explicit, side-effect-free preview for an accepted weekly correction.
 * This intentionally bypasses notification intents and delivery state.
 */
export const weeklyReportCorrectionPreview = internalAction({
  args: {
    acceptedWeekId: v.id("reportWeekAccepted"),
    candidateFingerprint: v.string(),
  },
  handler: async (
    ctx,
    args,
  ): Promise<(PreparedNotificationEmail & { contentDigest: string }) | null> => {
    const report = await ctx.runQuery(
      internal.operations.weeklyManagerReportEmail
        .getCorrectedWeeklyManagerReportPayload,
      args,
    );
    if (!report) return null;

    const subject = `${report.storeName} corrected weekly report preview - ${report.operatingDate}`;
    const html = await render(WeeklyManagerReport(report));
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${subject}\n${html}`),
    );
    const contentDigest = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");

    return { subject, html, contentDigest };
  },
});
