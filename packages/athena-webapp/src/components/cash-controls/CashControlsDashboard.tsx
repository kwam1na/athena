import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { capitalizeWords, currencyFormatter } from "@/lib/utils";
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
  snapshot,
}: {
  currency: string;
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

  const items = [
    {
      label: "Open sessions",
      value: String(snapshot.openSessions.length),
    },
    {
      label: "Expected cash",
      value: formatCurrency(currency, expectedCashTotal),
    },
    {
      label: "Deposited",
      value: formatCurrency(currency, depositedTotal),
    },
    {
      label: "Recent deposits",
      value: String(snapshot.recentDeposits.length),
    },
  ];

  return (
    <dl className="grid gap-4 sm:grid-cols-2">
      {items.map((item) => (
        <div
          className="space-y-1 border-b border-stone-200/70 pb-3 last:border-b-0 last:pb-0 sm:[&:nth-last-child(-n+2)]:border-b-0 sm:[&:nth-last-child(-n+2)]:pb-0"
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
  const navigate = useNavigate();

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
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow
                  className="group cursor-pointer border-b border-stone-200/70 hover:bg-[#f8f2e8] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400/70 focus-visible:ring-inset"
                  key={session._id}
                  onClick={() =>
                    navigate({
                      params: {
                        orgUrlSlug,
                        sessionId: session._id,
                        storeUrlSlug,
                      },
                      search: { o: getOrigin() },
                      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
                    })
                  }
                  onKeyDown={(event) => {
                    if (event.key !== "Enter" && event.key !== " ") {
                      return;
                    }

                    event.preventDefault();
                    navigate({
                      params: {
                        orgUrlSlug,
                        sessionId: session._id,
                        storeUrlSlug,
                      },
                      search: { o: getOrigin() },
                      to: "/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId",
                    });
                  }}
                  role="link"
                  tabIndex={0}
                >
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-medium text-stone-950">
                        {formatRegisterName(session.registerNumber)}
                      </p>
                      {showPendingApproval &&
                      session.pendingApprovalRequest?.reason ? (
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
                  <TableCell
                    className={`font-mono ${getVarianceTone(session.variance)}`}
                  >
                    {formatCurrency(currency, session.variance ?? 0)}
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
          Recorded bank deposits grouped by register, with a quick path back
          into deposit entry when another drop needs logging.
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
                  Next step
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
                          search={{ o: getOrigin() }}
                          to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
                        >
                          Record bank deposit
                        </Link>
                      </Button>
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
      <FadeIn className="container mx-auto space-y-6 py-8">
        <div className="space-y-6">
          <section className="overflow-hidden rounded-[28px] bg-white/80 ring-1 ring-stone-200/70">
            <div className="grid gap-0 xl:grid-cols-[minmax(0,1.22fr)_320px]">
              <div className="border-b border-stone-200/80 px-6 py-6 xl:border-b-0 xl:border-r">
                {isLoading ? (
                  <div className="py-6 text-sm text-stone-600">
                    Loading cash controls...
                  </div>
                ) : (
                  <SessionLedger
                    currency={currency}
                    description="Live drawers with expected cash, deposited totals, and access to deposit entry."
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
                <div className="space-y-3">
                  <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-stone-500">
                    Summary
                  </p>
                  <SummaryStrip
                    currency={currency}
                    snapshot={dashboardSnapshot}
                  />
                </div>
              </aside>
            </div>
          </section>

          <section className="rounded-[24px] bg-white/80 px-6 py-6 ring-1 ring-stone-200/70">
            <DepositsLedger
              currency={currency}
              deposits={dashboardSnapshot.recentDeposits}
              orgUrlSlug={orgUrlSlug}
              storeUrlSlug={storeUrlSlug}
            />
          </section>
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
          unresolvedVariances: [],
        }
      }
      isLoading={dashboardSnapshot === undefined}
      orgUrlSlug={params.orgUrlSlug}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}
