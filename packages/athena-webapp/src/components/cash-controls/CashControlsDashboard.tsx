import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";

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
  return trimmedRegisterNumber ? trimmedRegisterNumber : "Unnamed register";
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
    <dl className="divide-y divide-border/70 rounded-lg border border-border bg-surface-raised">
      {items.map((item) => (
        <div
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-layout-md px-layout-md py-layout-sm"
          key={item.label}
        >
          <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            {item.label}
          </dt>
          <dd className="whitespace-nowrap text-right font-mono text-xl text-foreground">
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
  const tableHeadClass =
    "text-[11px] uppercase tracking-[0.18em] text-muted-foreground";

  return (
    <section className="space-y-layout-md">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-layout-2xs">
          <h2 className="font-display text-2xl font-semibold tracking-tight text-foreground">
            {title}
          </h2>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>

      {sessions.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
          <EmptyState description={emptyDescription} title={emptyTitle} />
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className={tableHeadClass}>Register</TableHead>
                <TableHead className={tableHeadClass}>Status</TableHead>
                <TableHead className={tableHeadClass}>Opened</TableHead>
                <TableHead className={tableHeadClass}>Expected</TableHead>
                <TableHead className={tableHeadClass}>Deposited</TableHead>
                <TableHead className={tableHeadClass}>Variance</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sessions.map((session) => (
                <TableRow
                  className="group cursor-pointer border-b border-border/70 transition-colors hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
                      <p className="font-medium text-foreground">
                        {formatRegisterName(session.registerNumber)}
                      </p>
                      {showPendingApproval &&
                      session.pendingApprovalRequest?.reason ? (
                        <p className="max-w-md text-xs text-muted-foreground">
                          {session.pendingApprovalRequest.reason}
                        </p>
                      ) : null}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      className={getStatusBadgeClass(session.status)}
                      size="sm"
                      variant="outline"
                    >
                      {formatStatusLabel(session.status)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {formatTimestamp(session.openedAt)}
                  </TableCell>
                  <TableCell className="font-mono text-foreground">
                    {formatCurrency(currency, session.expectedCash)}
                  </TableCell>
                  <TableCell className="font-mono text-foreground">
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
        <div className="overflow-hidden rounded-lg border border-border bg-surface-raised">
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
        <div className="space-y-layout-lg">
          <section className="overflow-hidden rounded-lg border border-border bg-surface shadow-surface">
            <div className="grid gap-0 xl:grid-cols-[minmax(280px,320px)_minmax(0,1fr)]">
              <aside className="border-b border-border bg-muted/20 p-layout-lg xl:border-b-0 xl:border-r">
                <div className="space-y-layout-md">
                  <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                    Summary
                  </p>
                  <SummaryStrip
                    currency={currency}
                    snapshot={dashboardSnapshot}
                  />
                </div>
              </aside>

              <div className="p-layout-lg">
                {isLoading ? (
                  <div className="py-layout-lg text-sm text-muted-foreground">
                    Loading cash controls...
                  </div>
                ) : (
                  <SessionLedger
                    currency={currency}
                    description="Register sessions with expected cash, deposited totals, and access to session detail."
                    emptyDescription="New register sessions will appear here after the drawer opens."
                    emptyTitle="No register sessions"
                    orgUrlSlug={orgUrlSlug}
                    sessions={dashboardSnapshot.registerSessions}
                    storeUrlSlug={storeUrlSlug}
                    title="Register sessions"
                  />
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-border bg-surface p-layout-lg shadow-surface">
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
