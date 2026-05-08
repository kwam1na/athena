import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  ArrowUpRight,
  Clock3,
  ListChecks,
} from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { getOrigin } from "@/lib/navigationUtils";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { cn } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { currencyFormatter } from "~/shared/currencyFormatter";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
  PageWorkspaceRail,
} from "../common/PageLevelHeader";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";

type DailyOperationsApi = {
  getDailyOperationsSnapshot?: unknown;
};

const useExpectedDailyOperationsQuery = useQuery as unknown as (
  query: unknown,
  args: unknown,
) => unknown;

export type DailyOperationsLifecycleStatus =
  | "not_opened"
  | "operating"
  | "close_blocked"
  | "ready_to_close"
  | "closed";

export type DailyOperationsLaneStatus =
  | "blocked"
  | "needs_attention"
  | "ready"
  | "closed"
  | "unknown";

export type DailyOperationsSnapshot = {
  attentionItems: Array<{
    id: string;
    label: string;
    message: string;
    owner: "daily_opening" | "daily_close" | "operations_queue";
    params?: Record<string, string>;
    search?: Record<string, string>;
    severity: "critical" | "warning" | "info";
    source: {
      id: string;
      label?: string;
      type: string;
    };
    to?: string;
  }>;
  closeSummary: {
    carriedOverCashTotal: number;
    carriedOverRegisterCount: number;
    currentDayCashTotal: number;
    currentDayCashTransactionCount: number;
    expenseTotal: number;
    expenseTransactionCount: number;
    netCashVariance: number;
    registerVarianceCount: number;
    salesTotal: number;
    transactionCount: number;
  };
  currency: string;
  endAt?: number;
  lanes: Array<{
    count: number;
    countLabel?: string;
    description: string;
    key: string;
    label: string;
    status: DailyOperationsLaneStatus;
    to: string;
  }>;
  lifecycle: {
    description: string;
    label: string;
    status: DailyOperationsLifecycleStatus;
  };
  operatingDate: string;
  primaryAction: {
    label: string;
    to: string;
  };
  startAt?: number;
  storeId: Id<"store">;
  timeline: Array<{
    createdAt: number;
    id: string;
    message: string;
    subject: {
      id: string;
      label?: string;
      type: string;
    };
    type: string;
  }>;
};

type DailyOperationsViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  isAuthenticated: boolean;
  isLoadingAccess: boolean;
  isLoadingSnapshot: boolean;
  orgUrlSlug: string;
  snapshot?: DailyOperationsSnapshot;
  storeUrlSlug: string;
};

const TIMELINE_PREVIEW_LIMIT = 5;

function getDailyOperationsApi(): DailyOperationsApi {
  return (
    (
      api.operations as typeof api.operations & {
        dailyOperations?: DailyOperationsApi;
      }
    ).dailyOperations ?? {}
  );
}

function getLocalOperatingDate(date = new Date()) {
  const localDate = new Date(
    date.getTime() - date.getTimezoneOffset() * 60_000,
  );

  return localDate.toISOString().slice(0, 10);
}

function getLocalOperatingDateRange(date = new Date()) {
  const localStart = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
  );
  const localEnd = new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate() + 1,
  );

  return {
    endAt: localEnd.getTime(),
    operatingDate: getLocalOperatingDate(date),
    startAt: localStart.getTime(),
  };
}

function formatOperatingDate(operatingDate?: string | null) {
  if (!operatingDate) return "Not available";

  const parsed = new Date(`${operatingDate}T00:00:00`);

  if (Number.isNaN(parsed.getTime())) {
    return operatingDate;
  }

  return parsed.toLocaleDateString([], {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function formatEventTime(timestamp: number) {
  return new Intl.DateTimeFormat([], {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function formatTimelineMessage(message: string) {
  return message.replace(
    /\b(\d{4})-(\d{2})-(\d{2})\b/g,
    (value, year, month, day) => {
      const parsed = new Date(
        Number(year),
        Number(month) - 1,
        Number(day),
      );

      if (Number.isNaN(parsed.getTime())) {
        return value;
      }

      return parsed.toLocaleDateString([], {
        day: "numeric",
        month: "long",
        year: "numeric",
      });
    },
  );
}

function formatEntityCount(
  value: number,
  singular: string,
  plural = `${singular}s`,
) {
  if (value === 0) return `No ${plural}`;
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural}`;
}

function formatTodayCashTransactionCount(value: number) {
  if (value === 0) return "No cash transactions";
  if (value === 1) return "1 cash transaction";
  return `${value} cash transactions`;
}

function formatCarriedOverRegisterCount(value: number) {
  if (value === 0) return "No registers from prior days";
  if (value === 1) return "1 register from a prior day";
  return `${value} registers from prior days`;
}

function formatRegisterVarianceCount(value: number) {
  if (value === 0) return "No register variances";
  if (value === 1) return "1 register variance";
  return `${value} register variances`;
}

function formatMoney(currency: string, amount: number) {
  return formatStoredAmount(currencyFormatter(currency), amount);
}

function statusClassName(status: DailyOperationsLaneStatus) {
  if (status === "blocked") return "border-danger/30 bg-danger/10 text-danger";
  if (status === "needs_attention") {
    return "border-warning/40 bg-warning/10 text-warning-foreground";
  }
  if (status === "closed" || status === "ready") {
    return "border-success/30 bg-success/10 text-success";
  }

  return "border-border bg-background text-muted-foreground";
}

function statusLabel(status: DailyOperationsLaneStatus) {
  if (status === "needs_attention") return "Needs attention";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

function buildParams(
  orgUrlSlug: string,
  storeUrlSlug: string,
  params?: Record<string, string>,
) {
  return {
    ...(params ?? {}),
    orgUrlSlug,
    storeUrlSlug,
  };
}

function LoadingWorkspace() {
  return (
    <div className="grid gap-layout-lg lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-layout-md">
        <div className="h-28 animate-pulse rounded-lg bg-surface" />
        <div className="grid gap-layout-sm md:grid-cols-2">
          <div className="h-32 animate-pulse rounded-lg bg-surface" />
          <div className="h-32 animate-pulse rounded-lg bg-surface" />
        </div>
      </div>
      <div className="h-64 animate-pulse rounded-lg bg-surface" />
    </div>
  );
}

function TimelineEventItem({
  event,
}: {
  event: DailyOperationsSnapshot["timeline"][number];
}) {
  return (
    <article className="border-l border-border py-layout-xs pl-layout-md">
      <p className="text-xs text-muted-foreground">
        {formatEventTime(event.createdAt)}
      </p>
      <p className="mt-1 text-sm text-foreground">
        {formatTimelineMessage(event.message)}
      </p>
    </article>
  );
}

function LaneCard({
  lane,
  orgUrlSlug,
  storeUrlSlug,
}: {
  lane: DailyOperationsSnapshot["lanes"][number];
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  return (
    <article className="rounded-lg border border-border bg-surface p-layout-md shadow-surface">
      <div className="flex items-start justify-between gap-layout-sm">
        <div>
          <h3 className="font-medium text-foreground">{lane.label}</h3>
          <p className="mt-1 text-sm leading-6 text-muted-foreground">
            {lane.description}
          </p>
        </div>
        <Badge className={cn("shrink-0 border", statusClassName(lane.status))}>
          {statusLabel(lane.status)}
        </Badge>
      </div>
      <div className="mt-layout-md flex items-center justify-between border-t border-border pt-layout-sm">
        <span className="font-numeric text-xl tabular-nums text-foreground">
          {lane.countLabel ?? lane.count}
        </span>
        <Button asChild size="sm" variant="outline">
          <Link
            aria-label={`Open ${lane.label}`}
            params={buildParams(orgUrlSlug, storeUrlSlug)}
            to={lane.to}
          >
            Open
            <ArrowUpRight aria-hidden="true" className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </div>
    </article>
  );
}

export function DailyOperationsViewContent({
  currency,
  hasFullAdminAccess,
  isAuthenticated,
  isLoadingAccess,
  isLoadingSnapshot,
  orgUrlSlug,
  snapshot,
  storeUrlSlug,
}: DailyOperationsViewContentProps) {
  const [isTimelineSheetOpen, setIsTimelineSheetOpen] = useState(false);

  if (isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <LoadingWorkspace />
        </FadeIn>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before Daily Operations can load protected store-day data." />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  const previewTimeline = snapshot?.timeline.slice(0, TIMELINE_PREVIEW_LIMIT);
  const hasMoreTimelineEvents =
    (snapshot?.timeline.length ?? 0) > TIMELINE_PREVIEW_LIMIT;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Operations"
            description="Review the store day, see what needs attention, and move into the workflow that owns the next action."
          />

          {isLoadingSnapshot || !snapshot ? (
            <LoadingWorkspace />
          ) : (
            <PageWorkspace>
              <section className="space-y-layout-md">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-center lg:justify-end">
                  <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                    <div className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-sm text-sm text-muted-foreground shadow-surface">
                      Operating date{" "}
                      <span className="font-medium text-foreground">
                        {formatOperatingDate(snapshot.operatingDate)}
                      </span>
                    </div>
                    <Button
                      asChild
                      className="w-full sm:w-auto"
                      variant="outline"
                    >
                      <Link
                        params={buildParams(orgUrlSlug, storeUrlSlug)}
                        to={snapshot.primaryAction.to}
                      >
                        {snapshot.primaryAction.label}
                        <ArrowUpRight
                          aria-hidden="true"
                          className="ml-2 h-4 w-4"
                        />
                      </Link>
                    </Button>
                  </div>
                </div>

                <div className="grid gap-layout-sm md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                  <OperationsSummaryMetric
                    helper={formatEntityCount(
                      snapshot.closeSummary.transactionCount,
                      "transaction",
                    )}
                    label="Today's net sales"
                    link={{
                      ariaLabel: "Open transactions",
                      orgUrlSlug,
                      search: { o: getOrigin() },
                      storeUrlSlug,
                      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
                    }}
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.salesTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatTodayCashTransactionCount(
                      snapshot.closeSummary.currentDayCashTransactionCount,
                    )}
                    label="Today's cash"
                    link={{
                      ariaLabel: "Open cash transactions",
                      orgUrlSlug,
                      search: { o: getOrigin(), paymentMethod: "cash" },
                      storeUrlSlug,
                      to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions",
                    }}
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.currentDayCashTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatCarriedOverRegisterCount(
                      snapshot.closeSummary.carriedOverRegisterCount,
                    )}
                    label="Carried-over cash"
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.carriedOverCashTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatEntityCount(
                      snapshot.closeSummary.expenseTransactionCount,
                      "expense transaction",
                    )}
                    label="Expenses"
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.expenseTotal,
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatRegisterVarianceCount(
                      snapshot.closeSummary.registerVarianceCount,
                    )}
                    label="Variance"
                    value={formatMoney(
                      snapshot.currency ?? currency,
                      snapshot.closeSummary.netCashVariance,
                    )}
                  />
                </div>
              </section>

              <PageWorkspaceGrid>
                <PageWorkspaceMain>
                  <section className="space-y-layout-md">
                    <div>
                      <h3 className="flex items-center gap-layout-xs text-lg font-medium text-foreground">
                        <ListChecks aria-hidden="true" className="h-5 w-5" />
                        Operations lanes
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">
                        Each lane links back to the workflow that owns the work.
                      </p>
                    </div>
                    <div className="grid gap-layout-md md:grid-cols-2 xl:grid-cols-3">
                      {snapshot.lanes.map((lane) => (
                        <LaneCard
                          key={lane.key}
                          lane={lane}
                          orgUrlSlug={orgUrlSlug}
                          storeUrlSlug={storeUrlSlug}
                        />
                      ))}
                    </div>
                  </section>
                </PageWorkspaceMain>

                <PageWorkspaceRail>
                  <section
                    aria-label="Store-day timeline"
                    className="rounded-lg border border-border bg-surface p-layout-md shadow-surface"
                  >
                    <h3 className="flex items-center gap-layout-xs font-medium text-foreground">
                      <Clock3 aria-hidden="true" className="h-4 w-4" />
                      Store-day timeline
                    </h3>
                    <div className="mt-layout-md space-y-layout-md">
                      {snapshot.timeline.length === 0 ? (
                        <EmptyState
                          description="No operational events have been recorded for this store day."
                          title="No timeline yet"
                        />
                      ) : (
                        previewTimeline?.map((event) => (
                          <TimelineEventItem event={event} key={event.id} />
                        ))
                      )}
                    </div>
                    {hasMoreTimelineEvents ? (
                      <Button
                        className="mt-layout-md w-full"
                        onClick={() => setIsTimelineSheetOpen(true)}
                        size="sm"
                        type="button"
                        variant="outline"
                      >
                        Show more
                      </Button>
                    ) : null}
                  </section>
                </PageWorkspaceRail>
              </PageWorkspaceGrid>
              <Sheet
                open={isTimelineSheetOpen}
                onOpenChange={setIsTimelineSheetOpen}
              >
                <SheetContent
                  className="flex w-[min(100vw,30rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-border bg-surface-raised p-0 shadow-overlay sm:max-w-md"
                  side="right"
                >
                  <SheetHeader className="border-b border-border px-layout-lg py-layout-md">
                    <SheetTitle>Store-day timeline</SheetTitle>
                    <SheetDescription>
                      All recorded events for{" "}
                      {formatOperatingDate(snapshot.operatingDate)}.
                    </SheetDescription>
                  </SheetHeader>
                  <div className="min-h-0 flex-1 overflow-y-auto px-layout-lg py-layout-md">
                    <div className="space-y-layout-md">
                      {snapshot.timeline.map((event) => (
                        <TimelineEventItem event={event} key={event.id} />
                      ))}
                    </div>
                  </div>
                </SheetContent>
              </Sheet>
            </PageWorkspace>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function DailyOperationsApiPendingView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Operations"
            description="Daily Operations is waiting for the current store-day view."
          />
          <EmptyState
            description="Refresh this page after the operations workspace is ready."
            title="Daily Operations unavailable"
          />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function DailyOperationsConnectedView({
  getDailyOperationsSnapshot,
}: {
  getDailyOperationsSnapshot: unknown;
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
  const operatingDateRange = getLocalOperatingDateRange();
  const snapshot = useExpectedDailyOperationsQuery(
    getDailyOperationsSnapshot,
    canQueryProtectedData
      ? { ...operatingDateRange, storeId: activeStore!._id }
      : "skip",
  ) as DailyOperationsSnapshot | undefined;

  return (
    <DailyOperationsViewContent
      currency={activeStore?.currency ?? "GHS"}
      hasFullAdminAccess={hasFullAdminAccess}
      isAuthenticated={isAuthenticated}
      isLoadingAccess={isLoadingAccess}
      isLoadingSnapshot={snapshot === undefined}
      orgUrlSlug={params?.orgUrlSlug ?? ""}
      snapshot={snapshot}
      storeUrlSlug={params?.storeUrlSlug ?? ""}
    />
  );
}

export function DailyOperationsView() {
  const dailyOperationsApi = getDailyOperationsApi();

  if (!dailyOperationsApi.getDailyOperationsSnapshot) {
    return <DailyOperationsApiPendingView />;
  }

  return (
    <DailyOperationsConnectedView
      getDailyOperationsSnapshot={dailyOperationsApi.getDailyOperationsSnapshot}
    />
  );
}
