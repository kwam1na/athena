import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowRight,
  ArrowUpRight,
  Banknote,
  Landmark,
  ShieldAlert,
} from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { capitalizeWords, cn, currencyFormatter } from "@/lib/utils";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { api } from "~/convex/_generated/api";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { getOrigin } from "~/src/lib/navigationUtils";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";
import { CashControlsWorkspaceHeader } from "./CashControlsWorkspaceHeader";
import { formatReviewReason } from "./formatReviewReason";

const CLOSED_SESSION_PREVIEW_LIMIT = 3;

type DashboardApprovalRequest = {
  _id: string;
  reason?: string | null;
  requestedByStaffName?: string | null;
  status: string;
};

export type CashControlsDashboardSession = {
  _id: string;
  closedAt?: number;
  closedByStaffName?: string | null;
  countedCash?: number;
  expectedCash: number;
  openedByStaffName?: string | null;
  openedAt: number;
  openingFloat: number;
  pendingApprovalRequest?: DashboardApprovalRequest | null;
  registerNumber?: string | null;
  status: string;
  totalDeposited: number;
  variance?: number;
  workflowTraceId?: string | null;
};

export type CashControlsDashboardDeposit = {
  _id: string;
  amount: number;
  notes?: string | null;
  recordedAt: number;
  recordedByStaffName?: string | null;
  reference?: string | null;
  registerNumber?: string | null;
  registerSessionId?: string | null;
};

export type CashControlsDashboardSnapshot = {
  openSessions: CashControlsDashboardSession[];
  pendingCloseouts: CashControlsDashboardSession[];
  recentDeposits: CashControlsDashboardDeposit[];
  registerSessions: CashControlsDashboardSession[];
  unresolvedVariances: CashControlsDashboardSession[];
};

type CashControlsDashboardContentProps = {
  currency: string;
  dashboardSnapshot: CashControlsDashboardSnapshot;
  isLoading: boolean;
  orgUrlSlug: string;
  storeUrlSlug: string;
};

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return formatStoredAmount(currencyFormatter(currency), amount);
}

function formatStatusLabel(status: string) {
  return capitalizeWords(status.replaceAll("_", " "));
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatRegisterName(registerNumber?: string | null) {
  const trimmedRegisterNumber = registerNumber?.trim();
  if (!trimmedRegisterNumber) {
    return "Unnamed register";
  }

  return trimmedRegisterNumber.toLowerCase().startsWith("register ")
    ? trimmedRegisterNumber
    : `Register ${trimmedRegisterNumber}`;
}

function getVarianceTone(variance?: number) {
  if (!variance) {
    return "text-foreground";
  }

  return variance > 0 ? "text-success" : "text-danger";
}

function getStatusBadgeClass(status: string) {
  switch (status) {
    case "active":
      return "border-transparent bg-success/10 text-success";
    case "closing":
      return "border-transparent bg-warning/15 text-warning";
    case "open":
      return "border-transparent bg-success/10 text-success";
    case "closed":
      return "border-transparent bg-muted text-muted-foreground";
    default:
      return "border-transparent bg-muted text-muted-foreground";
  }
}

function getSnapshotTotals(snapshot: CashControlsDashboardSnapshot) {
  const expectedCashTotal = snapshot.openSessions.reduce(
    (total, session) => total + session.expectedCash,
    0,
  );
  const depositedTotal = snapshot.openSessions.reduce(
    (total, session) => total + session.totalDeposited,
    0,
  );
  const unresolvedVarianceTotal = snapshot.unresolvedVariances.reduce(
    (total, session) => total + Math.abs(session.variance ?? 0),
    0,
  );

  return {
    depositedTotal,
    expectedCashTotal,
    onHandTotal: Math.max(expectedCashTotal - depositedTotal, 0),
    unresolvedVarianceTotal,
  };
}

function CashPositionSummary({
  currency,
  snapshot,
}: {
  currency: string;
  snapshot: CashControlsDashboardSnapshot;
}) {
  const {
    depositedTotal,
    expectedCashTotal,
    onHandTotal,
    unresolvedVarianceTotal,
  } = getSnapshotTotals(snapshot);

  const items = [
    {
      label: "Expected in drawers",
      supporting: `${snapshot.openSessions.length} open session${snapshot.openSessions.length === 1 ? "" : "s"}`,
      value: formatCurrency(currency, expectedCashTotal),
    },
    {
      label: "Deposited today",
      supporting: `${snapshot.recentDeposits.length} recent drop${snapshot.recentDeposits.length === 1 ? "" : "s"}`,
      value: formatCurrency(currency, depositedTotal),
    },
    {
      label: "Still in drawers",
      supporting: "Expected minus deposits",
      value: formatCurrency(currency, onHandTotal),
    },
    {
      label: "Variance to review",
      supporting: `${snapshot.unresolvedVariances.length} unresolved`,
      value: formatCurrency(currency, unresolvedVarianceTotal),
      valueClassName:
        snapshot.unresolvedVariances.length > 0
          ? "text-danger"
          : "text-foreground",
    },
  ];

  return (
    <dl className="grid gap-layout-sm md:grid-cols-2 2xl:grid-cols-4">
      {items.map((item) => (
        <div
          className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface"
          key={item.label}
        >
          <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {item.label}
          </dt>
          <dd
            className={cn(
              "mt-layout-xs whitespace-nowrap font-mono text-2xl text-foreground",
              item.valueClassName,
            )}
          >
            {item.value}
          </dd>
          <p className="mt-1 text-xs text-muted-foreground">
            {item.supporting}
          </p>
        </div>
      ))}
    </dl>
  );
}

function WorkflowJumpPoints({
  dashboardSnapshot,
  orgUrlSlug,
  storeUrlSlug,
}: {
  dashboardSnapshot: CashControlsDashboardSnapshot;
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  const firstOpenSession = dashboardSnapshot.openSessions[0];
  const firstVarianceSession = dashboardSnapshot.unresolvedVariances[0];

  const items = [
    {
      body: firstOpenSession
        ? `${formatRegisterName(firstOpenSession.registerNumber)} is ready for review or deposit entry.`
        : "No live drawers are open right now.",
      cta: firstOpenSession ? "Open session" : "No open sessions",
      disabled: !firstOpenSession,
      icon: Banknote,
      params: firstOpenSession
        ? {
            orgUrlSlug,
            sessionId: firstOpenSession._id,
            storeUrlSlug,
          }
        : undefined,
      search: { o: getOrigin() },
      title: "Register sessions",
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
    },
    {
      body: firstVarianceSession
        ? `${formatRegisterName(firstVarianceSession.registerNumber)} needs variance review.`
        : "Variance exceptions stay quiet until a drawer needs attention.",
      cta: firstVarianceSession ? "Resolve variance" : "No action needed",
      disabled: !firstVarianceSession,
      icon: ShieldAlert,
      params: firstVarianceSession
        ? {
            orgUrlSlug,
            sessionId: firstVarianceSession._id,
            storeUrlSlug,
          }
        : undefined,
      search: { o: getOrigin() },
      title: "Variance review",
      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
    },
  ];

  return (
    <section className="grid gap-layout-sm lg:grid-cols-2">
      {items.map((item) => {
        const Icon = item.icon;
        const content = (
          <>
            <div className="flex items-start justify-between gap-layout-md">
              <span className="flex h-10 w-10 items-center justify-center rounded-md bg-signal/10 text-signal">
                <Icon aria-hidden className="h-5 w-5" />
              </span>
              <Badge
                className="border-border bg-background text-muted-foreground"
                size="sm"
                variant="outline"
              >
                Workflow
              </Badge>
            </div>
            <div className="space-y-layout-xs">
              <h2 className="font-display text-lg font-semibold text-foreground">
                {item.title}
              </h2>
              <p className="text-sm text-muted-foreground">{item.body}</p>
            </div>
            <span className="mt-auto inline-flex items-center gap-2 text-sm font-medium text-signal">
              {item.cta}
              {!item.disabled ? (
                <ArrowRight aria-hidden className="h-4 w-4" />
              ) : null}
            </span>
          </>
        );

        if (item.disabled || !item.params) {
          return (
            <article
              className="flex min-h-44 flex-col gap-layout-md rounded-lg border border-dashed border-border bg-surface-raised p-layout-md"
              key={item.title}
            >
              {content}
            </article>
          );
        }

        return (
          <Link
            className="group flex min-h-44 flex-col gap-layout-md rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface transition-colors hover:border-signal/50 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            key={item.title}
            params={item.params}
            search={item.search}
            to={item.to}
          >
            {content}
          </Link>
        );
      })}
    </section>
  );
}

function getSessionActionLabel(session: CashControlsDashboardSession) {
  if (session.pendingApprovalRequest || session.variance) {
    return "Review variance";
  }

  if (session.status === "closing") {
    return "Continue closeout";
  }

  if (session.status === "closed") {
    return "View session";
  }

  return "Open drawer detail";
}

function getSessionReason(session: CashControlsDashboardSession) {
  if (session.pendingApprovalRequest || session.variance) {
    return "Variance needs review";
  }

  if (session.status === "closing") {
    return "Ready for closeout";
  }

  if (["active", "open"].includes(session.status)) {
    return "Live drawer";
  }

  return "Closed session";
}

function formatStaffByline(staffName?: string | null) {
  if (!staffName) {
    return undefined;
  }

  return formatStaffDisplayName({ fullName: staffName });
}

function getSessionOpenedLine(session: CashControlsDashboardSession) {
  const openedAt = formatTimestamp(session.openedAt);
  const openedBy = formatStaffByline(session.openedByStaffName);

  return openedBy
    ? `Opened ${openedAt} by ${openedBy}`
    : `Opened ${openedAt}; staff not recorded`;
}

function getSessionActionTone(session: CashControlsDashboardSession) {
  if (session.pendingApprovalRequest || session.variance) {
    return "text-danger";
  }

  if (session.status === "closing") {
    return "text-warning";
  }

  return "text-signal";
}

function WorkflowSummaryItem({
  label,
  tone,
  value,
}: {
  label: string;
  tone?: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background/70 px-layout-sm py-layout-xs">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <p className={cn("mt-1 font-mono text-base text-foreground", tone)}>
        {value}
      </p>
    </div>
  );
}

function DrawerSessionCard({
  currency,
  orgUrlSlug,
  session,
  storeUrlSlug,
  variant = "standard",
}: {
  currency: string;
  orgUrlSlug: string;
  session: CashControlsDashboardSession;
  storeUrlSlug: string;
  variant?: "primary" | "standard";
}) {
  const variance = session.variance ?? 0;
  const openedLine = getSessionOpenedLine(session);
  const formattedApprovalReason = formatReviewReason(
    currencyFormatter(currency),
    session.pendingApprovalRequest?.reason,
  );

  return (
    <Link
      className={cn(
        "group block rounded-lg border bg-surface-raised p-layout-md shadow-surface transition-colors hover:border-signal/50 hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        variant === "primary" ? "border-signal/35" : "border-border",
      )}
      params={{
        orgUrlSlug,
        sessionId: session._id,
        storeUrlSlug,
      }}
      search={{ o: getOrigin() }}
      to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
    >
      <div className="flex items-start justify-between gap-layout-md">
        <div className="min-w-0 space-y-1">
          <p className="truncate font-medium text-foreground">
            {formatRegisterName(session.registerNumber)}
          </p>
          <p
            className={cn("text-sm font-medium", getSessionActionTone(session))}
          >
            {getSessionReason(session)}
          </p>
          <p className="text-xs text-muted-foreground">{openedLine}</p>
        </div>
        <Badge
          className={getStatusBadgeClass(session.status)}
          size="sm"
          variant="outline"
        >
          {formatStatusLabel(session.status)}
        </Badge>
      </div>

      <dl className="mt-layout-md grid grid-cols-3 gap-layout-sm">
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Expected
          </dt>
          <dd className="mt-1 font-mono text-sm text-foreground">
            {formatCurrency(currency, session.expectedCash)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Deposited
          </dt>
          <dd className="mt-1 font-mono text-sm text-foreground">
            {formatCurrency(currency, session.totalDeposited)}
          </dd>
        </div>
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Variance
          </dt>
          <dd
            className={cn("mt-1 font-mono text-sm", getVarianceTone(variance))}
          >
            {formatCurrency(currency, variance)}
          </dd>
        </div>
      </dl>

      {formattedApprovalReason ? (
        <p className="mt-layout-sm max-w-full overflow-hidden break-words rounded-md border border-danger/20 bg-danger/5 px-layout-sm py-layout-xs text-xs leading-relaxed text-danger">
          {formattedApprovalReason}
        </p>
      ) : null}

      <span
        className={cn(
          "mt-layout-md inline-flex items-center gap-2 text-sm font-medium",
          getSessionActionTone(session),
        )}
      >
        {getSessionActionLabel(session)}
        <ArrowRight aria-hidden className="h-4 w-4" />
      </span>
    </Link>
  );
}

function DrawerSessionLane({
  currency,
  emptyDescription,
  orgUrlSlug,
  sessions,
  storeUrlSlug,
  title,
  variant,
}: {
  currency: string;
  emptyDescription: string;
  orgUrlSlug: string;
  sessions: CashControlsDashboardSession[];
  storeUrlSlug: string;
  title: string;
  variant?: "primary" | "standard";
}) {
  return (
    <section className="space-y-layout-sm">
      <div className="flex items-center justify-between gap-layout-md">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        <Badge
          className="border-border bg-background text-muted-foreground"
          size="sm"
          variant="outline"
        >
          {sessions.length}
        </Badge>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-background/60 px-layout-md py-layout-lg text-sm text-muted-foreground">
          {emptyDescription}
        </div>
      ) : (
        <div className="space-y-layout-sm">
          {sessions.map((session) => (
            <DrawerSessionCard
              currency={currency}
              key={session._id}
              orgUrlSlug={orgUrlSlug}
              session={session}
              storeUrlSlug={storeUrlSlug}
              variant={variant}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ClosedSessionsSummary({
  currency,
  orgUrlSlug,
  sessions,
  storeUrlSlug,
}: {
  currency: string;
  orgUrlSlug: string;
  sessions: CashControlsDashboardSession[];
  storeUrlSlug: string;
}) {
  const previewSessions = sessions.slice(0, CLOSED_SESSION_PREVIEW_LIMIT);
  const hasAdditionalSessions = sessions.length > previewSessions.length;
  const tableHeadClass =
    "text-[11px] uppercase tracking-[0.16em] text-muted-foreground";

  return (
    <aside className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
      <div className="flex items-start justify-between gap-layout-md">
        <div className="space-y-1">
          <h3 className="text-sm font-semibold text-foreground">
            Closed sessions
          </h3>
          <p className="text-sm text-muted-foreground">
            Completed drawers stay here for reference, not active work.
          </p>
        </div>
        <Badge
          className="border-border bg-background text-muted-foreground"
          size="sm"
          variant="outline"
        >
          {sessions.length}
        </Badge>
      </div>

      {sessions.length === 0 ? (
        <p className="mt-layout-md text-sm text-muted-foreground">
          Closed sessions will appear after closeout.
        </p>
      ) : (
        <div className="mt-layout-md overflow-hidden rounded-lg border border-border bg-background/70">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className={tableHeadClass}>Register</TableHead>
                <TableHead className={tableHeadClass}>Opened</TableHead>
                <TableHead className={tableHeadClass}>Closed</TableHead>
                <TableHead className={cn(tableHeadClass, "text-right")}>
                  Variance
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {previewSessions.map((session) => (
                <TableRow
                  className="border-b border-border/70 transition-colors hover:bg-muted/40"
                  key={session._id}
                >
                  <TableCell className="font-medium text-foreground">
                    <Link
                      className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      params={{
                        orgUrlSlug,
                        sessionId: session._id,
                        storeUrlSlug,
                      }}
                      search={{ o: getOrigin() }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                    >
                      {formatRegisterName(session.registerNumber)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <Link
                      className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      params={{
                        orgUrlSlug,
                        sessionId: session._id,
                        storeUrlSlug,
                      }}
                      search={{ o: getOrigin() }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                    >
                      {formatTimestamp(session.openedAt)}
                    </Link>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    <Link
                      className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      params={{
                        orgUrlSlug,
                        sessionId: session._id,
                        storeUrlSlug,
                      }}
                      search={{ o: getOrigin() }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                    >
                      {session.closedAt
                        ? formatTimestamp(session.closedAt)
                        : "Not recorded"}
                    </Link>
                  </TableCell>
                  <TableCell
                    className={cn(
                      "text-right font-mono",
                      getVarianceTone(session.variance),
                    )}
                  >
                    <Link
                      className="block rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      params={{
                        orgUrlSlug,
                        sessionId: session._id,
                        storeUrlSlug,
                      }}
                      search={{ o: getOrigin() }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                    >
                      {formatCurrency(currency, session.variance ?? 0)}
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {hasAdditionalSessions ? (
            <div className="flex flex-wrap items-center justify-between gap-layout-sm border-t border-border/70 px-4 py-3">
              <p className="text-sm text-muted-foreground">
                Showing latest {previewSessions.length} of {sessions.length}{" "}
                closed sessions.
              </p>
              <Button asChild size="sm" variant="outline">
                <Link
                  params={{ orgUrlSlug, storeUrlSlug }}
                  search={{ o: getOrigin() }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers"
                >
                  View all register sessions
                  <ArrowUpRight className="h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          ) : null}
        </div>
      )}
    </aside>
  );
}

function CashroomWorkflow({
  currency,
  snapshot,
  orgUrlSlug,
  storeUrlSlug,
}: {
  currency: string;
  snapshot: CashControlsDashboardSnapshot;
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  const sessions = snapshot.registerSessions;
  const needsAttention = sessions.filter(
    (session) =>
      session.status === "closing" || Boolean(session.pendingApprovalRequest),
  );
  const liveDrawers = sessions.filter((session) =>
    ["active", "open"].includes(session.status),
  );
  const closedSessions = sessions.filter(
    (session) => session.status === "closed",
  );
  const { onHandTotal, unresolvedVarianceTotal } = getSnapshotTotals(snapshot);

  return (
    <section className="space-y-layout-md rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
      <div className="flex flex-col gap-layout-md xl:flex-row xl:items-end xl:justify-between">
        <div className="space-y-layout-2xs">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            Cashroom workflow
          </h2>
          <p className="max-w-3xl text-sm text-muted-foreground">
            Move drawers from live cash to reviewed closeout, with exceptions
            surfaced only when action is needed.
          </p>
        </div>
        <div className="grid gap-layout-xs sm:grid-cols-3 xl:min-w-[520px]">
          <WorkflowSummaryItem
            label="Ready for action"
            value={`${needsAttention.length} drawer${needsAttention.length === 1 ? "" : "s"}`}
          />
          <WorkflowSummaryItem
            label="Still in drawers"
            value={formatCurrency(currency, onHandTotal)}
          />
          <WorkflowSummaryItem
            label="Variance exposure"
            tone={unresolvedVarianceTotal > 0 ? "text-danger" : undefined}
            value={formatCurrency(currency, unresolvedVarianceTotal)}
          />
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
          <EmptyState
            description="New register sessions will appear here after the drawer opens."
            title="No register sessions"
          />
        </div>
      ) : (
        <div className="grid gap-layout-lg xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <DrawerSessionLane
            currency={currency}
            emptyDescription="No drawer needs closeout or variance review."
            orgUrlSlug={orgUrlSlug}
            sessions={needsAttention}
            storeUrlSlug={storeUrlSlug}
            title="Needs action"
            variant="primary"
          />
          <div className="space-y-layout-lg">
            <DrawerSessionLane
              currency={currency}
              emptyDescription="No live drawers are open right now."
              orgUrlSlug={orgUrlSlug}
              sessions={liveDrawers}
              storeUrlSlug={storeUrlSlug}
              title="Live drawers"
            />
            <ClosedSessionsSummary
              currency={currency}
              orgUrlSlug={orgUrlSlug}
              sessions={closedSessions}
              storeUrlSlug={storeUrlSlug}
            />
          </div>
        </div>
      )}
    </section>
  );
}

function DepositsLedger({
  currency,
  deposits,
  orgUrlSlug,
  storeUrlSlug,
}: {
  currency: string;
  deposits: CashControlsDashboardDeposit[];
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  const tableHeadClass =
    "text-[11px] uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <section className="space-y-layout-md">
      <div className="space-y-layout-2xs">
        <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
          Recent deposits
        </h2>
        <p className="text-sm text-muted-foreground">
          Recorded bank deposits grouped by register, with a quick path back
          into deposit entry when another drop needs logging.
        </p>
      </div>

      {deposits.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
          <EmptyState
            description="Cash drops will appear here once deposits start getting recorded."
            title="No deposits recorded yet"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className={tableHeadClass}>Register</TableHead>
                <TableHead className={tableHeadClass}>Amount</TableHead>
                <TableHead className={tableHeadClass}>Recorded</TableHead>
                <TableHead className={tableHeadClass}>Reference</TableHead>
                <TableHead className={tableHeadClass}>By</TableHead>
                <TableHead className={tableHeadClass}>Notes</TableHead>
                <TableHead className={cn(tableHeadClass, "text-right")}>
                  Next step
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((deposit) => (
                <TableRow
                  className="group border-b border-border/70 transition-colors hover:bg-muted/40"
                  key={deposit._id}
                >
                  <TableCell className="font-medium text-foreground">
                    {formatRegisterName(deposit.registerNumber)}
                  </TableCell>
                  <TableCell className="font-mono text-foreground">
                    {formatCurrency(currency, deposit.amount)}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTimestamp(deposit.recordedAt)}
                  </TableCell>
                  <TableCell>{deposit.reference ?? "—"}</TableCell>
                  <TableCell>
                    {deposit.recordedByStaffName
                      ? formatStaffDisplayName({
                          fullName: deposit.recordedByStaffName,
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>{deposit.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {deposit.registerSessionId ? (
                      <Button
                        asChild
                        className="border-border bg-background text-foreground hover:bg-surface"
                        size="sm"
                        variant="outline"
                      >
                        <Link
                          params={{
                            orgUrlSlug,
                            sessionId: deposit.registerSessionId,
                            storeUrlSlug,
                          }}
                          search={{ o: getOrigin() }}
                          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                        >
                          Record bank deposit
                        </Link>
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

export function CashControlsDashboardContent({
  currency,
  dashboardSnapshot,
  isLoading,
  orgUrlSlug,
  storeUrlSlug,
}: CashControlsDashboardContentProps) {
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      header={
        <CashControlsWorkspaceHeader
          activeView="cash-controls"
          description="Track live drawers, review deposited totals, and move into session detail before shifting work into closeouts."
          orgUrlSlug={orgUrlSlug}
          storeUrlSlug={storeUrlSlug}
          title="Cash controls workspace"
        />
      }
    >
      <FadeIn className="container mx-auto py-layout-xl">
        <div className="space-y-layout-xl">
          <section className="space-y-layout-md">
            <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
              <div className="space-y-layout-2xs">
                <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                  Today&apos;s control snapshot
                </p>
                <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
                  Cashroom landing
                </h2>
              </div>
              <div className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-raised px-layout-sm py-layout-xs text-sm text-muted-foreground">
                <Landmark aria-hidden className="h-4 w-4 text-signal" />
                Live drawers, deposits, and closeouts
              </div>
            </div>
            <CashPositionSummary
              currency={currency}
              snapshot={dashboardSnapshot}
            />
          </section>

          <WorkflowJumpPoints
            dashboardSnapshot={dashboardSnapshot}
            orgUrlSlug={orgUrlSlug}
            storeUrlSlug={storeUrlSlug}
          />

          {isLoading ? (
            <section className="rounded-lg border border-border bg-surface-raised p-layout-lg text-sm text-muted-foreground shadow-surface">
              Loading cash controls...
            </section>
          ) : (
            <CashroomWorkflow
              currency={currency}
              orgUrlSlug={orgUrlSlug}
              snapshot={dashboardSnapshot}
              storeUrlSlug={storeUrlSlug}
            />
          )}

          <DepositsLedger
            currency={currency}
            deposits={dashboardSnapshot.recentDeposits}
            orgUrlSlug={orgUrlSlug}
            storeUrlSlug={storeUrlSlug}
          />
        </div>
      </FadeIn>
    </View>
  );
}

export function CashControlsDashboard() {
  const {
    activeStore,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState();
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        storeUrlSlug?: string;
      }
    | undefined;

  const dashboardSnapshotArgs = canQueryProtectedData
    ? { storeId: activeStore!._id }
    : "skip";
  const dashboardSnapshot = useQuery(
    api.cashControls.deposits.getDashboardSnapshot,
    dashboardSnapshotArgs,
  );

  if (isLoadingAccess) {
    return (
      <View>
        <div className="container mx-auto py-10 text-sm text-muted-foreground">
          Loading cash controls...
        </div>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before cash controls can load protected register and deposit data." />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!activeStore || !params?.orgUrlSlug || !params.storeUrlSlug) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening the cash-controls workspace."
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <CashControlsDashboardContent
      currency={activeStore.currency || "USD"}
      dashboardSnapshot={
        dashboardSnapshot ?? {
          openSessions: [],
          pendingCloseouts: [],
          recentDeposits: [],
          registerSessions: [],
          unresolvedVariances: [],
        }
      }
      isLoading={dashboardSnapshot === undefined}
      orgUrlSlug={params.orgUrlSlug}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}
