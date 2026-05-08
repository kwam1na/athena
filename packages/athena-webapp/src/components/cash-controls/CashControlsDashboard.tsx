import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowRight, ArrowUpRight } from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { capitalizeWords, cn } from "@/lib/utils";
import { formatStoredCurrencyAmount } from "@/lib/pos/displayAmounts";
import { api } from "~/convex/_generated/api";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Skeleton } from "../ui/skeleton";
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
  terminalName?: string | null;
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

function MetricCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
      <Skeleton className="h-3 w-32" />
      <Skeleton className="mt-layout-xs h-8 w-24" />
      <Skeleton className="mt-2 h-3 w-36" />
    </div>
  );
}

function DrawerCardSkeleton() {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
      <div className="flex items-start justify-between gap-layout-md">
        <div className="space-y-2">
          <Skeleton className="h-4 w-36" />
          <Skeleton className="h-3 w-52" />
        </div>
        <Skeleton className="h-6 w-20" />
      </div>
      <div className="mt-layout-md grid grid-cols-3 gap-layout-sm">
        {Array.from({ length: 3 }).map((_, index) => (
          <div className="space-y-2" key={index}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <Skeleton className="mt-layout-md h-4 w-32" />
    </div>
  );
}

function DepositsTableSkeleton() {
  return (
    <div className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface">
      <div className="grid grid-cols-[1fr_120px_160px_120px_120px_1fr_140px] gap-layout-sm border-b px-4 py-4">
        {Array.from({ length: 7 }).map((_, index) => (
          <Skeleton className="h-3 w-20" key={index} />
        ))}
      </div>
      {Array.from({ length: 3 }).map((_, index) => (
        <div
          className="grid grid-cols-[1fr_120px_160px_120px_120px_1fr_140px] items-center gap-layout-sm border-b px-4 py-4 last:border-b-0"
          key={index}
        >
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-4 w-32" />
          <Skeleton className="ml-auto h-8 w-32" />
        </div>
      ))}
    </div>
  );
}

function CashControlsDashboardSkeleton() {
  return (
    <div
      aria-label="Loading cash controls workspace"
      className="space-y-layout-3xl"
    >
      <section className="space-y-layout-md">
        <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-layout-2xs">
            <Skeleton className="h-3 w-44" />
            <Skeleton className="h-8 w-56" />
          </div>
          <Skeleton className="h-10 w-72" />
        </div>
        <div className="grid gap-layout-sm md:grid-cols-2 2xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <MetricCardSkeleton key={index} />
          ))}
        </div>
      </section>

      <section className="grid gap-layout-lg xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section className="space-y-layout-sm">
          <div className="flex items-center justify-between gap-layout-md">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-6 w-10" />
          </div>
          <div className="space-y-layout-xl">
            <DrawerCardSkeleton />
            <DrawerCardSkeleton />
          </div>
        </section>
        <section className="space-y-layout-sm">
          <div className="flex items-center justify-between gap-layout-md">
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-56" />
            </div>
            <Skeleton className="h-6 w-10" />
          </div>
          <div className="rounded-lg border border-border bg-background p-layout-md">
            <div className="grid grid-cols-4 gap-layout-sm border-b pb-layout-sm">
              {Array.from({ length: 4 }).map((_, index) => (
                <Skeleton className="h-3 w-20" key={index} />
              ))}
            </div>
            {Array.from({ length: 3 }).map((_, index) => (
              <div
                className="grid grid-cols-4 gap-layout-sm border-b py-layout-sm last:border-b-0"
                key={index}
              >
                {Array.from({ length: 4 }).map((__, cellIndex) => (
                  <Skeleton className="h-4 w-24" key={cellIndex} />
                ))}
              </div>
            ))}
          </div>
        </section>
      </section>

      <section className="space-y-layout-md">
        <div className="space-y-layout-2xs">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-4 w-[42rem] max-w-full" />
        </div>
        <DepositsTableSkeleton />
      </section>
    </div>
  );
}

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return formatStoredCurrencyAmount(currency, amount, {
    revealMinorUnits: true,
  });
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
  const cashExposureSessions = snapshot.registerSessions.filter((session) =>
    ["active", "open", "closing"].includes(session.status),
  );
  const expectedCashTotal = cashExposureSessions.reduce(
    (total, session) => total + session.expectedCash,
    0,
  );
  const depositedTotal = cashExposureSessions.reduce(
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

function formatCashExposureSupporting(snapshot: CashControlsDashboardSnapshot) {
  const liveCount = snapshot.openSessions.length;
  const reviewCount = snapshot.pendingCloseouts.length;
  const parts = [];

  if (liveCount > 0) {
    parts.push(`${liveCount} live drawer${liveCount === 1 ? "" : "s"}`);
  }

  if (reviewCount > 0) {
    parts.push(`${reviewCount} in review`);
  }

  return parts.length > 0 ? parts.join(", ") : "No drawers in cashroom flow";
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
      supporting: formatCashExposureSupporting(snapshot),
      value: formatCurrency(currency, expectedCashTotal),
    },
    {
      label: "Deposits recorded",
      supporting: `${snapshot.recentDeposits.length == 0 ? "No" : snapshot.recentDeposits.length} recent drop${snapshot.recentDeposits.length === 1 ? "" : "s"}`,
      value: formatCurrency(currency, depositedTotal),
    },
    {
      label: "Still in drawers",
      supporting: "Live and review drawers minus deposits",
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
              "mt-layout-xs whitespace-nowrap font-numeric text-2xl tabular-nums text-foreground",
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

function needsVarianceReview(session: CashControlsDashboardSession) {
  return Boolean(session.pendingApprovalRequest || session.variance);
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

function getSessionTerminalLine(session: CashControlsDashboardSession) {
  const terminalName = session.terminalName?.trim();

  return terminalName;
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
      <p
        className={cn(
          "mt-1 font-numeric tabular-nums text-base text-foreground",
          tone,
        )}
      >
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
  const showVariance = variance !== 0;
  const showCountedCash = variance !== 0 && session.countedCash !== undefined;
  const showDeposited = session.totalDeposited > 0;
  const metricColumnCount =
    1 +
    (showDeposited ? 1 : 0) +
    (showCountedCash ? 1 : 0) +
    (showVariance ? 1 : 0);
  const openedLine = getSessionOpenedLine(session);
  const terminalLine = getSessionTerminalLine(session);

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
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <p className="truncate font-medium text-foreground">
              {formatRegisterName(session.registerNumber)}
            </p>
            {terminalLine ? (
              <p className="truncate text-xs text-muted-foreground">
                {terminalLine}
              </p>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">{openedLine}</p>
        </div>
        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {needsVarianceReview(session) ? (
            <Badge
              className="border-transparent bg-danger/10 text-danger"
              size="sm"
              variant="outline"
            >
              Needs review
            </Badge>
          ) : null}
          <Badge
            className={getStatusBadgeClass(session.status)}
            size="sm"
            variant="outline"
          >
            {formatStatusLabel(session.status)}
          </Badge>
        </div>
      </div>

      <dl
        className={cn(
          "mt-layout-md grid gap-layout-sm",
          metricColumnCount === 4
            ? "grid-cols-4"
            : metricColumnCount === 3
              ? "grid-cols-3"
              : "grid-cols-2",
        )}
      >
        <div>
          <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Expected cash
          </dt>
          <dd className="mt-1 font-numeric tabular-nums text-sm text-foreground">
            {formatCurrency(currency, session.expectedCash)}
          </dd>
        </div>
        {showDeposited ? (
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Deposited
            </dt>
            <dd className="mt-1 font-numeric tabular-nums text-sm text-foreground">
              {formatCurrency(currency, session.totalDeposited)}
            </dd>
          </div>
        ) : null}
        {showCountedCash ? (
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Counted
            </dt>
            <dd className="mt-1 font-numeric tabular-nums text-sm text-foreground">
              {formatCurrency(currency, session.countedCash ?? 0)}
            </dd>
          </div>
        ) : null}
        {showVariance ? (
          <div>
            <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              Variance
            </dt>
            <dd
              className={cn(
                "mt-1 font-numeric tabular-nums text-sm",
                getVarianceTone(variance),
              )}
            >
              {formatCurrency(currency, variance)}
            </dd>
          </div>
        ) : null}
      </dl>

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
        <div className="space-y-layout-xl">
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
    <aside className="space-y-layout-sm">
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
        <p className="rounded-lg border border-dashed border-border bg-background/60 px-layout-md py-layout-lg text-sm text-muted-foreground">
          Closed sessions will appear after closeout.
        </p>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-background">
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
                  className="group border-b border-border/70 transition-colors hover:bg-muted/40"
                  key={session._id}
                >
                  <TableCell className="p-0 font-medium text-foreground">
                    <Link
                      className="block h-full w-full px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  <TableCell className="p-0 text-xs text-muted-foreground">
                    <Link
                      aria-label={`Open ${formatRegisterName(session.registerNumber)} opened ${formatTimestamp(session.openedAt)}`}
                      className="block h-full w-full px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                  <TableCell className="p-0 text-xs text-muted-foreground">
                    <Link
                      aria-label={`Open ${formatRegisterName(session.registerNumber)} closed ${
                        session.closedAt
                          ? formatTimestamp(session.closedAt)
                          : "not recorded"
                      }`}
                      className="block h-full w-full px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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
                      "p-0 text-right font-numeric tabular-nums",
                      getVarianceTone(session.variance),
                    )}
                  >
                    <Link
                      aria-label={`Open ${formatRegisterName(session.registerNumber)} variance ${formatCurrency(
                        currency,
                        session.variance ?? 0,
                      )}`}
                      className="block h-full w-full px-4 py-4 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
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

function ClosedSessionsSnapshot({
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
  const closedCount = sessions.length;
  const expectedTotal = sessions.reduce(
    (total, session) => total + session.expectedCash,
    0,
  );
  const countedTotal = sessions.reduce(
    (total, session) => total + (session.countedCash ?? 0),
    0,
  );
  const depositedTotal = sessions.reduce(
    (total, session) => total + session.totalDeposited,
    0,
  );
  const netVariance = sessions.reduce(
    (total, session) => total + (session.variance ?? 0),
    0,
  );
  const shortSessions = sessions.filter(
    (session) => (session.variance ?? 0) < 0,
  );
  const overSessions = sessions.filter(
    (session) => (session.variance ?? 0) > 0,
  );
  const balancedSessions = sessions.filter(
    (session) => (session.variance ?? 0) === 0,
  );
  const shortTotal = shortSessions.reduce(
    (total, session) => total + Math.abs(session.variance ?? 0),
    0,
  );
  const overTotal = overSessions.reduce(
    (total, session) => total + (session.variance ?? 0),
    0,
  );
  const lastClosedAt = sessions.reduce<number | undefined>(
    (latest, session) =>
      session.closedAt && (!latest || session.closedAt > latest)
        ? session.closedAt
        : latest,
    undefined,
  );

  return (
    <aside className="space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-lg shadow-surface">
      <div className="flex flex-wrap items-start justify-between gap-layout-md">
        <div className="space-y-1">
          <h3 className="font-display text-lg font-semibold text-foreground">
            Closed session history
          </h3>
          <p className="text-sm text-muted-foreground">
            Recent closed drawer sessions from the store ledger. Use this
            snapshot to review closeout patterns before opening the session
            ledger.
          </p>
        </div>
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

      <dl className="grid gap-layout-sm md:grid-cols-2 2xl:grid-cols-4">
        <WorkflowSummaryItem label="Closed sessions" value={`${closedCount}`} />
        <WorkflowSummaryItem
          label="Expected cash"
          value={formatCurrency(currency, expectedTotal)}
        />
        <WorkflowSummaryItem
          label="Counted cash"
          value={formatCurrency(currency, countedTotal)}
        />
        <WorkflowSummaryItem
          label="Net variance"
          tone={getVarianceTone(netVariance)}
          value={formatCurrency(currency, netVariance)}
        />
      </dl>

      <div className="grid gap-layout-sm border-t border-border/70 pt-layout-md md:grid-cols-2 2xl:grid-cols-4">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Balanced drawers
          </p>
          <p className="text-sm text-foreground">
            {balancedSessions.length} of {closedCount}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Short drawers
          </p>
          <p className="font-numeric tabular-nums text-sm text-danger">
            {shortSessions.length} / {formatCurrency(currency, shortTotal)}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Over drawers
          </p>
          <p className="font-numeric tabular-nums text-sm text-success">
            {overSessions.length} / {formatCurrency(currency, overTotal)}
          </p>
        </div>
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            Last closeout
          </p>
          <p className="text-sm text-foreground">
            {lastClosedAt ? formatTimestamp(lastClosedAt) : "Not recorded"}
          </p>
        </div>
      </div>

      <div className="rounded-lg border border-border/70 bg-background/70 px-layout-md py-layout-sm">
        <div className="flex flex-wrap items-center justify-between gap-layout-sm text-sm">
          <span className="text-muted-foreground">
            Deposited across closed sessions
          </span>
          <span className="font-numeric tabular-nums text-foreground">
            {formatCurrency(currency, depositedTotal)}
          </span>
        </div>
      </div>
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
  const hasNeedsAttention = needsAttention.length > 0;
  const hasLiveDrawers = liveDrawers.length > 0;
  const primaryLane = hasNeedsAttention
    ? {
        emptyDescription: "No drawer needs closeout or variance review",
        sessions: needsAttention,
        title: "Needs action",
      }
    : hasLiveDrawers
      ? {
          emptyDescription: "No live drawers are open right now",
          sessions: liveDrawers,
          title: "Live drawers",
        }
      : undefined;

  return (
    <section className="space-y-layout-2xl">
      {sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
          <EmptyState
            description="New register sessions will appear here after the drawer opens"
            title="No register sessions"
          />
        </div>
      ) : (
        <div
          className={cn(
            "grid gap-layout-lg",
            primaryLane
              ? "xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]"
              : "xl:grid-cols-[minmax(0,1fr)]",
          )}
        >
          {primaryLane ? (
            <DrawerSessionLane
              currency={currency}
              emptyDescription={primaryLane.emptyDescription}
              orgUrlSlug={orgUrlSlug}
              sessions={primaryLane.sessions}
              storeUrlSlug={storeUrlSlug}
              title={primaryLane.title}
              variant="primary"
            />
          ) : null}
          <div className="space-y-layout-3xl">
            {hasNeedsAttention ? (
              <DrawerSessionLane
                currency={currency}
                emptyDescription="No live drawers are open right now"
                orgUrlSlug={orgUrlSlug}
                sessions={liveDrawers}
                storeUrlSlug={storeUrlSlug}
                title="Live drawers"
              />
            ) : null}
            {primaryLane ? (
              <ClosedSessionsSummary
                currency={currency}
                orgUrlSlug={orgUrlSlug}
                sessions={closedSessions}
                storeUrlSlug={storeUrlSlug}
              />
            ) : (
              <ClosedSessionsSnapshot
                currency={currency}
                orgUrlSlug={orgUrlSlug}
                sessions={closedSessions}
                storeUrlSlug={storeUrlSlug}
              />
            )}
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
            description="Cash drops will appear here once deposits start getting recorded"
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
                  <TableCell className="font-numeric tabular-nums text-foreground">
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
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Cash Ops"
            title="Cash controls"
            description="Track live drawers, review deposited totals, and move into session detail before shifting work into closeouts."
          />

          {isLoading ? (
            <CashControlsDashboardSkeleton />
          ) : (
            <PageWorkspaceMain>
              <section className="space-y-layout-md">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-layout-2xs">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                      Current control snapshot
                    </p>
                  </div>
                  <div className="inline-flex items-center gap-2 rounded-md border border-border bg-surface-raised px-layout-sm py-layout-xs text-sm text-muted-foreground">
                    <span
                      aria-hidden
                      className="h-2 w-2 rounded-full bg-signal"
                    />
                    Live drawers, recent deposits, and session history
                  </div>
                </div>
                <CashPositionSummary
                  currency={currency}
                  snapshot={dashboardSnapshot}
                />
              </section>

              <CashroomWorkflow
                currency={currency}
                orgUrlSlug={orgUrlSlug}
                snapshot={dashboardSnapshot}
                storeUrlSlug={storeUrlSlug}
              />

              <DepositsLedger
                currency={currency}
                deposits={dashboardSnapshot.recentDeposits}
                orgUrlSlug={orgUrlSlug}
                storeUrlSlug={storeUrlSlug}
              />
            </PageWorkspaceMain>
          )}
        </PageWorkspace>
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
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <div aria-label="Loading cash controls workspace" />
        </FadeIn>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before cash controls can load protected register and deposit data" />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!activeStore || !params?.orgUrlSlug || !params.storeUrlSlug) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening the cash-controls workspace"
          title="No active store"
        />
      </div>
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
