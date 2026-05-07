import { useMemo, useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowUpRight,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  Lock,
  RotateCcw,
} from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { cn } from "@/lib/utils";
import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import {
  runCommand,
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { getOrigin } from "@/lib/navigationUtils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { CommandResult } from "~/shared/commandResult";
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
import { LoadingButton } from "../ui/loading-button";
import { Skeleton } from "../ui/skeleton";

type DailyCloseApi = {
  completeDailyClose?: unknown;
  getDailyCloseSnapshot?: unknown;
};

const useExpectedDailyCloseQuery = useQuery as unknown as (
  query: unknown,
  args: unknown,
) => unknown;
const useExpectedDailyCloseMutation = useMutation as unknown as (
  mutation: unknown,
) => (args: Record<string, unknown>) => Promise<unknown>;

type DailyCloseStatus =
  | "blocked"
  | "needs_review"
  | "carry_forward"
  | "ready"
  | "completed";

export type DailyCloseItemLink = {
  href?: string;
  label?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  to?: string;
};

export type DailyCloseItem = {
  category?: string;
  description?: string | null;
  id?: string;
  key?: string;
  link?: DailyCloseItemLink | null;
  message?: string | null;
  metadata?:
    | Array<{
        label: string;
        value: string;
      }>
    | Record<string, unknown>;
  severity?: "blocker" | "review" | "carry_forward" | "ready";
  statusLabel?: string | null;
  subject?: {
    id: string;
    label?: string;
    type: string;
  };
  title: string;
};

export type DailyCloseSnapshot = {
  blockers: DailyCloseItem[];
  carryForwardItems: DailyCloseItem[];
  completedClose?: {
    completedAt?: number | null;
    completedByStaffName?: string | null;
    notes?: string | null;
  } | null;
  operatingDate: string;
  readyItems: DailyCloseItem[];
  readiness?: {
    blockerCount: number;
    carryForwardCount: number;
    readyCount: number;
    reviewCount: number;
    status: "blocked" | "needs_review" | "ready";
  };
  reviewItems: DailyCloseItem[];
  status?: DailyCloseStatus;
  summary: {
    cashDeposited?: number | null;
    cashDepositTotal?: number | null;
    cashExpected?: number | null;
    closedRegisterSessionCount?: number | null;
    carryForwardCount?: number | null;
    expectedCashTotal?: number | null;
    expenseTotal?: number | null;
    netCashVariance?: number | null;
    openWorkItemCount?: number | null;
    paymentTotals?: Array<{
      amount: number;
      method: string;
    }>;
    pendingApprovalCount?: number | null;
    registerCount?: number | null;
    staffCount?: number | null;
    salesTotal?: number | null;
    totalSales?: number | null;
    transactionCount?: number | null;
    varianceTotal?: number | null;
    voidedTransactionCount?: number | null;
  };
};

type CompletionArgs = {
  carryForwardWorkItemIds: string[];
  notes: string;
  operatingDate: string;
  reviewedItemKeys: string[];
};

type DailyCloseViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  isAuthenticated: boolean;
  isCompleting: boolean;
  isLoadingAccess: boolean;
  isLoadingSnapshot: boolean;
  onComplete: (args: CompletionArgs) => Promise<NormalizedCommandResult<unknown>>;
  orgUrlSlug: string;
  snapshot?: DailyCloseSnapshot;
  storeId?: Id<"store">;
  storeUrlSlug: string;
};

const statusCopy: Record<
  DailyCloseStatus,
  {
    badge: string;
    description: string;
    title: string;
  }
> = {
  blocked: {
    badge: "Blocked",
    description:
      "Resolve blocker items before the store day can be marked closed.",
    title: "Close blocked",
  },
  carry_forward: {
    badge: "Carry forward",
    description:
      "The close can continue with selected follow-ups preserved for opening.",
    title: "Follow-ups ready",
  },
  completed: {
    badge: "Completed",
    description: "The store day has a saved close summary.",
    title: "Daily close completed",
  },
  needs_review: {
    badge: "Needs review",
    description:
      "Review exceptions before completing the store-day close.",
    title: "Review required",
  },
  ready: {
    badge: "Ready",
    description: "Required close work is complete.",
    title: "Ready to close",
  },
};

function getDailyCloseApi(): DailyCloseApi {
  return (
    (api.operations as typeof api.operations & {
      dailyClose?: DailyCloseApi;
    }).dailyClose ?? {}
  );
}

function formatCount(value?: number | null) {
  return typeof value === "number" ? String(value) : "0";
}

function formatMoney(currency: string, amount?: number | null) {
  if (typeof amount !== "number") return "Pending";

  return formatStoredAmount(currencyFormatter(currency), amount);
}

function formatOperatingDate(operatingDate: string) {
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

function formatCompletedAt(completedAt?: number | null) {
  if (!completedAt) return "Completion time unavailable";

  return new Date(completedAt).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getLocalOperatingDate(date = new Date()) {
  const localDate = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);

  return localDate.toISOString().slice(0, 10);
}

function normalizeCommandMessage(result: Exclude<
  NormalizedCommandResult<unknown>,
  { kind: "ok" }
>) {
  if (result.kind === "user_error") {
    return toOperatorMessage(result.error.message);
  }

  return result.error.message;
}

function getDailyCloseStatus(snapshot: DailyCloseSnapshot): DailyCloseStatus {
  if (snapshot.status) return snapshot.status;

  if (snapshot.completedClose) return "completed";

  if (snapshot.readiness?.status === "blocked") return "blocked";

  if (snapshot.readiness?.status === "needs_review") return "needs_review";

  if (snapshot.carryForwardItems.length > 0) return "carry_forward";

  return "ready";
}

function getItemId(item: DailyCloseItem) {
  return item.id ?? item.key ?? `${item.subject?.type ?? "item"}:${item.subject?.id ?? item.title}`;
}

function getReviewedItemKeys(items: DailyCloseItem[]) {
  return items.map((item) => item.key ?? getItemId(item));
}

function getCarryForwardWorkItemId(item: DailyCloseItem) {
  return item.subject?.type === "operational_work_item"
    ? item.subject.id
    : getItemId(item);
}

function getCarryForwardWorkItemIds(items: DailyCloseItem[]) {
  return items.map(getCarryForwardWorkItemId);
}

function getItemDescription(item: DailyCloseItem) {
  return item.description ?? item.message;
}

function getStatusLabel(item: DailyCloseItem) {
  return (
    item.statusLabel ??
    (item.severity === "carry_forward"
      ? "Carry forward"
      : item.severity === "ready"
        ? "Ready"
        : item.severity === "review"
          ? "Review"
          : item.severity === "blocker"
            ? "Blocks close"
            : null)
  );
}

function humanizeMetadataLabel(label: string) {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined || value === "") return "Not set";

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "string") return value;

  return JSON.stringify(value);
}

function getMetadataEntries(item: DailyCloseItem) {
  if (!item.metadata) return [];

  if (Array.isArray(item.metadata)) return item.metadata;

  return Object.entries(item.metadata).map(([label, value]) => ({
    label: humanizeMetadataLabel(label),
    value: formatMetadataValue(value),
  }));
}

function getSummaryAmount(
  summary: DailyCloseSnapshot["summary"],
  primary: keyof DailyCloseSnapshot["summary"],
  fallback: keyof DailyCloseSnapshot["summary"],
) {
  const primaryValue = summary[primary];
  const fallbackValue = summary[fallback];

  return typeof primaryValue === "number"
    ? primaryValue
    : typeof fallbackValue === "number"
      ? fallbackValue
      : null;
}

function getSummaryCount(
  summary: DailyCloseSnapshot["summary"],
  primary: keyof DailyCloseSnapshot["summary"],
  fallback: keyof DailyCloseSnapshot["summary"],
) {
  const primaryValue = summary[primary];
  const fallbackValue = summary[fallback];

  return typeof primaryValue === "number"
    ? primaryValue
    : typeof fallbackValue === "number"
      ? fallbackValue
      : 0;
}

function DailyCloseSkeleton() {
  return (
    <div
      aria-label="Loading daily close workspace"
      className="space-y-layout-3xl"
    >
      <div className="grid gap-layout-sm md:grid-cols-2 2xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface"
            key={index}
          >
            <Skeleton className="h-3 w-28" />
            <Skeleton className="mt-layout-xs h-8 w-24" />
            <Skeleton className="mt-2 h-3 w-36" />
          </div>
        ))}
      </div>

      <PageWorkspaceGrid>
        <PageWorkspaceMain>
          {Array.from({ length: 3 }).map((_, index) => (
            <section
              className="rounded-lg border border-border bg-surface-raised shadow-surface"
              key={index}
            >
              <div className="border-b border-border px-layout-md py-layout-md">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="mt-layout-xs h-6 w-48" />
              </div>
              <div className="space-y-layout-sm p-layout-md">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            </section>
          ))}
        </PageWorkspaceMain>
        <PageWorkspaceRail>
          <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-layout-sm h-8 w-40" />
            <Skeleton className="mt-layout-md h-24 w-full" />
          </div>
        </PageWorkspaceRail>
      </PageWorkspaceGrid>
    </div>
  );
}

function SummaryMetric({
  label,
  value,
  helper,
}: {
  helper?: string;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-layout-xs font-numeric text-2xl font-semibold tabular-nums text-foreground">
        {value}
      </p>
      {helper ? (
        <p className="mt-1 text-xs leading-5 text-muted-foreground">
          {helper}
        </p>
      ) : null}
    </div>
  );
}

function ItemLink({
  link,
  orgUrlSlug,
  storeUrlSlug,
}: {
  link?: DailyCloseItemLink | null;
  orgUrlSlug: string;
  storeUrlSlug: string;
}) {
  if (!link) return null;

  const label = link.label ?? "Open source";

  if (link.href) {
    return (
      <Button asChild size="sm" variant="utility">
        <a href={link.href}>
          <ArrowUpRight aria-hidden="true" />
          {label}
        </a>
      </Button>
    );
  }

  if (link.to) {
    return (
      <Button asChild size="sm" variant="utility">
        <Link
          params={
            {
              orgUrlSlug,
              storeUrlSlug,
              ...(link.params ?? {}),
            } as never
          }
          search={
            {
              o: getOrigin(),
              ...(link.search ?? {}),
            } as never
          }
          to={link.to as never}
        >
          <ArrowUpRight aria-hidden="true" />
          {label}
        </Link>
      </Button>
    );
  }

  return null;
}

function DailyCloseItemCard({
  item,
  orgUrlSlug,
  selectable,
  selected,
  storeUrlSlug,
  onSelectedChange,
}: {
  item: DailyCloseItem;
  onSelectedChange?: (selected: boolean) => void;
  orgUrlSlug: string;
  selectable?: boolean;
  selected?: boolean;
  storeUrlSlug: string;
}) {
  const itemId = getItemId(item);
  const description = getItemDescription(item);
  const metadataEntries = getMetadataEntries(item);
  const statusLabel = getStatusLabel(item);

  return (
    <article className="rounded-lg border border-border bg-background p-layout-md">
      <div className="flex flex-col gap-layout-sm md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-layout-sm">
          {selectable ? (
            <input
              aria-label={`Carry forward ${item.title}`}
              checked={Boolean(selected)}
              className="mt-1 h-4 w-4 rounded border-border text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onChange={(event) => onSelectedChange?.(event.target.checked)}
              type="checkbox"
            />
          ) : null}
          <div className="min-w-0">
            <p className="font-medium text-foreground">{item.title}</p>
            {description ? (
              <p className="mt-1 text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
          {statusLabel ? (
            <Badge
              className="border-border bg-surface text-muted-foreground shadow-sm"
              variant="outline"
            >
              {statusLabel}
            </Badge>
          ) : null}
          <ItemLink
            link={item.link}
            orgUrlSlug={orgUrlSlug}
            storeUrlSlug={storeUrlSlug}
          />
        </div>
      </div>

      {metadataEntries.length > 0 ? (
        <dl className="mt-layout-sm grid gap-layout-sm border-t border-border/70 pt-layout-sm text-sm md:grid-cols-3">
          {metadataEntries.map((entry) => (
            <div key={`${itemId}-${entry.label}`}>
              <dt className="text-xs text-muted-foreground">{entry.label}</dt>
              <dd className="mt-1 font-medium text-foreground">
                {entry.value}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
    </article>
  );
}

function BucketSection({
  ariaLabel,
  description,
  emptyText,
  items,
  orgUrlSlug,
  selectedIds,
  status,
  storeUrlSlug,
  title,
  onSelectedIdsChange,
}: {
  ariaLabel: string;
  description: string;
  emptyText: string;
  items: DailyCloseItem[];
  onSelectedIdsChange?: (ids: string[]) => void;
  orgUrlSlug: string;
  selectedIds?: string[];
  status: "blocked" | "carry-forward" | "ready" | "review";
  storeUrlSlug: string;
  title: string;
}) {
  const iconClassName = cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
    status === "blocked" && "bg-danger/10 text-danger",
    status === "review" && "bg-warning/15 text-warning-foreground",
    status === "carry-forward" && "bg-action-workflow-soft text-action-workflow",
    status === "ready" && "bg-success/10 text-success",
  );
  const Icon =
    status === "blocked"
      ? AlertTriangle
      : status === "review"
        ? ClipboardCheck
        : status === "carry-forward"
          ? RotateCcw
          : CheckCircle2;

  return (
    <section
      aria-label={ariaLabel}
      className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-surface"
      role="region"
    >
      <div className="flex flex-col gap-layout-sm border-b border-border px-layout-md py-layout-md md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-layout-sm">
          <div className={iconClassName}>
            <Icon className="h-4 w-4" />
          </div>
          <div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {title}
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {description}
            </p>
          </div>
        </div>
        <Badge className="border-border bg-background shadow-sm" variant="outline">
          {items.length}
        </Badge>
      </div>

      <div className="space-y-layout-sm p-layout-md">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-background p-layout-md text-sm text-muted-foreground">
            {emptyText}
          </p>
        ) : (
          items.map((item) => {
            const selectionId = getCarryForwardWorkItemId(item);

            return (
              <DailyCloseItemCard
                item={item}
                key={getItemId(item)}
                onSelectedChange={(isSelected) => {
                  if (!selectedIds || !onSelectedIdsChange) return;

                  onSelectedIdsChange(
                    isSelected
                      ? [...selectedIds, selectionId]
                      : selectedIds.filter((id) => id !== selectionId),
                  );
                }}
                orgUrlSlug={orgUrlSlug}
                selectable={Boolean(selectedIds && onSelectedIdsChange)}
                selected={selectedIds?.includes(selectionId)}
                storeUrlSlug={storeUrlSlug}
              />
            );
          })
        )}
      </div>
    </section>
  );
}

function CompletionRail({
  commandMessage,
  isBlocked,
  isCompleted,
  isCompleting,
  notes,
  onComplete,
  onNotesChange,
  snapshot,
  status,
}: {
  commandMessage?: {
    kind: "error" | "success";
    message: string;
  } | null;
  isBlocked: boolean;
  isCompleted: boolean;
  isCompleting: boolean;
  notes: string;
  onComplete: () => void;
  onNotesChange: (notes: string) => void;
  snapshot: DailyCloseSnapshot;
  status: DailyCloseStatus;
}) {
  const copy = statusCopy[status];

  return (
    <PageWorkspaceRail>
      <aside className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
        <div className="flex items-start gap-layout-sm">
          <div
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
              isBlocked
                ? "bg-danger/10 text-danger"
                : isCompleted
                  ? "bg-success/10 text-success"
                  : "bg-signal/10 text-signal",
            )}
          >
            {isBlocked ? (
              <Lock className="h-4 w-4" />
            ) : (
              <ListChecks className="h-4 w-4" />
            )}
          </div>
          <div>
            <p className="text-sm text-muted-foreground">Close status</p>
            <h2 className="mt-1 text-xl font-medium text-foreground">
              {copy.badge}
            </h2>
          </div>
        </div>
        <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>

        <div className="mt-layout-md rounded-lg border border-border bg-background p-layout-sm">
          <dl className="space-y-layout-sm text-sm">
            <div className="flex items-center justify-between gap-layout-md">
              <dt className="text-muted-foreground">Operating date</dt>
              <dd className="font-medium text-foreground">
                {formatOperatingDate(snapshot.operatingDate)}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-layout-md">
              <dt className="text-muted-foreground">Blockers</dt>
              <dd className="font-numeric font-semibold tabular-nums text-foreground">
                {snapshot.blockers.length}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-layout-md">
              <dt className="text-muted-foreground">Review items</dt>
              <dd className="font-numeric font-semibold tabular-nums text-foreground">
                {snapshot.reviewItems.length}
              </dd>
            </div>
            <div className="flex items-center justify-between gap-layout-md">
              <dt className="text-muted-foreground">Carry forward</dt>
              <dd className="font-numeric font-semibold tabular-nums text-foreground">
                {snapshot.carryForwardItems.length}
              </dd>
            </div>
          </dl>
        </div>

        {isCompleted && snapshot.completedClose ? (
          <div className="mt-layout-md rounded-lg border border-success/30 bg-success/10 p-layout-sm">
            <p className="text-sm font-medium text-success">
              Close record saved
            </p>
            <p className="mt-1 text-sm leading-6 text-muted-foreground">
              {snapshot.completedClose.completedByStaffName
                ? `Completed by ${snapshot.completedClose.completedByStaffName}.`
                : "Completed staff unavailable."}{" "}
              {formatCompletedAt(snapshot.completedClose.completedAt)}
            </p>
            {snapshot.completedClose.notes ? (
              <p className="mt-layout-sm text-sm leading-6 text-foreground">
                {snapshot.completedClose.notes}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-layout-md space-y-layout-sm">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="daily-close-notes"
            >
              Close notes
            </label>
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="daily-close-notes"
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Add a short note for the close summary."
              value={notes}
            />
            <LoadingButton
              className="w-full"
              disabled={isBlocked}
              isLoading={isCompleting}
              onClick={onComplete}
              type="button"
              variant="workflow"
            >
              Complete Daily Close
            </LoadingButton>
          </div>
        )}

        {commandMessage ? (
          <div
            className={cn(
              "mt-layout-md rounded-lg border p-layout-sm text-sm leading-6",
              commandMessage.kind === "error"
                ? "border-danger/30 bg-danger/10 text-danger"
                : "border-success/30 bg-success/10 text-success",
            )}
            role={commandMessage.kind === "error" ? "alert" : "status"}
          >
            {commandMessage.message}
          </div>
        ) : null}
      </aside>
    </PageWorkspaceRail>
  );
}

export function DailyCloseViewContent({
  currency,
  hasFullAdminAccess,
  isAuthenticated,
  isCompleting,
  isLoadingAccess,
  isLoadingSnapshot,
  onComplete,
  orgUrlSlug,
  snapshot,
  storeId,
  storeUrlSlug,
}: DailyCloseViewContentProps) {
  const [notes, setNotes] = useState("");
  const [commandMessage, setCommandMessage] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const [selectedCarryForwardIds, setSelectedCarryForwardIds] = useState<
    string[] | null
  >(null);
  const carryForwardWorkItemIds = useMemo(
    () => getCarryForwardWorkItemIds(snapshot?.carryForwardItems ?? []),
    [snapshot?.carryForwardItems],
  );
  const selectedIds =
    selectedCarryForwardIds !== null
      ? selectedCarryForwardIds
      : carryForwardWorkItemIds;

  if (isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <div aria-label="Loading daily close access" />
        </FadeIn>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before Daily Close can load protected store-day data" />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!storeId) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening Daily Close."
          title="No active store"
        />
      </div>
    );
  }

  const status = snapshot ? getDailyCloseStatus(snapshot) : "ready";
  const isBlocked = status === "blocked";
  const isCompleted = status === "completed";

  const handleComplete = async () => {
    if (!snapshot || isBlocked || isCompleted) return;

    setCommandMessage(null);

    const result = await onComplete({
      carryForwardWorkItemIds: selectedIds,
      notes,
      operatingDate: snapshot.operatingDate,
      reviewedItemKeys: getReviewedItemKeys(snapshot.reviewItems),
    });

    if (result.kind === "ok") {
      setCommandMessage({
        kind: "success",
        message: "Daily close completed.",
      });
      return;
    }

    setCommandMessage({
      kind: "error",
      message: normalizeCommandMessage(result),
    });
  };

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            className="border-b-0 pb-0"
            eyebrow="Operations"
            title="Daily Close"
            description="Review the store day, resolve blockers, and preserve follow-ups before saving the close summary."
          />

          {isLoadingSnapshot || !snapshot ? (
            <DailyCloseSkeleton />
          ) : (
            <PageWorkspace>
              <section className="space-y-layout-md">
                <div className="flex flex-col gap-layout-sm lg:flex-row lg:items-end lg:justify-between">
                  <div>
                    <Badge
                      className={cn(
                        "border-border shadow-sm",
                        isBlocked
                          ? "bg-danger/10 text-danger"
                          : isCompleted
                            ? "bg-success/10 text-success"
                            : "bg-surface text-muted-foreground",
                      )}
                      variant="outline"
                    >
                      {statusCopy[status].badge}
                    </Badge>
                    <h2 className="mt-layout-sm text-2xl font-medium text-foreground">
                      {statusCopy[status].title}
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">
                      {statusCopy[status].description}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-sm text-sm text-muted-foreground shadow-surface">
                    Store day{" "}
                    <span className="font-medium text-foreground">
                      {formatOperatingDate(snapshot.operatingDate)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-layout-sm md:grid-cols-2 2xl:grid-cols-4">
                  <SummaryMetric
                    helper={`${formatCount(
                      getSummaryCount(
                        snapshot.summary,
                        "transactionCount",
                        "transactionCount",
                      ),
                    )} transactions`}
                    label="Net sales"
                    value={formatMoney(
                      currency,
                      getSummaryAmount(snapshot.summary, "totalSales", "salesTotal"),
                    )}
                  />
                  <SummaryMetric
                    helper={`${formatCount(
                      getSummaryCount(
                        snapshot.summary,
                        "registerCount",
                        "closedRegisterSessionCount",
                      ),
                    )} registers`}
                    label="Expected cash"
                    value={formatMoney(
                      currency,
                      getSummaryAmount(
                        snapshot.summary,
                        "cashExpected",
                        "expectedCashTotal",
                      ),
                    )}
                  />
                  <SummaryMetric
                    helper={`${formatCount(
                      getSummaryCount(
                        snapshot.summary,
                        "staffCount",
                        "pendingApprovalCount",
                      ),
                    )} staff involved`}
                    label="Expenses"
                    value={formatMoney(currency, snapshot.summary.expenseTotal)}
                  />
                  <SummaryMetric
                    helper={`${formatCount(
                      getSummaryCount(
                        snapshot.summary,
                        "carryForwardCount",
                        "openWorkItemCount",
                      ),
                    )} follow-ups`}
                    label="Variance"
                    value={formatMoney(
                      currency,
                      getSummaryAmount(
                        snapshot.summary,
                        "varianceTotal",
                        "netCashVariance",
                      ),
                    )}
                  />
                </div>
              </section>

              <PageWorkspaceGrid>
                <PageWorkspaceMain>
                  <BucketSection
                    ariaLabel="Blocked close items"
                    description="These items keep the store day from closing cleanly."
                    emptyText="No hard blockers are currently reported."
                    items={snapshot.blockers}
                    orgUrlSlug={orgUrlSlug}
                    status="blocked"
                    storeUrlSlug={storeUrlSlug}
                    title="Blocked"
                  />

                  <BucketSection
                    ariaLabel="Review before close"
                    description="These items stay visible in the close summary after review."
                    emptyText="No review items are currently reported."
                    items={snapshot.reviewItems}
                    orgUrlSlug={orgUrlSlug}
                    status="review"
                    storeUrlSlug={storeUrlSlug}
                    title="Needs review"
                  />

                  <BucketSection
                    ariaLabel="Carry-forward items"
                    description="Selected items are preserved for follow-up during the next opening workflow."
                    emptyText="No carry-forward items are currently reported."
                    items={snapshot.carryForwardItems}
                    onSelectedIdsChange={setSelectedCarryForwardIds}
                    orgUrlSlug={orgUrlSlug}
                    selectedIds={selectedIds}
                    status="carry-forward"
                    storeUrlSlug={storeUrlSlug}
                    title="Carry forward"
                  />

                  <BucketSection
                    ariaLabel="Ready close items"
                    description="Completed close inputs that support the store-day summary."
                    emptyText="Ready items will appear after close inputs are reconciled."
                    items={snapshot.readyItems}
                    orgUrlSlug={orgUrlSlug}
                    status="ready"
                    storeUrlSlug={storeUrlSlug}
                    title="Ready"
                  />
                </PageWorkspaceMain>

                <CompletionRail
                  commandMessage={commandMessage}
                  isBlocked={isBlocked}
                  isCompleted={isCompleted}
                  isCompleting={isCompleting}
                  notes={notes}
                  onComplete={() => void handleComplete()}
                  onNotesChange={setNotes}
                  snapshot={snapshot}
                  status={status}
                />
              </PageWorkspaceGrid>
            </PageWorkspace>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function DailyCloseApiPendingView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            className="border-b-0 pb-0"
            eyebrow="Operations"
            title="Daily Close"
            description="Daily Close is waiting for the server close snapshot and completion command."
          />
          <EmptyState
            description="The frontend is wired to api.operations.dailyClose.getDailyCloseSnapshot and completeDailyClose."
            title="Daily Close server API pending"
          />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

type DailyCloseConnectedViewProps = {
  completeDailyClose: unknown;
  getDailyCloseSnapshot: unknown;
};

function DailyCloseConnectedView({
  completeDailyClose,
  getDailyCloseSnapshot,
}: DailyCloseConnectedViewProps) {
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
  const [isCompleting, setIsCompleting] = useState(false);
  const operatingDate = getLocalOperatingDate();
  const snapshot = useExpectedDailyCloseQuery(
    getDailyCloseSnapshot,
    canQueryProtectedData
      ? { operatingDate, storeId: activeStore!._id }
      : "skip",
  ) as DailyCloseSnapshot | undefined;
  const completeDailyCloseMutation =
    useExpectedDailyCloseMutation(completeDailyClose);

  const handleComplete = async (args: CompletionArgs) => {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          code: "validation_failed",
          message: "Select a store before completing Daily Close.",
        },
      } as NormalizedCommandResult<unknown>;
    }

    setIsCompleting(true);

    try {
      return await runCommand(() =>
        completeDailyCloseMutation({
          carryForwardWorkItemIds: args.carryForwardWorkItemIds,
          notes: args.notes || undefined,
          operatingDate: args.operatingDate,
          reviewedItemKeys: args.reviewedItemKeys,
          storeId: activeStore._id,
        }) as Promise<CommandResult<unknown>>,
      );
    } finally {
      setIsCompleting(false);
    }
  };

  return (
    <DailyCloseViewContent
      currency={activeStore?.currency || "USD"}
      hasFullAdminAccess={hasFullAdminAccess}
      isAuthenticated={isAuthenticated}
      isCompleting={isCompleting}
      isLoadingAccess={isLoadingAccess}
      isLoadingSnapshot={snapshot === undefined}
      onComplete={handleComplete}
      orgUrlSlug={params?.orgUrlSlug ?? ""}
      snapshot={snapshot}
      storeId={activeStore?._id}
      storeUrlSlug={params?.storeUrlSlug ?? ""}
    />
  );
}

export function DailyCloseView() {
  const dailyCloseApi = getDailyCloseApi();

  if (
    !dailyCloseApi.getDailyCloseSnapshot ||
    !dailyCloseApi.completeDailyClose
  ) {
    return <DailyCloseApiPendingView />;
  }

  return (
    <DailyCloseConnectedView
      completeDailyClose={dailyCloseApi.completeDailyClose}
      getDailyCloseSnapshot={dailyCloseApi.getDailyCloseSnapshot}
    />
  );
}
