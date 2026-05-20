import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import { Activity, AlertTriangle, MonitorCheck } from "lucide-react";

import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import { PageLevelHeader, PageWorkspace } from "@/components/common/PageLevelHeader";
import { EmptyState } from "@/components/states/empty/empty-state";
import { NoPermissionView } from "@/components/states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "@/components/states/signed-out/ProtectedAdminSignInView";
import { Badge } from "@/components/ui/badge";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import {
  classifyTerminalHealth,
  formatRegisterNumber,
  formatTerminalTimestamp,
  getReviewEvidenceCount,
  getSnapshotAgeSummary,
  getStaffAuthorityLabel,
} from "./terminalHealthPresentation";
import type { TerminalHealthSummary } from "./terminalHealthTypes";

const posTerminalApi = api.inventory.posTerminal as unknown as {
  listTerminalHealth: FunctionReference<
    "query",
    "public",
    { storeId: Id<"store"> },
    TerminalHealthSummary[]
  >;
};

type POSTerminalHealthViewContentProps = {
  healthSummaries: TerminalHealthSummary[];
  isLoading: boolean;
  orgUrlSlug: string;
  queryUnavailable?: boolean;
  storeUrlSlug: string;
};

function CountMetric({
  label,
  value,
}: {
  label: string;
  value: number | string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-sm shadow-surface">
      <p className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </p>
      <p className="mt-2 font-numeric text-2xl font-semibold tabular-nums">
        {value}
      </p>
    </div>
  );
}

export function POSTerminalHealthViewContent({
  healthSummaries,
  isLoading,
  orgUrlSlug,
  queryUnavailable = false,
  storeUrlSlug,
}: POSTerminalHealthViewContentProps) {
  const healthRows = healthSummaries.map((summary) => ({
    classification: classifyTerminalHealth(summary),
    summary,
  }));
  const reviewCount = healthRows.filter(
    (row) => row.classification.label === "Needs review",
  ).length;
  const pendingCount = healthRows.filter((row) =>
    ["Pending sync", "Syncing"].includes(row.classification.label),
  ).length;
  const staleCount = healthRows.filter((row) =>
    ["No check-in", "Stale"].includes(row.classification.label),
  ).length;

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Point of sale"
            showBackButton
            title="Terminal Health"
            description="Review checkout stations, local sync state, staff authority, and support evidence before the register blocks sales."
          />

          {queryUnavailable ? (
            <div className="rounded-lg border border-warning/30 bg-warning/10 px-layout-lg py-layout-xl">
              <EmptyState
                description="Try again from POS after the terminal health query is available."
                icon={<AlertTriangle className="h-16 w-16 text-warning" />}
                title="Terminal health is not available right now"
              />
            </div>
          ) : (
            <>
              <section className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-4">
                <CountMetric label="Terminals" value={healthRows.length} />
                <CountMetric label="Pending sync" value={pendingCount} />
                <CountMetric label="Needs review" value={reviewCount} />
                <CountMetric label="Stale or missing" value={staleCount} />
              </section>

              {isLoading ? null : healthRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
                  <EmptyState
                    description="Register this checkout station from POS settings before terminal health can report."
                    icon={<MonitorCheck className="h-16 w-16 text-muted-foreground" />}
                    title="No POS terminals registered"
                  />
                </div>
              ) : (
                <section className="space-y-layout-sm">
                  {healthRows.map(({ classification, summary }) => {
                    const runtimeStatus = summary.runtimeStatus;

                    return (
                      <article
                        className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface"
                        key={summary.terminal._id}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-layout-md">
                          <div className="min-w-0 space-y-layout-xs">
                            <Link
                              className="block text-xl font-medium text-foreground underline-offset-4 hover:underline"
                              params={{
                                orgUrlSlug,
                                storeUrlSlug,
                                terminalId: String(summary.terminal._id),
                              }}
                              to="/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/$terminalId"
                            >
                              {summary.terminal.displayName}
                            </Link>
                            <div className="flex flex-wrap gap-layout-xs text-sm text-muted-foreground">
                              <span>{formatRegisterNumber(summary.terminal.registerNumber)}</span>
                              <span>Last check-in {formatTerminalTimestamp(runtimeStatus?.receivedAt)}</span>
                              <span>{getStaffAuthorityLabel(runtimeStatus?.staffAuthority)}</span>
                            </div>
                          </div>
                          <Badge className={classification.toneClassName} variant="outline">
                            {classification.label}
                          </Badge>
                        </div>

                        <div className="mt-layout-md grid gap-layout-sm md:grid-cols-2 xl:grid-cols-4">
                          <div>
                            <p className="text-xs font-medium uppercase text-muted-foreground">Sync</p>
                            <p className="mt-1 text-sm text-foreground">
                              {runtimeStatus
                                ? `${runtimeStatus.sync.pendingEventCount} pending / ${runtimeStatus.sync.reviewEventCount + getReviewEvidenceCount(summary.syncEvidence)} review`
                                : "No runtime sync check-in"}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase text-muted-foreground">Snapshot age</p>
                            <p className="mt-1 text-sm text-foreground">
                              {getSnapshotAgeSummary(runtimeStatus?.snapshots)}
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase text-muted-foreground">Active session</p>
                            <p className="mt-1 text-sm text-foreground">
                              Register session evidence is shown in cash controls
                            </p>
                          </div>
                          <div>
                            <p className="text-xs font-medium uppercase text-muted-foreground">Cloud cursor</p>
                            <p className="mt-1 text-sm text-foreground">
                              {summary.syncEvidence.acceptedThroughSequence == null
                                ? "No accepted sequence"
                                : `Accepted through ${summary.syncEvidence.acceptedThroughSequence}`}
                            </p>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </section>
              )}
            </>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export function POSTerminalHealthView() {
  const { isLoading: isLoadingUser, user } = useAuth();
  const { activeStore, isLoadingStores } = useGetActiveStore();
  const {
    canAccessPOS,
    isLoading: isLoadingPermissions,
  } = usePermissions();
  const params = useParams({ strict: false }) as
    | { orgUrlSlug?: string; storeUrlSlug?: string }
    | undefined;
  const isLoadingAccess = isLoadingUser || isLoadingStores || isLoadingPermissions;
  const canViewHealth = canAccessPOS();
  const canQuery = Boolean(activeStore?._id && user && canViewHealth);
  const healthSummaries = useQuery(
    posTerminalApi.listTerminalHealth,
    canQuery ? { storeId: activeStore!._id } : "skip",
  ) as TerminalHealthSummary[] | null | undefined;

  if (isLoadingAccess) {
    return null;
  }

  if (!user) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before POS terminal health can load." />
    );
  }

  if (!canViewHealth) {
    return <NoPermissionView />;
  }

  if (!activeStore || !params?.orgUrlSlug || !params.storeUrlSlug) {
    return (
      <View>
        <div className="container mx-auto py-8">
          <EmptyState
            description="Select a store before opening POS terminal health."
            icon={<Activity className="h-16 w-16 text-muted-foreground" />}
            title="No active store"
          />
        </div>
      </View>
    );
  }

  return (
    <POSTerminalHealthViewContent
      healthSummaries={Array.isArray(healthSummaries) ? healthSummaries : []}
      isLoading={healthSummaries === undefined}
      orgUrlSlug={params.orgUrlSlug}
      queryUnavailable={healthSummaries === null}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}

export default POSTerminalHealthView;
