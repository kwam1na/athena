import { type ReactNode, useMemo, useState } from "react";
import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Ban,
  CheckCircle2,
  ClipboardCheck,
  ListChecks,
  RotateCcw,
} from "lucide-react";

import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import { cn } from "@/lib/utils";
import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import {
  runCommand,
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
import type { CommandResult } from "~/shared/commandResult";
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
import {
  CommandApprovalDialog,
  type CommandApprovalDialogProps,
} from "./CommandApprovalDialog";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { LoadingButton } from "../ui/loading-button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";

type DailyOpeningApi = {
  getDailyOpeningSnapshot?: unknown;
  startStoreDay?: unknown;
};

const useExpectedDailyOpeningQuery = useQuery as unknown as (
  query: unknown,
  args: unknown,
) => unknown;
const useExpectedDailyOpeningMutation = useMutation as unknown as (
  mutation: unknown,
) => (args: Record<string, unknown>) => Promise<unknown>;

type DailyOpeningStatus = "blocked" | "needs_attention" | "ready" | "started";

export type DailyOpeningItemLink = {
  href?: string;
  label?: string;
  params?: Record<string, string>;
  search?: Record<string, string>;
  to?: string;
};

export type DailyOpeningItem = {
  category?: string;
  description?: string | null;
  id?: string;
  key?: string;
  link?: DailyOpeningItemLink | null;
  metadata?:
    | Array<{
        label: string;
        value: ReactNode;
      }>
    | Record<string, unknown>;
  message?: string | null;
  severity?: "blocker" | "review" | "carry_forward" | "ready";
  statusLabel?: string | null;
  subject?: {
    id: string;
    label?: string;
    type: string;
  };
  title: string;
};

export type DailyOpeningSnapshot = {
  blockers: DailyOpeningItem[];
  carryForwardItems: DailyOpeningItem[];
  endAt: number;
  operatingDate: string;
  priorClose?: {
    completedAt?: number | null;
    completedByStaffName?: string | null;
    notes?: string | null;
    operatingDate?: string | null;
  } | null;
  readyItems: DailyOpeningItem[];
  readiness?: {
    blockerCount: number;
    carryForwardCount: number;
    readyCount: number;
    reviewCount: number;
    status: "blocked" | "needs_attention" | "ready";
  };
  reviewItems: DailyOpeningItem[];
  startAt: number;
  startedOpening?: {
    notes?: string | null;
    startedAt?: number | null;
    startedByStaffName?: string | null;
  } | null;
  status?: DailyOpeningStatus;
  summary?: {
    blockerCount?: number | null;
    carryForwardCount?: number | null;
    readyCount?: number | null;
    reviewCount?: number | null;
  };
};

type StartDayArgs = {
  acknowledgedItemKeys: string[];
  actorStaffProfileId?: Id<"staffProfile">;
  endAt: number;
  notes: string;
  operatingDate: string;
  startAt: number;
};

type BucketStatus = "blocked" | "carry-forward" | "ready" | "review";

type DailyOpeningViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  isAuthenticated: boolean;
  isLoadingAccess: boolean;
  isLoadingSnapshot: boolean;
  isStarting: boolean;
  onStartDay: (args: StartDayArgs) => Promise<NormalizedCommandResult<unknown>>;
  onAuthenticateForApproval?: CommandApprovalDialogProps["onAuthenticateForApproval"];
  orgUrlSlug: string;
  snapshot?: DailyOpeningSnapshot;
  storeId?: Id<"store">;
  storeUrlSlug: string;
};

type BucketConfig = {
  ariaLabel: string;
  description: string;
  emptyText: string;
  items: DailyOpeningItem[];
  status: BucketStatus;
  title: string;
  value: BucketStatus;
};

const bucketTabValues: BucketStatus[] = [
  "blocked",
  "review",
  "carry-forward",
  "ready",
];

const statusCopy: Record<
  DailyOpeningStatus,
  {
    badge: string;
    description: string;
    title: string;
  }
> = {
  blocked: {
    badge: "Blocked",
    description:
      "Resolve blocker items before marking the store day ready to trade.",
    title: "Opening blocked",
  },
  needs_attention: {
    badge: "Needs attention",
    description:
      "Acknowledge review and carry-forward items before starting the store day.",
    title: "Ready with attention",
  },
  ready: {
    badge: "Ready",
    description: "Prior close handoff is clear. The store day can start.",
    title: "Ready to start",
  },
  started: {
    badge: "Started",
    description: "Opening handoff is complete. The store day is ready to run.",
    title: "Store day started",
  },
};

function getDailyOpeningApi(): DailyOpeningApi {
  return (
    (
      api.operations as typeof api.operations & {
        dailyOpening?: DailyOpeningApi;
      }
    ).dailyOpening ?? {}
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

function formatTimestamp(timestamp?: number | null) {
  if (!timestamp) return "Time unavailable";

  return new Date(timestamp).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function humanizeMetadataLabel(label: string) {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getOpeningStatus(snapshot: DailyOpeningSnapshot): DailyOpeningStatus {
  if (snapshot.startedOpening) return "started";
  if (snapshot.status) return snapshot.status;
  if (snapshot.readiness?.status) return snapshot.readiness.status;
  if (snapshot.blockers.length > 0) return "blocked";
  if (
    snapshot.reviewItems.length > 0 ||
    snapshot.carryForwardItems.length > 0
  ) {
    return "needs_attention";
  }
  return "ready";
}

function getItemId(item: DailyOpeningItem) {
  return (
    item.id ??
    item.key ??
    `${item.subject?.type ?? "opening-item"}:${item.subject?.id ?? item.title}`
  );
}

function getAcknowledgementKey(item: DailyOpeningItem) {
  return item.key ?? getItemId(item);
}

function getRequiredAcknowledgementKeys(snapshot?: DailyOpeningSnapshot) {
  return [
    ...(snapshot?.reviewItems ?? []),
    ...(snapshot?.carryForwardItems ?? []),
  ].map(getAcknowledgementKey);
}

function getItemDescription(item: DailyOpeningItem) {
  return item.description ?? item.message;
}

function getItemContextLabel(item: DailyOpeningItem) {
  return item.category
    ? humanizeMetadataLabel(item.category)
    : item.subject?.type
      ? humanizeMetadataLabel(item.subject.type)
      : "Opening item";
}

function formatMetadataValue(value: ReactNode, currency: string) {
  if (typeof value === "number") {
    return new Intl.NumberFormat([], {
      currency,
      style: "currency",
    }).format(value / 100);
  }

  if (typeof value === "boolean") return String(value);

  return value;
}

function getMetadataLabel(item: DailyOpeningItem, label: string) {
  if (label === "operatingDate") {
    if (item.key === "daily_close:prior:missing") {
      return "Store day being opened";
    }

    return "Store day";
  }

  return humanizeMetadataLabel(label);
}

function getMetadataValue(label: string, value: ReactNode, currency: string) {
  if (label === "operatingDate" && typeof value === "string") {
    return formatOperatingDate(value);
  }

  return formatMetadataValue(value, currency);
}

function getMetadataEntries(item: DailyOpeningItem, currency: string) {
  if (!item.metadata) return [];

  if (Array.isArray(item.metadata)) {
    return item.metadata.map((entry) => ({
      label: entry.label,
      value: formatMetadataValue(entry.value, currency),
    }));
  }

  return Object.entries(item.metadata)
    .filter(
      ([, value]) => value !== null && value !== undefined && value !== "",
    )
    .map(([label, value]) => ({
      label: getMetadataLabel(item, label),
      value: getMetadataValue(label, value as ReactNode, currency),
    }));
}

function normalizeCommandMessage(
  result: Exclude<NormalizedCommandResult<unknown>, { kind: "ok" }>,
) {
  if (result.kind === "user_error") {
    const normalized = toOperatorMessage(result.error.message);

    if (
      /^Open the cash drawer before starting the store day\.?$/i.test(
        normalized,
      )
    ) {
      return "Drawer closed. Open the drawer before starting the store day.";
    }

    return normalized;
  }

  return result.error.message;
}

function getStatusLabelClassName(status: DailyOpeningStatus) {
  return cn(
    "inline-flex w-fit rounded-md px-layout-sm py-1 text-base font-medium",
    status === "blocked" && "bg-danger/10 text-danger",
    status === "needs_attention" && "bg-warning/15 text-warning-foreground",
    (status === "ready" || status === "started") &&
      "bg-success/10 text-success",
  );
}

function getStatusRailIconClassName(status: DailyOpeningStatus) {
  return cn(
    status === "blocked" && "bg-danger/10 text-danger",
    status === "needs_attention" && "bg-warning/15 text-warning-foreground",
    (status === "ready" || status === "started") &&
      "bg-success/10 text-success",
  );
}

function getStatusRailBadgeClassName(status: DailyOpeningStatus) {
  return cn(
    status === "blocked" && "text-danger",
    status === "needs_attention" && "text-warning-foreground",
    (status === "ready" || status === "started") && "text-success",
  );
}

function getBucketCountClassName(status: BucketStatus) {
  return cn(
    "shadow-sm",
    status === "blocked" && "border-danger/20 bg-danger/10 text-danger",
    status === "review" &&
      "border-warning/30 bg-warning/15 text-warning-foreground",
    status === "carry-forward" &&
      "border-action-workflow/20 bg-action-workflow-soft text-action-workflow",
    status === "ready" && "border-success/20 bg-success/10 text-success",
  );
}

function formatCount(
  value: number,
  singular: string,
  zeroLabel: string,
  plural = `${singular}s`,
) {
  if (value === 0) return zeroLabel;
  if (value === 1) return `1 ${singular}`;
  return `${value} ${plural}`;
}

function getDefaultBucketValue(
  snapshot: DailyOpeningSnapshot,
  status: DailyOpeningStatus,
): BucketStatus {
  if (snapshot.blockers.length > 0) return "blocked";
  if (status === "needs_attention" && snapshot.reviewItems.length > 0) {
    return "review";
  }
  if (status === "needs_attention") return "carry-forward";
  return "ready";
}

function normalizeBucketTab(value: unknown): BucketStatus | null {
  return typeof value === "string" &&
    bucketTabValues.includes(value as BucketStatus)
    ? (value as BucketStatus)
    : null;
}

function getBucketConfigs(snapshot: DailyOpeningSnapshot): BucketConfig[] {
  return [
    {
      ariaLabel: "Blocked opening items",
      description: "These items keep the store day from starting cleanly.",
      emptyText: "No hard blockers are currently reported.",
      items: snapshot.blockers,
      status: "blocked",
      title: "Blocked",
      value: "blocked",
    },
    {
      ariaLabel: "Review before opening",
      description: "These prior close details must be acknowledged.",
      emptyText: "No review items are currently reported.",
      items: snapshot.reviewItems,
      status: "review",
      title: "Needs review",
      value: "review",
    },
    {
      ariaLabel: "Carry-forward items",
      description:
        "These open work items remain unresolved after acknowledgement.",
      emptyText: "No carry-forward items are currently reported.",
      items: snapshot.carryForwardItems,
      status: "carry-forward",
      title: "Carry forward",
      value: "carry-forward",
    },
    {
      ariaLabel: "Ready opening items",
      description:
        "Completed handoff checks that support starting the store day.",
      emptyText: "Ready items will appear after the handoff is checked.",
      items: snapshot.readyItems,
      status: "ready",
      title: "Ready",
      value: "ready",
    },
  ];
}

function ItemLink({
  link,
  orgUrlSlug,
  storeUrlSlug,
}: {
  link?: DailyOpeningItemLink | null;
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

function OpeningItemCard({
  currency,
  item,
  orgUrlSlug,
  requiresAcknowledgement,
  selected,
  storeUrlSlug,
  onSelectedChange,
}: {
  currency: string;
  item: DailyOpeningItem;
  onSelectedChange?: (selected: boolean) => void;
  orgUrlSlug: string;
  requiresAcknowledgement?: boolean;
  selected?: boolean;
  storeUrlSlug: string;
}) {
  const itemId = getItemId(item);
  const contextLabel = getItemContextLabel(item);
  const description = getItemDescription(item);
  const metadataEntries = getMetadataEntries(item, currency);

  return (
    <article className="rounded-lg border border-border/80 bg-surface-raised p-layout-md shadow-surface transition-[border-color,box-shadow] hover:border-border">
      <div className="flex flex-col gap-layout-md md:flex-row md:items-start md:justify-between">
        <div className="flex min-w-0 gap-layout-sm">
          {requiresAcknowledgement ? (
            <input
              aria-label={`Acknowledge ${item.title}`}
              checked={Boolean(selected)}
              className="mt-1 h-4 w-4 rounded border-border text-signal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              onChange={(event) => onSelectedChange?.(event.target.checked)}
              type="checkbox"
            />
          ) : null}
          <div className="min-w-0 space-y-layout-xs">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              {contextLabel}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <p className="font-medium text-foreground">{item.title}</p>
              {item.statusLabel ? (
                <Badge className="shadow-sm" variant="outline">
                  {item.statusLabel}
                </Badge>
              ) : null}
            </div>
            {description ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        <ItemLink
          link={item.link}
          orgUrlSlug={orgUrlSlug}
          storeUrlSlug={storeUrlSlug}
        />
      </div>

      {metadataEntries.length > 0 ? (
        <dl className="mt-layout-md grid gap-layout-md rounded-lg border border-border/70 bg-surface px-layout-md py-layout-sm text-sm md:grid-cols-3">
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
  acknowledgedKeys,
  ariaLabel,
  currency,
  description,
  emptyText,
  items,
  orgUrlSlug,
  requiresAcknowledgement,
  status,
  storeUrlSlug,
  title,
  onAcknowledgedKeysChange,
}: {
  acknowledgedKeys: string[];
  ariaLabel: string;
  currency: string;
  description: string;
  emptyText: string;
  items: DailyOpeningItem[];
  onAcknowledgedKeysChange: (keys: string[]) => void;
  orgUrlSlug: string;
  requiresAcknowledgement?: boolean;
  status: BucketStatus;
  storeUrlSlug: string;
  title: string;
}) {
  const iconClassName = cn(
    "flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
    status === "blocked" && "bg-danger/10 text-danger",
    status === "review" && "bg-warning/15 text-warning-foreground",
    status === "carry-forward" &&
      "bg-action-workflow-soft text-action-workflow",
    status === "ready" && "bg-success/10 text-success",
  );
  const Icon =
    status === "blocked"
      ? Ban
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
        <div className="flex items-center gap-layout-sm">
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
        <Badge className={getBucketCountClassName(status)} variant="outline">
          {items.length}
        </Badge>
      </div>

      <div className="space-y-layout-md bg-surface p-layout-md">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-surface-raised p-layout-md text-sm text-muted-foreground shadow-sm">
            {emptyText}
          </p>
        ) : (
          items.map((item) => {
            const acknowledgementKey = getAcknowledgementKey(item);

            return (
              <OpeningItemCard
                currency={currency}
                item={item}
                key={getItemId(item)}
                onSelectedChange={(isSelected) => {
                  onAcknowledgedKeysChange(
                    isSelected
                      ? [...acknowledgedKeys, acknowledgementKey]
                      : acknowledgedKeys.filter(
                          (key) => key !== acknowledgementKey,
                        ),
                  );
                }}
                orgUrlSlug={orgUrlSlug}
                requiresAcknowledgement={requiresAcknowledgement}
                selected={acknowledgedKeys.includes(acknowledgementKey)}
                storeUrlSlug={storeUrlSlug}
              />
            );
          })
        )}
      </div>
    </section>
  );
}

function BucketTabs({
  acknowledgedKeys,
  buckets,
  currency,
  onAcknowledgedKeysChange,
  onValueChange,
  orgUrlSlug,
  storeUrlSlug,
  value,
}: {
  acknowledgedKeys: string[];
  buckets: BucketConfig[];
  currency: string;
  onAcknowledgedKeysChange: (keys: string[]) => void;
  onValueChange: (value: BucketStatus) => void;
  orgUrlSlug: string;
  storeUrlSlug: string;
  value: BucketStatus;
}) {
  return (
    <Tabs
      className="space-y-layout-md"
      onValueChange={(nextValue) => {
        const nextBucket = normalizeBucketTab(nextValue);
        if (nextBucket) {
          onValueChange(nextBucket);
        }
      }}
      value={value}
    >
      <TabsList
        aria-label="Opening Handoff buckets"
        className="h-auto w-full flex-wrap justify-start gap-1 border border-border bg-surface-raised p-1 text-muted-foreground shadow-surface"
      >
        {buckets.map((bucket) => (
          <TabsTrigger
            className="min-h-9 gap-2 px-3 data-[state=active]:bg-background"
            key={bucket.value}
            value={bucket.value}
          >
            <span>{bucket.title}</span>
            <span
              className={cn(
                "inline-flex min-w-5 items-center justify-center rounded-full border px-1.5 py-0.5 font-numeric text-[11px] font-semibold leading-none tabular-nums",
                getBucketCountClassName(bucket.status),
              )}
            >
              {bucket.items.length}
            </span>
          </TabsTrigger>
        ))}
      </TabsList>

      {buckets.map((bucket) => (
        <TabsContent className="mt-0" key={bucket.value} value={bucket.value}>
          <BucketSection
            acknowledgedKeys={acknowledgedKeys}
            ariaLabel={bucket.ariaLabel}
            currency={currency}
            description={bucket.description}
            emptyText={bucket.emptyText}
            items={bucket.items}
            onAcknowledgedKeysChange={onAcknowledgedKeysChange}
            orgUrlSlug={orgUrlSlug}
            requiresAcknowledgement={false}
            status={bucket.status}
            storeUrlSlug={storeUrlSlug}
            title={bucket.title}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

function SummaryMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
      <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className="mt-layout-xs text-lg text-foreground">
        {value}
      </p>
    </div>
  );
}

function OpeningRail({
  acknowledgedKeys,
  acknowledgedCount,
  acknowledgementItems,
  commandMessage,
  isBlocked,
  isStarted,
  isStarting,
  notes,
  onAcknowledgedKeysChange,
  onNotesChange,
  onStartDay,
  requiredAcknowledgementCount,
  snapshot,
  status,
}: {
  acknowledgedKeys: string[];
  acknowledgedCount: number;
  acknowledgementItems: DailyOpeningItem[];
  commandMessage?: {
    kind: "error" | "success";
    message: string;
  } | null;
  isBlocked: boolean;
  isStarted: boolean;
  isStarting: boolean;
  notes: string;
  onAcknowledgedKeysChange: (keys: string[]) => void;
  onNotesChange: (notes: string) => void;
  onStartDay: () => void;
  requiredAcknowledgementCount: number;
  snapshot: DailyOpeningSnapshot;
  status: DailyOpeningStatus;
}) {
  const copy = statusCopy[status];
  const acknowledgementComplete =
    acknowledgedCount >= requiredAcknowledgementCount;
  const checklistItems = [
    {
      label: "Resolve blockers",
      tone: snapshot.blockers.length > 0 ? "danger" : "success",
      value: formatCount(snapshot.blockers.length, "blocker", "Clear"),
      valueTone: snapshot.blockers.length > 0 ? "danger" : "plain",
    },
    {
      label: "Review handoff",
      tone: "warning",
      value: formatCount(snapshot.reviewItems.length, "item", "Clear"),
      valueTone: snapshot.reviewItems.length > 0 ? "warning" : "plain",
    },
    {
      label: "Carry forward",
      tone: "workflow",
      value: formatCount(snapshot.carryForwardItems.length, "item", "None"),
      valueTone: snapshot.carryForwardItems.length > 0 ? "workflow" : "plain",
    },
  ];

  return (
    <PageWorkspaceRail>
      <aside className="rounded-lg border border-border bg-surface-raised p-layout-md shadow-surface">
        <div className="flex items-center justify-between gap-layout-md">
          <div className="flex min-w-0 items-center gap-layout-sm">
            <div
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-md",
                getStatusRailIconClassName(status),
              )}
            >
              {isBlocked ? (
                <Ban className="h-4 w-4" />
              ) : (
                <ListChecks className="h-4 w-4" />
              )}
            </div>
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Opening status
            </p>
          </div>
          <p
            className={cn(
              "shrink-0 text-sm font-semibold",
              getStatusRailBadgeClassName(status),
            )}
          >
            {copy.badge}
          </p>
        </div>
        <p className="mt-layout-sm text-sm leading-6 text-muted-foreground">
          {copy.description}
        </p>

        <div className="mt-layout-md border-t border-border pt-layout-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Operating date
          </p>
          <p className="mt-1 text-sm font-medium text-foreground">
            {formatOperatingDate(snapshot.operatingDate)}
          </p>
        </div>

        <div className="mt-layout-md border-t border-border pt-layout-md">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
            Opening checklist
          </p>
          <dl className="mt-layout-sm space-y-layout-sm text-sm">
            {checklistItems.map((item) => (
              <div
                className="flex items-center justify-between gap-layout-md"
                key={item.label}
              >
                <dt className="flex min-w-0 items-center gap-2 text-muted-foreground">
                  <span
                    aria-hidden="true"
                    className={cn(
                      "h-2 w-2 shrink-0 rounded-full",
                      item.tone === "danger" && "bg-danger",
                      item.tone === "warning" && "bg-warning",
                      item.tone === "workflow" && "bg-action-workflow",
                      item.tone === "success" && "bg-success",
                    )}
                  />
                  <span>{item.label}</span>
                </dt>
                <dd
                  className={cn(
                    "shrink-0 text-right font-medium text-foreground",
                    item.valueTone === "danger" && "text-danger",
                    item.valueTone === "warning" && "text-warning-foreground",
                    item.valueTone === "workflow" && "text-action-workflow",
                  )}
                >
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </div>

        {requiredAcknowledgementCount > 0 && !isStarted ? (
          <div className="mt-layout-md rounded-lg border border-warning/30 bg-warning/15 p-layout-sm text-sm leading-6 text-muted-foreground">
            <p>
              Acknowledge {requiredAcknowledgementCount} handoff{" "}
              {requiredAcknowledgementCount === 1 ? "item" : "items"} before
              starting the store day.
            </p>
            <div className="mt-layout-sm space-y-layout-xs">
              {acknowledgementItems.map((item) => {
                const acknowledgementKey = getAcknowledgementKey(item);
                const checkboxId = `daily-opening-acknowledgement-${acknowledgementKey.replace(/[^a-zA-Z0-9_-]/g, "-")}`;

                return (
                  <div
                    className="flex items-start gap-layout-xs rounded-md border border-warning/30 bg-surface-raised/70 p-layout-xs"
                    key={acknowledgementKey}
                  >
                    <Checkbox
                      aria-label={`Acknowledge ${item.title}`}
                      checked={acknowledgedKeys.includes(acknowledgementKey)}
                      className="mt-0.5"
                      id={checkboxId}
                      onCheckedChange={(checked) => {
                        onAcknowledgedKeysChange(
                          checked === true
                            ? [...acknowledgedKeys, acknowledgementKey]
                            : acknowledgedKeys.filter(
                                (key) => key !== acknowledgementKey,
                              ),
                        );
                      }}
                    />
                    <Label
                      className="cursor-pointer text-sm font-medium leading-5"
                      htmlFor={checkboxId}
                    >
                      {item.title}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}

        {isStarted && snapshot.startedOpening ? (
          <div className="mt-layout-lg rounded-lg border border-success/30 bg-success/10 p-layout-sm">
            <p className="text-sm font-medium text-success">
              Opening handoff complete
            </p>
            <dl className="mt-layout-sm space-y-layout-xs text-sm">
              <div className="flex items-start justify-between gap-layout-md">
                <dt className="text-muted-foreground">Started by</dt>
                <dd className="text-right font-medium text-foreground">
                  {snapshot.startedOpening.startedByStaffName ??
                    "Staff unavailable"}
                </dd>
              </div>
              <div className="flex items-start justify-between gap-layout-md">
                <dt className="text-muted-foreground">Started at</dt>
                <dd className="text-right font-medium text-foreground">
                  {formatTimestamp(snapshot.startedOpening.startedAt)}
                </dd>
              </div>
            </dl>
            {snapshot.startedOpening.notes ? (
              <p className="mt-layout-sm text-sm leading-6 text-foreground">
                {snapshot.startedOpening.notes}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="mt-layout-md space-y-layout-sm">
            <label
              className="text-sm font-medium text-foreground"
              htmlFor="daily-opening-notes"
            >
              Opening notes
            </label>
            <textarea
              className="min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              id="daily-opening-notes"
              onChange={(event) => onNotesChange(event.target.value)}
              placeholder="Add a short note for the opening record."
              value={notes}
            />
            <LoadingButton
              className="w-full"
              disabled={isBlocked || !acknowledgementComplete}
              isLoading={isStarting}
              onClick={onStartDay}
              type="button"
              variant="workflow"
            >
              Start Day
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

function LoadingWorkspace() {
  return (
    <div
      aria-label="Loading daily opening workspace"
      className="grid gap-layout-2xl xl:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="space-y-layout-md">
        <div className="h-24 rounded-lg border border-border bg-surface-raised shadow-surface" />
        <div className="h-64 rounded-lg border border-border bg-surface-raised shadow-surface" />
      </div>
      <div className="h-80 rounded-lg border border-border bg-surface-raised shadow-surface" />
    </div>
  );
}

export function DailyOpeningViewContent({
  currency,
  hasFullAdminAccess,
  isAuthenticated,
  isLoadingAccess,
  isLoadingSnapshot,
  isStarting,
  onAuthenticateForApproval,
  onStartDay,
  orgUrlSlug,
  snapshot,
  storeId,
  storeUrlSlug,
}: DailyOpeningViewContentProps) {
  const [acknowledgedKeys, setAcknowledgedKeys] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [isManagerApprovalOpen, setIsManagerApprovalOpen] = useState(false);
  const [commandMessage, setCommandMessage] = useState<{
    kind: "error" | "success";
    message: string;
  } | null>(null);
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: unknown };
  const requiredAcknowledgementKeys = useMemo(
    () => getRequiredAcknowledgementKeys(snapshot),
    [snapshot],
  );
  const acknowledgementItems = useMemo(
    () => [
      ...(snapshot?.reviewItems ?? []),
      ...(snapshot?.carryForwardItems ?? []),
    ],
    [snapshot],
  );
  const openingApproval = useMemo<ApprovalRequirement | null>(() => {
    if (!snapshot || !storeId) return null;

    return {
      action: {
        key: "operations.daily_opening.start_day",
        label: "Start store day",
      },
      copy: {
        title: "Manager approval required",
        message: "Manager approval is required to start the store day.",
        primaryActionLabel: "Start Day",
      },
      reason: "Manager approval is required to start the store day.",
      requiredRole: "manager",
      resolutionModes: [{ kind: "inline_manager_proof" }],
      subject: {
        id: `${storeId}:${snapshot.operatingDate}`,
        label: `Opening ${formatOperatingDate(snapshot.operatingDate)}`,
        type: "daily_opening",
      },
    };
  }, [snapshot, storeId]);

  if (isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <div aria-label="Loading daily opening access" />
        </FadeIn>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before Opening Handoff can load protected store-day data" />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!storeId) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening Opening Handoff."
          title="No active store"
        />
      </div>
    );
  }

  const status = snapshot ? getOpeningStatus(snapshot) : "ready";
  const isBlocked = status === "blocked";
  const isStarted = status === "started";
  const displayCopy = statusCopy[status];
  const buckets = snapshot ? getBucketConfigs(snapshot) : [];
  const defaultBucketValue = snapshot
    ? getDefaultBucketValue(snapshot, status)
    : "ready";
  const selectedBucketValue =
    normalizeBucketTab(search.tab) ?? defaultBucketValue;
  const acknowledgedRequiredCount = requiredAcknowledgementKeys.filter((key) =>
    acknowledgedKeys.includes(key),
  ).length;
  const submitStartDay = async (actorStaffProfileId?: Id<"staffProfile">) => {
    if (!snapshot || isBlocked || isStarted) return;

    const acknowledgementComplete =
      acknowledgedRequiredCount >= requiredAcknowledgementKeys.length;

    if (!acknowledgementComplete) return;

    setCommandMessage(null);

    const result = await onStartDay({
      acknowledgedItemKeys: requiredAcknowledgementKeys,
      ...(actorStaffProfileId ? { actorStaffProfileId } : {}),
      endAt: snapshot.endAt,
      notes,
      operatingDate: snapshot.operatingDate,
      startAt: snapshot.startAt,
    });

    if (result.kind === "ok") {
      setCommandMessage({
        kind: "success",
        message: "Store day started.",
      });
      return;
    }

    setCommandMessage({
      kind: "error",
      message: normalizeCommandMessage(result),
    });
  };

  const handleStartDay = () => {
    if (onAuthenticateForApproval && openingApproval) {
      setCommandMessage(null);
      setIsManagerApprovalOpen(true);
      return;
    }

    void submitStartDay();
  };

  const handleBucketValueChange = (value: BucketStatus) => {
    void navigate({
      search: ((current: Record<string, unknown>) => ({
        ...current,
        tab: value,
      })) as never,
    });
  };

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Operations"
            title="Opening Handoff"
            description="Review prior close handoff, acknowledge carry-forward work, and confirm whether the store day can start."
          />

          {isLoadingSnapshot || !snapshot ? (
            <LoadingWorkspace />
          ) : (
            <PageWorkspace>
              <section className="space-y-layout-lg">
                <div className="flex flex-col gap-layout-md lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-layout-xs">
                    <h2 className={getStatusLabelClassName(status)}>
                      {displayCopy.title}
                    </h2>
                    <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      {displayCopy.description}
                    </p>
                  </div>
                  <div className="rounded-lg border border-border bg-surface-raised px-layout-md py-layout-sm text-sm text-muted-foreground shadow-surface">
                    Operating date{" "}
                    <span className="font-medium text-foreground">
                      {formatOperatingDate(snapshot.operatingDate)}
                    </span>
                  </div>
                </div>

                <div className="grid gap-layout-sm md:grid-cols-2 xl:grid-cols-4">
                  <SummaryMetric
                    label="Prior close"
                    value={
                      snapshot.priorClose
                        ? formatOperatingDate(snapshot.priorClose.operatingDate)
                        : "Not found"
                    }
                  />
                  <SummaryMetric
                    label="Blockers"
                    value={formatCount(
                      snapshot.summary?.blockerCount ??
                        snapshot.blockers.length,
                      "blocker",
                      "No hard blockers",
                    )}
                  />
                  <SummaryMetric
                    label="Needs review"
                    value={formatCount(
                      snapshot.summary?.reviewCount ??
                        snapshot.reviewItems.length,
                      "item",
                      "No review items",
                    )}
                  />
                  <SummaryMetric
                    label="Carry forward"
                    value={formatCount(
                      snapshot.summary?.carryForwardCount ??
                        snapshot.carryForwardItems.length,
                      "item",
                      "No carry-forward items",
                    )}
                  />
                </div>
              </section>

              <PageWorkspaceGrid>
                <PageWorkspaceMain>
                  <BucketTabs
                    acknowledgedKeys={acknowledgedKeys}
                    buckets={buckets}
                    currency={currency}
                    onAcknowledgedKeysChange={setAcknowledgedKeys}
                    onValueChange={handleBucketValueChange}
                    orgUrlSlug={orgUrlSlug}
                    storeUrlSlug={storeUrlSlug}
                    value={selectedBucketValue}
                  />
                </PageWorkspaceMain>

                <OpeningRail
                  acknowledgedKeys={acknowledgedKeys}
                  acknowledgedCount={acknowledgedRequiredCount}
                  acknowledgementItems={acknowledgementItems}
                  commandMessage={commandMessage}
                  isBlocked={isBlocked}
                  isStarted={isStarted}
                  isStarting={isStarting}
                  notes={notes}
                  onAcknowledgedKeysChange={setAcknowledgedKeys}
                  onNotesChange={setNotes}
                  onStartDay={handleStartDay}
                  requiredAcknowledgementCount={
                    requiredAcknowledgementKeys.length
                  }
                  snapshot={snapshot}
                  status={status}
                />
              </PageWorkspaceGrid>
              {onAuthenticateForApproval && openingApproval ? (
                <CommandApprovalDialog
                  approval={openingApproval}
                  onApproved={(result) => {
                    setIsManagerApprovalOpen(false);
                    void submitStartDay(result.approvedByStaffProfileId);
                  }}
                  onAuthenticateForApproval={onAuthenticateForApproval}
                  onDismiss={() => setIsManagerApprovalOpen(false)}
                  open={isManagerApprovalOpen}
                  storeId={storeId}
                />
              ) : null}
            </PageWorkspace>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

function DailyOpeningApiPendingView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Operations"
            title="Opening Handoff"
            description="Opening Handoff is waiting for the server readiness snapshot and start-day command."
          />
          <EmptyState
            description="The frontend is wired to api.operations.dailyOpening.getDailyOpeningSnapshot and startStoreDay."
            title="Opening Handoff server API pending"
          />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}

type DailyOpeningConnectedViewProps = {
  getDailyOpeningSnapshot: unknown;
  startStoreDay: unknown;
};

function DailyOpeningConnectedView({
  getDailyOpeningSnapshot,
  startStoreDay,
}: DailyOpeningConnectedViewProps) {
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
  const [isStarting, setIsStarting] = useState(false);
  const operatingDateRange = useMemo(() => getLocalOperatingDateRange(), []);
  const snapshot = useExpectedDailyOpeningQuery(
    getDailyOpeningSnapshot,
    canQueryProtectedData
      ? { ...operatingDateRange, storeId: activeStore!._id }
      : "skip",
  ) as DailyOpeningSnapshot | undefined;
  const startStoreDayMutation = useExpectedDailyOpeningMutation(startStoreDay);
  const authenticateStaffCredentialForApproval = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );

  async function handleAuthenticateForApproval(args: {
    actionKey: string;
    pinHash: string;
    reason?: string;
    requiredRole: ApprovalRequirement["requiredRole"];
    requestedByStaffProfileId?: Id<"staffProfile">;
    storeId: Id<"store">;
    subject: ApprovalRequirement["subject"];
    username: string;
  }) {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          code: "authentication_failed",
          message: "Select a store before confirming manager credentials.",
        },
      } as NormalizedCommandResult<{
        approvalProofId: Id<"approvalProof">;
        approvedByStaffProfileId: Id<"staffProfile">;
        expiresAt: number;
        requestedByStaffProfileId?: Id<"staffProfile">;
      }>;
    }

    return runCommand(() =>
      authenticateStaffCredentialForApproval({
        actionKey: args.actionKey,
        pinHash: args.pinHash,
        reason: args.reason,
        requiredRole: args.requiredRole,
        requestedByStaffProfileId: args.requestedByStaffProfileId,
        storeId: args.storeId,
        subject: args.subject,
        username: args.username,
      }),
    );
  }

  const handleStartDay = async (args: StartDayArgs) => {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          code: "validation_failed",
          message: "Select a store before starting the store day.",
        },
      } as NormalizedCommandResult<unknown>;
    }

    setIsStarting(true);

    try {
      return await runCommand(
        () =>
          startStoreDayMutation({
            acknowledgedItemKeys: args.acknowledgedItemKeys,
            actorStaffProfileId: args.actorStaffProfileId,
            endAt: args.endAt,
            notes: args.notes || undefined,
            operatingDate: args.operatingDate,
            startAt: args.startAt,
            storeId: activeStore._id,
          }) as Promise<CommandResult<unknown>>,
      );
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <DailyOpeningViewContent
      currency={activeStore?.currency || "USD"}
      hasFullAdminAccess={hasFullAdminAccess}
      isAuthenticated={isAuthenticated}
      isLoadingAccess={isLoadingAccess}
      isLoadingSnapshot={snapshot === undefined}
      isStarting={isStarting}
      onAuthenticateForApproval={handleAuthenticateForApproval}
      onStartDay={handleStartDay}
      orgUrlSlug={params?.orgUrlSlug ?? ""}
      snapshot={snapshot}
      storeId={activeStore?._id}
      storeUrlSlug={params?.storeUrlSlug ?? ""}
    />
  );
}

export function DailyOpeningView() {
  const dailyOpeningApi = getDailyOpeningApi();

  if (
    !dailyOpeningApi.getDailyOpeningSnapshot ||
    !dailyOpeningApi.startStoreDay
  ) {
    return <DailyOpeningApiPendingView />;
  }

  return (
    <DailyOpeningConnectedView
      getDailyOpeningSnapshot={dailyOpeningApi.getDailyOpeningSnapshot}
      startStoreDay={dailyOpeningApi.startStoreDay}
    />
  );
}
