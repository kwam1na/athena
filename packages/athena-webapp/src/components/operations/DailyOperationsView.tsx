import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleDashed,
  Clock3,
  ListChecks,
} from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { cn } from "@/lib/utils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
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

function ownerLabel(
  owner: DailyOperationsSnapshot["attentionItems"][number]["owner"],
) {
  if (owner === "daily_opening") return "Daily opening";
  if (owner === "daily_close") return "Daily close";
  return "Operations queue";
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

function lifecycleClassName(status: DailyOperationsLifecycleStatus) {
  if (status === "close_blocked") return "text-danger";
  if (status === "not_opened" || status === "operating") {
    return "text-warning-foreground";
  }
  return "text-success";
}

function LifecycleIcon({ status }: { status: DailyOperationsLifecycleStatus }) {
  if (status === "close_blocked") {
    return <AlertTriangle aria-hidden="true" className="h-5 w-5" />;
  }

  if (status === "closed" || status === "ready_to_close") {
    return <CheckCircle2 aria-hidden="true" className="h-5 w-5" />;
  }

  return <CircleDashed aria-hidden="true" className="h-5 w-5" />;
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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-layout-md py-layout-sm shadow-surface">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-numeric text-2xl tabular-nums text-foreground">
        {value}
      </p>
    </div>
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
  hasFullAdminAccess,
  isAuthenticated,
  isLoadingAccess,
  isLoadingSnapshot,
  orgUrlSlug,
  snapshot,
  storeUrlSlug,
}: DailyOperationsViewContentProps) {
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

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Operations"
            title="Daily Operations"
            description="Review the store day, see what needs attention, and move into the workflow that owns the next action."
          />

          {isLoadingSnapshot || !snapshot ? (
            <LoadingWorkspace />
          ) : (
            <PageWorkspace>
              <section className="space-y-layout-md">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <h2
                      className={cn(
                        "flex items-center gap-layout-xs text-2xl",
                        lifecycleClassName(snapshot.lifecycle.status),
                      )}
                    >
                      <LifecycleIcon status={snapshot.lifecycle.status} />
                      {snapshot.lifecycle.label}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {snapshot.lifecycle.description}
                    </p>
                  </div>
                  <Button asChild className="w-full sm:w-auto">
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

                <div className="grid gap-layout-sm md:grid-cols-3">
                  <Metric
                    label="Operating date"
                    value={formatOperatingDate(snapshot.operatingDate)}
                  />
                  <Metric
                    label="Needs attention"
                    value={snapshot.attentionItems.length}
                  />
                  <Metric label="Timeline" value={snapshot.timeline.length} />
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
                    aria-label="Operator attention"
                    className="rounded-lg border border-border bg-surface p-layout-md shadow-surface"
                  >
                    <div className="flex items-center justify-between gap-layout-sm">
                      <h3 className="font-medium text-foreground">
                        Operator attention
                      </h3>
                      <Badge variant="outline">
                        {snapshot.attentionItems.length}
                      </Badge>
                    </div>
                    <div className="mt-layout-md space-y-layout-sm">
                      {snapshot.attentionItems.length === 0 ? (
                        <EmptyState
                          description="No source workflow needs immediate attention."
                          title="No attention items"
                        />
                      ) : (
                        snapshot.attentionItems.map((item) => (
                          <article
                            className="rounded-lg border border-border/80 bg-background p-layout-sm"
                            key={item.id}
                          >
                            <div className="flex items-start justify-between gap-layout-sm">
                              <div>
                                <p className="font-medium text-foreground">
                                  {item.label}
                                </p>
                                <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                  {item.message}
                                </p>
                              </div>
                              <Badge
                                className={cn(
                                  "border",
                                  item.severity === "critical"
                                    ? "border-danger/30 bg-danger/10 text-danger"
                                    : "border-warning/40 bg-warning/10 text-warning-foreground",
                                )}
                              >
                                {ownerLabel(item.owner)}
                              </Badge>
                            </div>
                            {item.to ? (
                              <Button
                                asChild
                                className="mt-layout-sm"
                                size="sm"
                                variant="outline"
                              >
                                <Link
                                  aria-label={`Open source for ${item.label}`}
                                  params={buildParams(
                                    orgUrlSlug,
                                    storeUrlSlug,
                                    item.params,
                                  )}
                                  search={item.search}
                                  to={item.to}
                                >
                                  Open source
                                </Link>
                              </Button>
                            ) : null}
                          </article>
                        ))
                      )}
                    </div>
                  </section>

                  <section className="rounded-lg border border-border bg-surface p-layout-md shadow-surface">
                    <h3 className="flex items-center gap-layout-xs font-medium text-foreground">
                      <Clock3 aria-hidden="true" className="h-4 w-4" />
                      Store-day timeline
                    </h3>
                    <div className="mt-layout-md space-y-layout-sm">
                      {snapshot.timeline.length === 0 ? (
                        <EmptyState
                          description="No operational events have been recorded for this store day."
                          title="No timeline yet"
                        />
                      ) : (
                        snapshot.timeline.map((event) => (
                          <article
                            className="border-l border-border pl-layout-sm"
                            key={event.id}
                          >
                            <p className="text-xs text-muted-foreground">
                              {formatEventTime(event.createdAt)}
                            </p>
                            <p className="mt-1 text-sm text-foreground">
                              {event.message}
                            </p>
                          </article>
                        ))
                      )}
                    </div>
                  </section>
                </PageWorkspaceRail>
              </PageWorkspaceGrid>
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
            eyebrow="Operations"
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
