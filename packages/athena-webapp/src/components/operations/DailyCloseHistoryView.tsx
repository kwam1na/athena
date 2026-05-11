import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQuery } from "convex/react";
import { ArrowUpRight, History } from "lucide-react";

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
import {
  DailyCloseReadOnlyReport,
  formatDailyCloseCompletedAt,
  formatDailyCloseMoney,
  formatDailyCloseOperatingDate,
  type DailyCloseSnapshot,
} from "./DailyCloseView";

type DailyCloseHistoryApi = {
  getCompletedDailyCloseHistoryDetail?: unknown;
  listCompletedDailyCloseHistory?: unknown;
};

const useExpectedDailyCloseHistoryQuery = useQuery as unknown as (
  query: unknown,
  args: unknown,
) => unknown;

export type DailyCloseHistoryRecord = {
  _id?: Id<"dailyClose"> | string;
  blockerCount?: number;
  carryForwardCount?: number;
  dailyCloseId?: Id<"dailyClose"> | string;
  completedAt?: number | null;
  completedByStaffName?: string | null;
  completedClose?: DailyCloseSnapshot["completedClose"];
  id?: string;
  operatingDate: string;
  readyCount?: number;
  readiness?: DailyCloseSnapshot["readiness"];
  readinessStatus?: DailyCloseSnapshot["readiness"] extends { status: infer Status }
    ? Status
    : string;
  reopenedAt?: number | null;
  reopenReason?: string | null;
  reportSnapshot?: DailyCloseStoredSnapshot | DailyCloseSnapshot | null;
  supersededByDailyCloseId?: Id<"dailyClose"> | string | null;
  reviewCount?: number;
  status?: string;
  summary?: DailyCloseSnapshot["summary"];
};

type DailyCloseStoredSnapshot = {
  closeMetadata?: {
    completedAt?: number | null;
    completedByStaffName?: string | null;
    notes?: string | null;
    operatingDate: string;
    startAt: number;
    endAt: number;
  };
  carryForwardItems?: DailyCloseSnapshot["carryForwardItems"];
  readyItems?: DailyCloseSnapshot["readyItems"];
  readiness?: DailyCloseSnapshot["readiness"];
  reviewedItems?: DailyCloseSnapshot["reviewItems"];
  reviewItems?: DailyCloseSnapshot["reviewItems"];
  sourceSubjects?: unknown[];
  status?: DailyCloseSnapshot["status"];
  summary?: DailyCloseSnapshot["summary"];
};

type DailyCloseHistoryQueryResult =
  | DailyCloseHistoryRecord[]
  | {
      records?: DailyCloseHistoryRecord[];
    };

type DailyCloseHistoryDetailResult =
  | DailyCloseHistoryRecord
  | {
      record?: DailyCloseHistoryRecord | null;
      reportSnapshot?: DailyCloseStoredSnapshot | DailyCloseSnapshot | null;
    }
  | null;

function getDailyCloseHistoryApi(): DailyCloseHistoryApi {
  return (
    (
      api.operations as typeof api.operations & {
        dailyClose?: DailyCloseHistoryApi;
      }
    ).dailyClose ?? {}
  );
}

function getHistoryRecords(result: unknown): DailyCloseHistoryRecord[] {
  if (Array.isArray(result)) return result as DailyCloseHistoryRecord[];

  if (result && typeof result === "object" && "records" in result) {
    const records = (result as { records?: DailyCloseHistoryRecord[] }).records;
    return Array.isArray(records) ? records : [];
  }

  return [];
}

function getHistoryRecordId(record: DailyCloseHistoryRecord) {
  return String(
    record.dailyCloseId ?? record._id ?? record.id ?? record.operatingDate,
  );
}

function isCompletedHistoryRecord(record: DailyCloseHistoryRecord) {
  if (record.status) return record.status === "completed";

  return Boolean(record.completedAt ?? record.completedClose);
}

function getHistoryRecordCompletedAt(record: DailyCloseHistoryRecord) {
  return record.completedAt ?? record.completedClose?.completedAt ?? null;
}

function getHistoryRecordCompletedBy(record: DailyCloseHistoryRecord) {
  return (
    record.completedByStaffName ??
    record.completedClose?.completedByStaffName ??
    "Staff unavailable"
  );
}

function getHistoryRecordSummary(record: DailyCloseHistoryRecord) {
  return record.summary ?? record.reportSnapshot?.summary;
}

function getHistoryLifecycleLabel(record: DailyCloseHistoryRecord) {
  if (record.status === "superseded" || record.supersededByDailyCloseId) {
    return "Superseded";
  }

  if (record.reopenedAt || record.reopenReason) {
    return "Reopened";
  }

  return "Completed";
}

function normalizeHistorySnapshot(
  snapshot: DailyCloseStoredSnapshot | DailyCloseSnapshot | null | undefined,
): DailyCloseSnapshot | null {
  if (!snapshot) return null;

  if ("operatingDate" in snapshot && snapshot.operatingDate) {
    return snapshot as DailyCloseSnapshot;
  }

  const storedSnapshot = snapshot as DailyCloseStoredSnapshot;

  if (!storedSnapshot.closeMetadata) return null;

  return {
    blockers: [],
    carryForwardItems: storedSnapshot.carryForwardItems ?? [],
    completedClose: {
      completedAt: storedSnapshot.closeMetadata.completedAt,
      completedByStaffName: storedSnapshot.closeMetadata.completedByStaffName,
      notes: storedSnapshot.closeMetadata.notes,
    },
    endAt: storedSnapshot.closeMetadata.endAt,
    operatingDate: storedSnapshot.closeMetadata.operatingDate,
    readyItems: storedSnapshot.readyItems ?? [],
    readiness: storedSnapshot.readiness,
    reviewItems: storedSnapshot.reviewedItems ?? storedSnapshot.reviewItems ?? [],
    startAt: storedSnapshot.closeMetadata.startAt,
    status: "completed",
    summary: storedSnapshot.summary ?? {},
  } as DailyCloseSnapshot;
}

function getHistoryRecordSnapshot(
  detail: DailyCloseHistoryDetailResult | undefined,
  fallbackRecord?: DailyCloseHistoryRecord,
) {
  if (detail && "reportSnapshot" in detail && detail.reportSnapshot) {
    return normalizeHistorySnapshot(detail.reportSnapshot);
  }

  const detailRecord =
    detail && "record" in detail && detail.record ? detail.record : detail;

  if (detailRecord && "reportSnapshot" in detailRecord && detailRecord.reportSnapshot) {
    return normalizeHistorySnapshot(detailRecord.reportSnapshot);
  }

  return normalizeHistorySnapshot(fallbackRecord?.reportSnapshot);
}

function formatCount(value: number | null | undefined, singular: string) {
  if (!value) return `No ${singular}s`;
  if (value === 1) return `1 ${singular}`;
  return `${value} ${singular}s`;
}

function sortNewestFirst(
  left: DailyCloseHistoryRecord,
  right: DailyCloseHistoryRecord,
) {
  return right.operatingDate.localeCompare(left.operatingDate);
}

function DailyCloseHistoryApiPendingView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Close History"
            description="Daily Close history is waiting for the server completed-history list and detail queries."
          />
          <EmptyState
            description="The frontend is wired to api.operations.dailyClose.listCompletedDailyCloseHistory and getCompletedDailyCloseHistoryDetail."
            title="Daily Close history server API pending"
          />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

export function DailyCloseHistoryView() {
  const dailyCloseApi = getDailyCloseHistoryApi();

  if (
    !dailyCloseApi.listCompletedDailyCloseHistory ||
    !dailyCloseApi.getCompletedDailyCloseHistoryDetail
  ) {
    return <DailyCloseHistoryApiPendingView />;
  }

  return (
    <DailyCloseHistoryConnectedView
      getCompletedDailyCloseHistoryDetail={
        dailyCloseApi.getCompletedDailyCloseHistoryDetail
      }
      listCompletedDailyCloseHistory={dailyCloseApi.listCompletedDailyCloseHistory}
    />
  );
}

function DailyCloseHistoryConnectedView({
  getCompletedDailyCloseHistoryDetail,
  listCompletedDailyCloseHistory,
}: {
  getCompletedDailyCloseHistoryDetail: unknown;
  listCompletedDailyCloseHistory: unknown;
}) {
  const {
    activeStore,
    canAccessProtectedSurface,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "store_day" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false }) as {
    orgUrlSlug: string;
    storeUrlSlug: string;
  };
  const [selectedRecordId, setSelectedRecordId] = useState<string | null>(null);
  const historyResult = useExpectedDailyCloseHistoryQuery(
    listCompletedDailyCloseHistory,
    canQueryProtectedData && activeStore?._id
      ? { storeId: activeStore._id }
      : "skip",
  ) as DailyCloseHistoryQueryResult | undefined;
  const completedRecords = useMemo(
    () => getHistoryRecords(historyResult).filter(isCompletedHistoryRecord).sort(sortNewestFirst),
    [historyResult],
  );
  const selectedRecord =
    completedRecords.find((record) => getHistoryRecordId(record) === selectedRecordId) ??
    completedRecords[0];
  const selectedDailyCloseId = selectedRecord ? getHistoryRecordId(selectedRecord) : null;
  const detailResult = useExpectedDailyCloseHistoryQuery(
    getCompletedDailyCloseHistoryDetail,
    canQueryProtectedData && activeStore?._id && selectedDailyCloseId
      ? {
          dailyCloseId: selectedDailyCloseId,
          storeId: activeStore._id,
        }
      : "skip",
  ) as DailyCloseHistoryDetailResult | undefined;
  const selectedSnapshot = getHistoryRecordSnapshot(detailResult, selectedRecord);
  const currency = activeStore?.currency ?? "GHS";

  useEffect(() => {
    if (!selectedRecordId && selectedRecord) {
      setSelectedRecordId(getHistoryRecordId(selectedRecord));
    }
  }, [selectedRecord, selectedRecordId]);

  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before Daily Close history can load protected completed close records" />
    );
  }

  if (!canAccessSurface) {
    return <NoPermissionView />;
  }

  if (!activeStore?._id) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening Daily Close history."
          title="No active store"
        />
      </div>
    );
  }

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="Daily Close History"
            description="Review completed EOD Reviews as read-only store-day records."
          />

          {completedRecords.length === 0 ? (
            <EmptyState
              description="Completed EOD Reviews will appear here after store days are closed."
              title="No completed Daily Close records"
            />
          ) : (
            <PageWorkspaceGrid className="xl:grid-cols-[minmax(17rem,0.35fr)_minmax(0,1fr)]">
              <PageWorkspaceRail>
                <section
                  aria-label="Completed Daily Close records"
                  className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface"
                >
                  <div className="border-b border-border p-layout-md">
                    <div className="flex items-center gap-layout-sm">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md bg-success/10 text-success">
                        <History aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <div>
                        <h2 className="text-sm font-semibold text-foreground">
                          Completed records
                        </h2>
                        <p className="text-sm leading-6 text-muted-foreground">
                          Completed closes only
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="divide-y divide-border">
                    {completedRecords.map((record) => {
                      const recordId = getHistoryRecordId(record);
                      const summary = getHistoryRecordSummary(record);
                      const isSelected = selectedDailyCloseId === recordId;

                      return (
                        <button
                          aria-pressed={isSelected}
                          className={cn(
                            "w-full px-layout-md py-layout-lg text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                            isSelected && "bg-muted/25",
                          )}
                          key={recordId}
                          onClick={() => setSelectedRecordId(recordId)}
                          type="button"
                        >
                          <div className="flex items-start justify-between gap-layout-sm">
                            <div className="min-w-0">
                              <p className="font-medium text-foreground">
                                {formatDailyCloseOperatingDate(record.operatingDate)}
                              </p>
                              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                                {formatDailyCloseCompletedAt(
                                  getHistoryRecordCompletedAt(record),
                                )}
                              </p>
                            </div>
                            <Badge className="border-border bg-transparent text-muted-foreground">
                              {getHistoryLifecycleLabel(record)}
                            </Badge>
                          </div>

                          <dl className="mt-layout-lg grid grid-cols-2 gap-layout-md text-sm">
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Sales
                              </dt>
                              <dd className="font-numeric font-medium tabular-nums text-foreground">
                                {formatDailyCloseMoney(
                                  currency,
                                  summary?.totalSales ?? summary?.salesTotal,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Variance
                              </dt>
                              <dd className="font-numeric font-medium tabular-nums text-foreground">
                                {formatDailyCloseMoney(
                                  currency,
                                  summary?.varianceTotal ??
                                    summary?.netCashVariance,
                                )}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Expenses
                              </dt>
                              <dd className="font-numeric font-medium tabular-nums text-foreground">
                                {formatDailyCloseMoney(currency, summary?.expenseTotal)}
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Follow-ups
                              </dt>
                              <dd className="font-medium text-foreground">
                                {formatCount(
                                  record.carryForwardCount ??
                                    record.readiness?.carryForwardCount ??
                                    summary?.carryForwardCount,
                                  "item",
                                )}
                              </dd>
                            </div>
                          </dl>
                        </button>
                      );
                    })}
                  </div>
                </section>

                <Button asChild variant="outline">
                  <Link
                    params={{ orgUrlSlug, storeUrlSlug } as never}
                    to="/$orgUrlSlug/store/$storeUrlSlug/operations/daily-close"
                  >
                    <ArrowUpRight aria-hidden="true" />
                    Current EOD Review
                  </Link>
                </Button>
              </PageWorkspaceRail>

              <PageWorkspaceMain>
                {selectedRecord && selectedSnapshot ? (
                  <section
                    aria-label="Historical Daily Close detail"
                    className="space-y-layout-lg"
                  >
                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
                      <div className="flex flex-col gap-layout-md md:flex-row md:items-start md:justify-between">
                        <div className="space-y-layout-xs">
                          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                            Historical close
                          </p>
                          <h2 className="text-xl font-medium text-foreground">
                            {formatDailyCloseOperatingDate(
                              selectedSnapshot.operatingDate,
                            )}
                          </h2>
                          <p className="text-sm leading-6 text-muted-foreground">
                            Completed by {selectedSnapshot.completedClose?.completedByStaffName ??
                              getHistoryRecordCompletedBy(selectedRecord)}.
                            {" "}
                            {formatDailyCloseCompletedAt(
                              getHistoryRecordCompletedAt(selectedRecord) ??
                                selectedSnapshot.completedClose?.completedAt,
                            )}
                          </p>
                        </div>
                      </div>
                      {selectedSnapshot.completedClose?.notes ? (
                        <p className="mt-layout-md rounded-md border border-border bg-surface p-layout-sm text-sm leading-6 text-foreground">
                          {selectedSnapshot.completedClose.notes}
                        </p>
                      ) : null}
                      {selectedRecord.reopenedAt || selectedRecord.reopenReason ? (
                        <div className="mt-layout-md rounded-md border border-warning/30 bg-warning/10 p-layout-sm text-sm leading-6">
                          <p className="font-medium text-warning-foreground">
                            Reopened after completion
                          </p>
                          <p className="mt-1 text-muted-foreground">
                            {selectedRecord.reopenedAt
                              ? formatDailyCloseCompletedAt(
                                  selectedRecord.reopenedAt,
                                )
                              : "Reopen time unavailable"}
                            {selectedRecord.reopenReason
                              ? `. ${selectedRecord.reopenReason}`
                              : "."}
                          </p>
                        </div>
                      ) : null}
                    </div>

                    <DailyCloseReadOnlyReport
                      currency={currency}
                      orgUrlSlug={orgUrlSlug}
                      snapshot={selectedSnapshot}
                      storeUrlSlug={storeUrlSlug}
                    />
                  </section>
                ) : (
                  <EmptyState
                    description="The selected completed close could not load its stored historical report snapshot."
                    title="Historical report unavailable"
                  />
                )}
              </PageWorkspaceMain>
            </PageWorkspaceGrid>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
