import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { capitalizeWords, currencyFormatter } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { SimplePageHeader } from "../common/PageHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { WorkflowTraceRouteLink } from "../traces/WorkflowTraceRouteLink";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";

const containerVariants = {
  hidden: {},
  visible: {
    transition: {
      delayChildren: 0.04,
      staggerChildren: 0.06,
    },
  },
};

const sectionVariants = {
  hidden: { opacity: 0, y: 12 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.28, ease: [0.16, 1, 0.3, 1] },
  },
};

type DashboardApprovalRequest = {
  _id: string;
  reason?: string | null;
  requestedByStaffName?: string | null;
  status: string;
};

export type CashControlsDashboardSession = {
  _id: string;
  countedCash?: number;
  expectedCash: number;
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
  unresolvedVariances: CashControlsDashboardSession[];
};

type CashControlsDashboardFocus = "overview" | "registers";

type CashControlsDashboardContentProps = {
  currency: string;
  dashboardSnapshot: CashControlsDashboardSnapshot;
  focus: CashControlsDashboardFocus;
  isLoading: boolean;
  orgUrlSlug: string;
  storeUrlSlug: string;
};

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return currencyFormatter(currency).format(amount);
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
  return trimmedRegisterNumber ? trimmedRegisterNumber : "Unnamed register";
}

function getVarianceTone(variance?: number) {
  if (!variance) {
    return "text-foreground";
  }

  return variance > 0 ? "text-emerald-700" : "text-destructive";
}

function SummaryStrip({
  currency,
  focus,
  snapshot,
}: {
  currency: string;
  focus: CashControlsDashboardFocus;
  snapshot: CashControlsDashboardSnapshot;
}) {
  const expectedCashTotal = snapshot.openSessions.reduce(
    (total, session) => total + session.expectedCash,
    0,
  );
  const depositedTotal = snapshot.openSessions.reduce(
    (total, session) => total + session.totalDeposited,
    0,
  );

  const items =
    focus === "overview"
      ? [
          { label: "Open sessions", value: String(snapshot.openSessions.length) },
          { label: "Pending closeouts", value: String(snapshot.pendingCloseouts.length) },
          {
            label: "Unresolved variances",
            value: String(snapshot.unresolvedVariances.length),
          },
          { label: "Recent deposits", value: String(snapshot.recentDeposits.length) },
        ]
      : [
          { label: "Open sessions", value: String(snapshot.openSessions.length) },
          { label: "Expected cash", value: formatCurrency(currency, expectedCashTotal) },
          { label: "Deposited", value: formatCurrency(currency, depositedTotal) },
          { label: "Recent deposits", value: String(snapshot.recentDeposits.length) },
        ];

  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div
          className="space-y-1 border-b border-stone-200/70 pb-3 last:border-b-0 last:pb-0"
          key={item.label}
        >
          <dt className="text-[11px] font-medium uppercase tracking-[0.24em] text-amber-800/70">
            {item.label}
          </dt>
          <dd className="font-mono text-2xl tracking-[-0.04em] text-stone-950">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function DashboardNav({
  focus,
  orgUrlSlug,
  storeUrlSlug,
}: {
  focus: CashControlsDashboardFocus;
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        asChild
        className={
          focus === "overview"
            ? "bg-stone-950 text-stone-50 hover:bg-stone-950/90"
            : "border-stone-300 bg-transparent text-stone-700 hover:bg-stone-100"
        }
        size="sm"
        variant="outline"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls"
        >
          Overview
        </Link>
      </Button>
      <Button
        asChild
        className={
          focus === "registers"
            ? "bg-stone-950 text-stone-50 hover:bg-stone-950/90"
            : "border-stone-300 bg-transparent text-stone-700 hover:bg-stone-100"
        }
        size="sm"
        variant="outline"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers"
        >
          Registers
        </Link>
      </Button>
      <Button
        asChild
        className="border-amber-300/80 bg-amber-50 text-amber-900 hover:bg-amber-100"
        size="sm"
        variant="outline"
      >
        <Link
          params={{ orgUrlSlug, storeUrlSlug }}
          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/closeouts"
        >
          Closeouts
        </Link>
      </Button>
    </div>
  );
}

function SessionLedger({
  currency,
  description,
  emptyDescription,
  emptyTitle,
  orgUrlSlug,
  sessions,
  showPendingApproval,
  storeUrlSlug,
  title,
}: {
  currency: string;
  description: string;
  emptyDescription: string;
  emptyTitle: string;
  orgUrlSlug: string;
  sessions: CashControlsDashboardSession[];
  showPendingApproval?: boolean;
  storeUrlSlug: string;
  title: string;
}) {
  return (
    <section className="space-y-4">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
            {title}
          </h2>
          <p className="text-sm text-stone-600">{description}</p>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-[22px] bg-white/70 px-6 py-8 ring-1 ring-stone-200/70">
          <EmptyState description={emptyDescription} title={emptyTitle} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-[22px] bg-white/80 ring-1 ring-stone-200/70">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-stone-200/80 hover:bg-transparent">
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Register
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Status
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Opened
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Expected
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Deposited
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Variance
                </TableHead>
                <TableHead className="text-right text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow
                  className="group border-b border-stone-200/70 hover:bg-[#f8f2e8]"
                  key={session._id}
                >
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-medium text-stone-950">
                        {formatRegisterName(session.registerNumber)}
                      </p>
                      {showPendingApproval && session.pendingApprovalRequest?.reason ? (
                        <p className="max-w-md text-xs text-stone-500">
                          {session.pendingApprovalRequest.reason}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className="border-stone-300/80 bg-stone-100 text-stone-700"
                      size="sm"
                      variant="outline"
                    >
                      {formatStatusLabel(session.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-stone-600">
                    {formatTimestamp(session.openedAt)}
                  </TableCell>
                  <TableCell className="font-mono text-stone-950">
                    {formatCurrency(currency, session.expectedCash)}
                  </TableCell>
                  <TableCell className="font-mono text-stone-950">
                    {formatCurrency(currency, session.totalDeposited)}
                  </TableCell>
                  <TableCell className={`font-mono ${getVarianceTone(session.variance)}`}>
                    {formatCurrency(currency, session.variance ?? 0)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2 opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                      {session.workflowTraceId ? (
                        <Button
                          asChild
                          className="border-stone-300 bg-white/90 text-stone-800 hover:bg-white"
                          size="sm"
                          variant="outline"
                        >
                          <WorkflowTraceRouteLink traceId={session.workflowTraceId}>
                            View trace
                          </WorkflowTraceRouteLink>
                        </Button>
                      ) : null}
                      <Button
                        asChild
                        className="border-stone-300 bg-white/90 text-stone-800 hover:bg-white"
                        size="sm"
                        variant="outline"
                      >
                        <Link
                          params={{
                            orgUrlSlug,
                            sessionId: session._id,
                            storeUrlSlug,
                          }}
                          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                        >
                          View session
                        </Link>
                      </Button>
                    </div>
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
  return (
    <section className="space-y-4">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-[-0.04em] text-stone-950">
          Recent deposits
        </h2>
        <p className="text-sm text-stone-600">
          Recorded cash drops grouped by register and ready for follow-up.
        </p>
      </div>

      {deposits.length === 0 ? (
        <div className="rounded-[22px] bg-white/70 px-6 py-8 ring-1 ring-stone-200/70">
          <EmptyState
            description="Cash drops will appear here once deposits start getting recorded."
            title="No deposits recorded yet"
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-[22px] bg-white/80 ring-1 ring-stone-200/70">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-stone-200/80 hover:bg-transparent">
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Register
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Amount
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Recorded
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Reference
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  By
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Notes
                </TableHead>
                <TableHead className="text-right text-[11px] uppercase tracking-[0.18em] text-stone-500">
                  Action
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {deposits.map((deposit) => (
                <TableRow
                  className="group border-b border-stone-200/70 hover:bg-[#f8f2e8]"
                  key={deposit._id}
                >
                  <TableCell className="font-medium text-stone-950">
                    {formatRegisterName(deposit.registerNumber)}
                  </TableCell>
                  <TableCell className="font-mono text-stone-950">
                    {formatCurrency(currency, deposit.amount)}
                  </TableCell>
                  <TableCell className="text-stone-600">
                    {formatTimestamp(deposit.recordedAt)}
                  </TableCell>
                  <TableCell>{deposit.reference ?? "—"}</TableCell>
                  <TableCell>{deposit.recordedByStaffName ?? "—"}</TableCell>
                  <TableCell>{deposit.notes ?? "—"}</TableCell>
                  <TableCell className="text-right">
                    {deposit.registerSessionId ? (
                      <div className="opacity-0 transition duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                        <Button
                          asChild
                          className="border-stone-300 bg-white/90 text-stone-800 hover:bg-white"
                          size="sm"
                          variant="outline"
                        >
                          <Link
                            params={{
                              orgUrlSlug,
                              sessionId: deposit.registerSessionId,
                              storeUrlSlug,
                            }}
                            to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                          >
                            View session
                          </Link>
                        </Button>
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400">—</span>
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
  focus,
  isLoading,
  orgUrlSlug,
  storeUrlSlug,
}: CashControlsDashboardContentProps) {
  return (
    <View
      header={
        <SimplePageHeader
          className="text-lg font-semibold"
          title="Cash Controls"
        />
      }
    >
      <FadeIn>
        <motion.div
          animate="visible"
          className="container mx-auto space-y-6 p-6"
          initial="hidden"
          variants={containerVariants}
        >
          <motion.section
            className="overflow-hidden rounded-[28px] bg-[#f7f1e7] ring-1 ring-stone-200/80"
            variants={sectionVariants}
          >
            <div className="border-b border-stone-200/80 px-6 py-6 lg:flex lg:items-start lg:justify-between">
              <div className="max-w-2xl space-y-2">
                <p className="text-[11px] font-medium uppercase tracking-[0.28em] text-amber-800/75">
                  Cashroom ledger
                </p>
                <div className="space-y-1">
                  <h1 className="text-3xl font-semibold tracking-[-0.05em] text-stone-950">
                    {focus === "overview" ? "Register sessions" : "Register workspace"}
                  </h1>
                  <p className="text-sm text-stone-600">
                    Open drawers first, manager follow-up second, cash-drop detail after that.
                  </p>
                </div>
              </div>

              <div className="mt-4 lg:mt-0">
                <DashboardNav
                  focus={focus}
                  orgUrlSlug={orgUrlSlug}
                  storeUrlSlug={storeUrlSlug}
                />
              </div>
            </div>

            <div className="grid gap-0 xl:grid-cols-[minmax(0,1.22fr)_320px]">
              <div className="border-b border-stone-200/80 px-6 py-6 xl:border-b-0 xl:border-r">
                {isLoading ? (
                  <div className="py-6 text-sm text-stone-600">
                    Loading cash controls...
                  </div>
                ) : (
                  <SessionLedger
                    currency={currency}
                    description="Open and active drawers with the current expected cash and deposit position."
                    emptyDescription="New register sessions will appear here after the drawer opens."
                    emptyTitle="No open register sessions"
                    orgUrlSlug={orgUrlSlug}
                    sessions={dashboardSnapshot.openSessions}
                    storeUrlSlug={storeUrlSlug}
                    title="Register sessions"
                  />
                )}
              </div>

              <aside className="px-6 py-6">
                <div className="space-y-6">
                  <div className="space-y-3">
                    <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-stone-500">
                      Summary
                    </p>
                    <SummaryStrip
                      currency={currency}
                      focus={focus}
                      snapshot={dashboardSnapshot}
                    />
                  </div>

                  <div className="space-y-2 border-t border-stone-200/70 pt-6">
                    <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-stone-500">
                      Scope
                    </p>
                    <p className="text-sm text-stone-600">
                      {focus === "overview"
                        ? "Use this view to scan the live drawer surface before switching into closeouts."
                        : "Use this view to move from register totals into the session-level deposit detail."}
                    </p>
                  </div>
                </div>
              </aside>
            </div>
          </motion.section>

          {focus === "overview" ? (
            <motion.div
              className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,0.92fr)]"
              variants={sectionVariants}
            >
              <div className="rounded-[24px] bg-white/80 px-6 py-6 ring-1 ring-stone-200/70">
                <SessionLedger
                  currency={currency}
                  description="Closing drawers that still need review, manager approval, or a final closeout decision."
                  emptyDescription="Closeout work will appear here once register counts get submitted."
                  emptyTitle="No pending closeouts"
                  orgUrlSlug={orgUrlSlug}
                  sessions={dashboardSnapshot.pendingCloseouts}
                  showPendingApproval
                  storeUrlSlug={storeUrlSlug}
                  title="Pending closeouts"
                />
              </div>

              <div className="rounded-[24px] bg-white/80 px-6 py-6 ring-1 ring-stone-200/70">
                <SessionLedger
                  currency={currency}
                  description="Remaining shortages or overages that still need a manager decision."
                  emptyDescription="Variances that need follow-up will appear here."
                  emptyTitle="No unresolved variances"
                  orgUrlSlug={orgUrlSlug}
                  sessions={dashboardSnapshot.unresolvedVariances}
                  showPendingApproval
                  storeUrlSlug={storeUrlSlug}
                  title="Unresolved variances"
                />
              </div>
            </motion.div>
          ) : null}

          <motion.section
            className="rounded-[24px] bg-white/80 px-6 py-6 ring-1 ring-stone-200/70"
            variants={sectionVariants}
          >
            <DepositsLedger
              currency={currency}
              deposits={dashboardSnapshot.recentDeposits}
              orgUrlSlug={orgUrlSlug}
              storeUrlSlug={storeUrlSlug}
            />
          </motion.section>
        </motion.div>
      </FadeIn>
    </View>
  );
}

export function CashControlsDashboard({
  focus = "overview",
}: {
  focus?: CashControlsDashboardFocus;
}) {
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
          unresolvedVariances: [],
        }
      }
      focus={focus}
      isLoading={dashboardSnapshot === undefined}
      orgUrlSlug={params.orgUrlSlug}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}
