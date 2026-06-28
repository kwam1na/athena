import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import type { FunctionReference } from "convex/server";
import type { ReactNode } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  CircleAlert,
  CircleHelp,
  Clock3,
  MonitorCheck,
} from "lucide-react";

import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
} from "@/components/common/PageLevelHeader";
import { EmptyState } from "@/components/states/empty/empty-state";
import { NoPermissionView } from "@/components/states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "@/components/states/signed-out/ProtectedAdminSignInView";
import { Badge } from "@/components/ui/badge";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useAuth } from "@/hooks/useAuth";
import { usePermissions } from "@/hooks/usePermissions";
import { useLocalPosEntryContext } from "@/lib/pos/infrastructure/local/localPosEntryContext";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import {
  buildPosOfflineReadinessSummary,
  type PosOfflineReadinessSignal,
  type PosOfflineReadinessSummary,
} from "@/offline/posOfflineReadiness";
import {
  buildTerminalOperationalExplanationPresentation,
  buildTerminalRecoveryPresentation,
  classifyTerminalHealth,
  formatAge,
  formatRegisterNumber,
  formatTerminalTimestamp,
  getReviewEvidenceCount,
  getStaffAuthorityLabel,
  getPrimaryTerminalAttentionReason,
} from "./terminalHealthPresentation";
import type {
  TerminalHealthSummary,
  TerminalRuntimeStatus,
} from "./terminalHealthTypes";
import { getOrigin } from "~/src/lib/navigationUtils";

const posTerminalApi = api.inventory.posTerminal as unknown as {
  listTerminalHealth: FunctionReference<
    "query",
    "public",
    { storeId: Id<"store"> },
    TerminalHealthSummary[]
  >;
};

type POSTerminalHealthViewContentProps = {
  currentBrowserTerminalIds?: readonly string[];
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

function OfflineReadinessDiagnostic({
  readiness,
}: {
  readiness: PosOfflineReadinessSummary;
}) {
  const signalsNeedingAttention = readiness.signals.filter(
    (signal) => signal.status === "needs_attention",
  );
  const unknownSignals = readiness.signals.filter(
    (signal) => signal.status === "unknown",
  );
  const readySignals = readiness.signals.filter((signal) =>
    ["local_continuation", "ready"].includes(signal.status),
  );

  return (
    <div className="mt-layout-md border-t border-border pt-layout-md">
      <div className="flex flex-wrap items-start justify-between gap-layout-sm">
        <div>
          <p className="text-sm font-medium text-foreground">
            {readiness.title}
          </p>
          <p className="mt-layout-2xs text-sm text-muted-foreground">
            {readiness.description}
          </p>
        </div>
        <span className="inline-flex rounded-full border border-border px-layout-sm py-layout-2xs text-sm text-muted-foreground">
          {readiness.readyCount} of {readiness.signals.length} ready
        </span>
      </div>

      {signalsNeedingAttention.length > 0 ? (
        <ReadinessSignalList
          className="mt-layout-md"
          signals={signalsNeedingAttention}
        />
      ) : null}
      {unknownSignals.length > 0 ? (
        <ReadinessSignalList
          className={
            signalsNeedingAttention.length > 0 ? "mt-layout-sm" : "mt-layout-md"
          }
          signals={unknownSignals}
        />
      ) : null}
      {readySignals.length > 0 ? (
        <ReadySignalSummary
          className={
            signalsNeedingAttention.length > 0 || unknownSignals.length > 0
              ? "mt-layout-sm"
              : "mt-layout-md"
          }
          signals={readySignals}
        />
      ) : null}
    </div>
  );
}

function ReadySignalSummary({
  className,
  signals,
}: {
  className?: string;
  signals: PosOfflineReadinessSignal[];
}) {
  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-layout-sm gap-y-layout-2xs text-sm text-muted-foreground",
        className,
      )}
    >
      <span className="inline-flex items-center gap-layout-xs font-medium text-foreground">
        <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-success" />
        Ready signals
      </span>
      <span>{signals.map((signal) => signal.label).join(", ")}</span>
    </div>
  );
}

function ReadinessSignalList({
  className,
  signals,
}: {
  className?: string;
  signals: PosOfflineReadinessSignal[];
}) {
  return (
    <dl className={cn("divide-y divide-border", className)}>
      {signals.map((signal) => (
        <div
          className="grid gap-layout-xs py-layout-xs text-sm md:grid-cols-[11rem_minmax(0,1fr)]"
          key={signal.domain}
        >
          <dt className="flex items-center gap-layout-xs font-medium text-foreground">
            <ReadinessSignalIcon signal={signal} />
            <span>{signal.label}</span>
          </dt>
          <dd className="text-muted-foreground md:text-right">
            {signal.description}
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ReadinessSignalIcon({
  signal,
}: {
  signal: PosOfflineReadinessSignal;
}) {
  if (signal.status === "ready" || signal.status === "local_continuation") {
    return (
      <CheckCircle2 aria-hidden="true" className="h-3.5 w-3.5 text-success" />
    );
  }

  if (signal.status === "needs_attention") {
    return (
      <CircleAlert aria-hidden="true" className="h-3.5 w-3.5 text-warning" />
    );
  }

  return (
    <CircleHelp
      aria-hidden="true"
      className="h-3.5 w-3.5 text-muted-foreground"
    />
  );
}

function TerminalFact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-foreground">{value}</dd>
    </div>
  );
}

function RegisterSessionFactValue({
  orgUrlSlug,
  registerSessionLink,
  runtimeStatus,
  storeUrlSlug,
}: {
  orgUrlSlug: string;
  registerSessionLink?: TerminalHealthSummary["registerSessionLink"];
  runtimeStatus?: TerminalRuntimeStatus | null;
  storeUrlSlug: string;
}) {
  const isLocalContinuation =
    runtimeStatus?.appSessionRecovery?.status === "waiting_for_network";
  const label = isLocalContinuation
    ? "Local sale continuation"
    : registerSessionLink
      ? "Active in cash controls"
      : "No active session";
  const registerSessionId = registerSessionLink?.registerSessionId;

  if (!registerSessionId || isLocalContinuation) {
    return <>{label}</>;
  }

  return (
    <Link
      className="inline-flex items-center gap-layout-xs font-medium text-foreground underline-offset-4 hover:underline"
      params={{
        orgUrlSlug,
        sessionId: String(registerSessionId),
        storeUrlSlug,
      }}
      search={{ o: getOrigin() }}
      to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId"
    >
      {label}
      <ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
    </Link>
  );
}

function LocalDataFreshness({
  snapshots,
}: {
  snapshots?: TerminalRuntimeStatus["snapshots"] | null;
}) {
  const rows = getLocalDataFreshnessRows(snapshots);

  return (
    <div className="space-y-layout-2xs">
      {rows.map((row) => (
        <div
          className="flex flex-wrap items-baseline gap-x-layout-xs"
          key={row.label}
        >
          <span className="text-foreground">{row.label}</span>
          <span className="text-muted-foreground">{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function getLocalDataFreshnessRows(
  snapshots?: TerminalRuntimeStatus["snapshots"] | null,
) {
  if (!snapshots) {
    return [{ label: "Offline checkout", value: "Not reported" }];
  }

  const sellingDataAges = [
    snapshots.availabilityAgeMs,
    snapshots.catalogAgeMs,
    snapshots.serviceCatalogAgeMs,
  ].filter(
    (age): age is number => typeof age === "number" && Number.isFinite(age),
  );
  const rows: Array<{ label: string; value: string }> = [];

  if (sellingDataAges.length > 0) {
    rows.push({
      label: "Products and stock",
      value: formatAge(Math.max(...sellingDataAges)),
    });
  }

  if (
    typeof snapshots.registerReadModelAgeMs === "number" &&
    Number.isFinite(snapshots.registerReadModelAgeMs)
  ) {
    rows.push({
      label: "Register details",
      value: formatAge(snapshots.registerReadModelAgeMs),
    });
  }

  return rows.length > 0
    ? rows
    : [{ label: "Offline checkout", value: "Not reported" }];
}

function buildTerminalOfflineReadiness(
  summary: TerminalHealthSummary,
): PosOfflineReadinessSummary {
  const runtimeStatus = summary.runtimeStatus;
  const snapshots = runtimeStatus?.snapshots;
  const appSessionRecovery = runtimeStatus?.appSessionRecovery?.status;

  return buildPosOfflineReadinessSummary({
    appSession: appSessionRecovery
      ? getAppSessionReadinessInput(appSessionRecovery)
      : null,
    appShell: runtimeStatus?.appShell
      ? { ready: runtimeStatus.appShell.ready }
      : null,
    terminalSeed: runtimeStatus
      ? { ready: runtimeStatus.localStore.terminalSeedReady }
      : null,
    staffAuthority: runtimeStatus
      ? { ready: runtimeStatus.staffAuthority.status === "ready" }
      : null,
    registerCatalog:
      snapshots?.catalogAgeMs !== undefined
        ? { ageMs: snapshots.catalogAgeMs, ready: true }
        : null,
    serviceCatalog:
      snapshots?.serviceCatalogAgeMs !== undefined
        ? { ageMs: snapshots.serviceCatalogAgeMs, ready: true }
        : null,
    availabilitySnapshot:
      snapshots?.availabilityAgeMs !== undefined
        ? { ageMs: snapshots.availabilityAgeMs, ready: true }
        : null,
  });
}

function getAppSessionReadinessInput(status: string) {
  if (status === "waiting_for_network") {
    return { status: "local_continuation" as const };
  }

  if (status === "ready") {
    return { ready: true };
  }

  return { ready: false };
}

function getCurrentBrowserTerminalIds(
  terminalSeed:
    | { cloudTerminalId?: string | null; terminalId?: string | null }
    | null
    | undefined,
) {
  return Array.from(
    new Set(
      [terminalSeed?.cloudTerminalId, terminalSeed?.terminalId].filter(
        (terminalId): terminalId is string => Boolean(terminalId),
      ),
    ),
  );
}

export function POSTerminalHealthViewContent({
  currentBrowserTerminalIds = [],
  healthSummaries,
  isLoading,
  orgUrlSlug,
  queryUnavailable = false,
  storeUrlSlug,
}: POSTerminalHealthViewContentProps) {
  const currentBrowserTerminalIdSet = new Set(currentBrowserTerminalIds);
  const healthRows = healthSummaries
    .map((summary, index) => ({
      classification: classifyTerminalHealth(summary),
      isCurrentBrowserTerminal: isCurrentBrowserTerminalSummary(
        summary,
        currentBrowserTerminalIdSet,
      ),
      operationalExplanation:
        buildTerminalOperationalExplanationPresentation(summary),
      originalIndex: index,
      summary,
    }))
    .sort((left, right) => {
      if (left.isCurrentBrowserTerminal !== right.isCurrentBrowserTerminal) {
        return left.isCurrentBrowserTerminal ? -1 : 1;
      }
      return left.originalIndex - right.originalIndex;
    });
  const reviewCount = healthRows.filter(
    (row) =>
      row.classification.label === "Needs review" ||
      row.operationalExplanation.lane === "sale_ready_with_review_backlog" ||
      row.operationalExplanation.lane === "needs_manual_review",
  ).length;
  const healthyCount = healthRows.filter(
    (row) => row.classification.label === "Healthy",
  ).length;
  const pendingCount = healthRows.filter((row) =>
    ["Pending sync", "Syncing"].includes(row.classification.label),
  ).length;
  const staleCount = healthRows.filter((row) =>
    ["No check-in", "Stale"].includes(row.classification.label),
  ).length;
  const loadingMetricValue = isLoading ? "-" : null;

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
              <section className="grid gap-layout-sm sm:grid-cols-2 xl:grid-cols-5">
                <CountMetric
                  label="Terminals"
                  value={loadingMetricValue ?? healthRows.length}
                />
                <CountMetric
                  label="Healthy"
                  value={loadingMetricValue ?? healthyCount}
                />
                <CountMetric
                  label="Pending sync"
                  value={loadingMetricValue ?? pendingCount}
                />
                <CountMetric
                  label="Needs review"
                  value={loadingMetricValue ?? reviewCount}
                />
                <CountMetric
                  label="Stale or missing"
                  value={loadingMetricValue ?? staleCount}
                />
              </section>

              {isLoading ? null : healthRows.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border bg-surface-raised px-layout-lg py-layout-xl">
                  <EmptyState
                    description="Register this checkout station from POS settings before terminal health can report."
                    icon={
                      <MonitorCheck className="h-16 w-16 text-muted-foreground" />
                    }
                    title="No POS terminals registered"
                  />
                </div>
              ) : (
                <section className="space-y-layout-sm">
                  {healthRows.map(
                    ({
                      classification,
                      isCurrentBrowserTerminal,
                      operationalExplanation,
                      summary,
                    }) => {
                      const runtimeStatus = summary.runtimeStatus;
                      const primaryReason =
                        getPrimaryTerminalAttentionReason(summary);
                      const offlineReadiness =
                        buildTerminalOfflineReadiness(summary);
                      const recovery =
                        buildTerminalRecoveryPresentation(summary);
                      const syncReviewCount =
                        (runtimeStatus?.sync.reviewEventCount ?? 0) +
                        getReviewEvidenceCount(summary.syncEvidence);
                      const syncSummary = runtimeStatus
                        ? `${runtimeStatus.sync.pendingEventCount} pending / ${syncReviewCount} review`
                        : "No runtime sync check-in";
                      const cloudCursorSummary =
                        summary.syncEvidence.acceptedThroughSequence == null
                          ? "No accepted sequence"
                          : `Accepted through ${summary.syncEvidence.acceptedThroughSequence}`;
                      const operationalNote =
                        classification.label === "Healthy"
                          ? null
                          : (primaryReason?.summary ??
                            classification.description);
                      return (
                        <article
                          className={cn(
                            "rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface",
                            isCurrentBrowserTerminal
                              ? "bg-action-workflow-soft/10"
                              : null,
                          )}
                          key={summary.terminal._id}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-layout-md">
                            <div className="min-w-0 space-y-layout-xs">
                              <div className="flex flex-wrap items-center gap-layout-xs">
                                <Link
                                  className="min-w-0 text-xl font-medium text-foreground underline-offset-4 hover:underline"
                                  params={{
                                    orgUrlSlug,
                                    storeUrlSlug,
                                    terminalId: String(summary.terminal._id),
                                  }}
                                  to="/$orgUrlSlug/store/$storeUrlSlug/pos/terminals/$terminalId"
                                  search={{ o: getOrigin() }}
                                >
                                  {summary.terminal.displayName}
                                </Link>
                                {isCurrentBrowserTerminal ? (
                                  <Badge
                                    className="inline-flex shrink-0 items-center gap-layout-xs border-action-workflow-border text-action-workflow"
                                    variant="outline"
                                  >
                                    <MonitorCheck
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5"
                                    />
                                    This browser
                                  </Badge>
                                ) : null}
                              </div>
                              <div className="flex flex-wrap gap-layout-xs text-sm text-muted-foreground">
                                <span>
                                  {formatRegisterNumber(
                                    summary.terminal.registerNumber,
                                  )}
                                </span>
                                <span>
                                  {getStaffAuthorityLabel(
                                    runtimeStatus?.staffAuthority,
                                  )}
                                </span>
                              </div>
                            </div>
                            <Badge
                              className={
                                summary.operationalExplanation
                                  ? operationalExplanation.toneClassName
                                  : classification.toneClassName
                              }
                              variant="outline"
                            >
                              {summary.operationalExplanation
                                ? operationalExplanation.label
                                : classification.label}
                            </Badge>
                          </div>

                          <div className="mt-layout-md grid gap-layout-md border-t border-border pt-layout-md lg:grid-cols-[minmax(0,1.2fr)_minmax(26rem,0.8fr)]">
                            <div>
                              <p className="text-xs font-medium uppercase text-muted-foreground">
                                Sales readiness
                              </p>
                              {summary.operationalExplanation ? (
                                <>
                                  <p className="mt-1 text-base font-medium text-foreground">
                                    {operationalExplanation.headline}
                                  </p>
                                  <p className="mt-layout-2xs text-sm text-muted-foreground">
                                    {operationalExplanation.detail}
                                  </p>
                                  <p className="mt-layout-sm text-sm text-foreground">
                                    {operationalExplanation.saleImpactLabel}
                                  </p>
                                  {operationalExplanation.supportAction !==
                                  "none" ? (
                                    <p className="mt-layout-sm text-sm text-foreground">
                                      <span className="font-medium">
                                        Next step:
                                      </span>{" "}
                                      {operationalExplanation.nextStep}
                                    </p>
                                  ) : null}
                                </>
                              ) : (
                                <>
                                  <p className="mt-1 text-base font-medium text-foreground">
                                    {recovery.readiness.label}
                                  </p>
                                  <p className="mt-layout-2xs text-sm text-muted-foreground">
                                    {recovery.readiness.description}
                                  </p>
                                  {operationalNote ? (
                                    <p className="mt-layout-sm text-sm text-foreground">
                                      {operationalNote}
                                    </p>
                                  ) : null}
                                </>
                              )}
                            </div>

                            <dl className="grid gap-x-layout-lg gap-y-layout-sm sm:grid-cols-2">
                              <TerminalFact
                                label="Last check-in"
                                value={
                                  <span className="inline-flex items-center gap-layout-xs">
                                    <Clock3
                                      aria-hidden="true"
                                      className="h-3.5 w-3.5 text-muted-foreground"
                                    />
                                    {formatTerminalTimestamp(
                                      runtimeStatus?.receivedAt,
                                    )}
                                  </span>
                                }
                              />
                              <TerminalFact label="Sync" value={syncSummary} />
                              <TerminalFact
                                label="Offline checkout"
                                value={
                                  <LocalDataFreshness
                                    snapshots={runtimeStatus?.snapshots}
                                  />
                                }
                              />
                              <TerminalFact
                                label="Register session"
                                value={
                                  <RegisterSessionFactValue
                                    orgUrlSlug={orgUrlSlug}
                                    registerSessionLink={
                                      summary.registerSessionLink
                                    }
                                    runtimeStatus={runtimeStatus}
                                    storeUrlSlug={storeUrlSlug}
                                  />
                                }
                              />
                              <TerminalFact
                                label="App update"
                                value={recovery.appUpdate.label}
                              />
                              <TerminalFact
                                label="Cloud cursor"
                                value={cloudCursorSummary}
                              />
                            </dl>
                          </div>

                          <OfflineReadinessDiagnostic
                            readiness={offlineReadiness}
                          />
                        </article>
                      );
                    },
                  )}
                </section>
              )}
            </>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function isCurrentBrowserTerminalSummary(
  summary: TerminalHealthSummary,
  currentBrowserTerminalIdSet: Set<string>,
) {
  if (currentBrowserTerminalIdSet.has(String(summary.terminal._id))) {
    return true;
  }

  const runtimeTerminalId = summary.runtimeStatus?.terminalId;
  return runtimeTerminalId
    ? currentBrowserTerminalIdSet.has(String(runtimeTerminalId))
    : false;
}

export function POSTerminalHealthView() {
  const { isLoading: isLoadingUser, user } = useAuth();
  const { activeStore, isLoadingStores } = useGetActiveStore();
  const { canAccessPOS, isLoading: isLoadingPermissions } = usePermissions();
  const params = useParams({ strict: false }) as
    | { orgUrlSlug?: string; storeUrlSlug?: string }
    | undefined;
  const isLoadingAccess =
    isLoadingUser || isLoadingStores || isLoadingPermissions;
  const canViewHealth = canAccessPOS();
  const canQuery = Boolean(activeStore?._id && user && canViewHealth);
  const healthSummaries = useQuery(
    posTerminalApi.listTerminalHealth,
    canQuery ? { storeId: activeStore!._id } : "skip",
  ) as TerminalHealthSummary[] | null | undefined;
  const localPosEntryContext = useLocalPosEntryContext({
    activeStore,
    routeParams: params,
  });

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
      currentBrowserTerminalIds={
        localPosEntryContext.status === "ready"
          ? getCurrentBrowserTerminalIds(localPosEntryContext.terminalSeed)
          : []
      }
      isLoading={healthSummaries === undefined}
      orgUrlSlug={params.orgUrlSlug}
      queryUnavailable={healthSummaries === null}
      storeUrlSlug={params.storeUrlSlug}
    />
  );
}

export default POSTerminalHealthView;
