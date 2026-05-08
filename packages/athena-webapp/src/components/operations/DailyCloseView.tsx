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
import { formatReviewReason } from "@/components/cash-controls/formatReviewReason";
import { cn } from "@/lib/utils";
import { toOperatorMessage } from "@/lib/errors/operatorMessages";
import {
  runCommand,
  type NormalizedApprovalCommandResult,
  type NormalizedCommandResult,
} from "@/lib/errors/runCommand";
import { formatStoredAmount } from "@/lib/pos/displayAmounts";
import { getOrigin } from "@/lib/navigationUtils";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type {
  ApprovalCommandResult,
  CommandResult,
} from "~/shared/commandResult";
import type { ApprovalRequirement } from "~/shared/approvalPolicy";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../ui/tabs";
import {
  useApprovedCommand,
  type ApprovalRetryArgs,
} from "./useApprovedCommand";
import { OperationsSummaryMetric } from "./OperationsSummaryMetric";

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
  startAt: number;
  endAt: number;
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
    carriedOverCashTotal?: number | null;
    carriedOverRegisterCount?: number | null;
    cashDeposited?: number | null;
    cashDepositTotal?: number | null;
    cashExpected?: number | null;
    closedRegisterSessionCount?: number | null;
    carryForwardCount?: number | null;
    currentDayCashTransactionCount?: number | null;
    currentDayCashTotal?: number | null;
    expectedCashTotal?: number | null;
    expenseTransactionCount?: number | null;
    expenseStaffCount?: number | null;
    expenseTotal?: number | null;
    netCashVariance?: number | null;
    openWorkItemCount?: number | null;
    paymentTotals?: Array<{
      amount: number;
      method: string;
    }>;
    pendingApprovalCount?: number | null;
    registerCount?: number | null;
    registerVarianceCount?: number | null;
    staffCount?: number | null;
    salesTotal?: number | null;
    totalSales?: number | null;
    transactionCount?: number | null;
    varianceTotal?: number | null;
    voidedTransactionCount?: number | null;
  };
};

type CompletionArgs = {
  approvalProofId?: Id<"approvalProof">;
  carryForwardWorkItemIds: string[];
  endAt: number;
  notes: string;
  operatingDate: string;
  reviewedItemKeys: string[];
  startAt: number;
};

type BucketStatus = "blocked" | "carry-forward" | "ready" | "review";

const bucketTabValues: BucketStatus[] = [
  "blocked",
  "carry-forward",
  "ready",
  "review",
];

type BucketConfig = {
  ariaLabel: string;
  description: string;
  emptyText: string;
  items: DailyCloseItem[];
  status: BucketStatus;
  title: string;
  value: BucketStatus;
};

type DailyCloseViewContentProps = {
  currency: string;
  hasFullAdminAccess: boolean;
  isAuthenticated: boolean;
  isCompleting: boolean;
  isLoadingAccess: boolean;
  isLoadingSnapshot: boolean;
  onComplete: (
    args: CompletionArgs,
  ) => Promise<NormalizedApprovalCommandResult<unknown>>;
  onAuthenticateForApproval?: (args: {
    actionKey: string;
    pinHash: string;
    reason?: string;
    requiredRole: ApprovalRequirement["requiredRole"];
    requestedByStaffProfileId?: Id<"staffProfile">;
    storeId: Id<"store">;
    subject: ApprovalRequirement["subject"];
    username: string;
  }) => Promise<
    NormalizedCommandResult<{
      approvalProofId: Id<"approvalProof">;
      approvedByStaffProfileId: Id<"staffProfile">;
      expiresAt: number;
      requestedByStaffProfileId?: Id<"staffProfile">;
    }>
  >;
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
      "Resolve blocker items before the operating day can be marked closed.",
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
    description: "The operating day has a saved close summary.",
    title: "End-of-day review completed",
  },
  needs_review: {
    badge: "Needs review",
    description: "Review exceptions before completing the operating-day close.",
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
    (
      api.operations as typeof api.operations & {
        dailyClose?: DailyCloseApi;
      }
    ).dailyClose ?? {}
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

function formatChecklistCount(
  value: number,
  singular: string,
  clearLabel = "Clear",
  plural = `${singular}s`,
) {
  if (value === 0) return clearLabel;
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

function getStatusLabelClassName(status: DailyCloseStatus) {
  return cn(
    "inline-flex w-fit rounded-md px-layout-sm py-1 text-base font-medium",
    status === "blocked" && "bg-danger/10 text-danger",
    status === "needs_review" && "bg-warning/15 text-warning-foreground",
    status === "carry_forward" &&
      "bg-action-workflow-soft text-action-workflow",
    (status === "ready" || status === "completed") &&
      "bg-success/10 text-success",
  );
}

function getStatusRailIconClassName(status: DailyCloseStatus) {
  return cn(
    status === "blocked" && "bg-danger/10 text-danger",
    status === "needs_review" && "bg-warning/15 text-warning-foreground",
    status === "carry_forward" &&
      "bg-action-workflow-soft text-action-workflow",
    (status === "ready" || status === "completed") &&
      "bg-success/10 text-success",
  );
}

function getStatusRailBadgeClassName(status: DailyCloseStatus) {
  return cn(
    status === "blocked" && "text-danger",
    status === "needs_review" && "text-warning-foreground",
    status === "carry_forward" && "text-action-workflow",
    (status === "ready" || status === "completed") && "text-success",
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

function formatExpenseTransactionCount(value: number) {
  if (value === 0) return "No expense transactions";
  if (value === 1) return "1 expense transaction";
  return `${value} expense transactions`;
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
    operatingDate: getLocalOperatingDate(date),
    startAt: localStart.getTime(),
    endAt: localEnd.getTime(),
  };
}

function normalizeCommandMessage(
  result: Exclude<
    NormalizedApprovalCommandResult<unknown>,
    { kind: "approval_required" | "ok" }
  >,
) {
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
  return (
    item.id ??
    item.key ??
    `${item.subject?.type ?? "item"}:${item.subject?.id ?? item.title}`
  );
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

function getItemContextLabel(item: DailyCloseItem) {
  return item.category
    ? humanizeMetadataLabel(item.category)
    : item.subject?.type
      ? humanizeMetadataLabel(item.subject.type)
      : "Close item";
}

function humanizeMetadataLabel(label: string) {
  return label
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

const moneyMetadataLabels = new Set([
  "amount",
  "changegiven",
  "countedcash",
  "expectedcash",
  "total",
  "totalpaid",
  "variance",
]);

const timestampMetadataLabels = new Set([
  "completedat",
  "createdat",
  "expiredat",
  "expiresat",
  "heldat",
  "openedat",
  "requestedat",
  "closedat",
  "voidedat",
]);

const metadataLabelOrder = [
  "approval",
  "transaction",
  "report",
  "session",
  "terminal",
  "register",
  "requestedby",
  "requestedat",
  "operatingscope",
  "openedat",
  "openedby",
  "owner",
  "customer",
  "reason",
  "notes",
  "paymentmethods",
  "currentmethod",
  "requestedmethod",
  "amount",
  "expectedcash",
  "countedcash",
  "status",
  "total",
  "totalpaid",
  "changegiven",
  "closedby",
  "closedat",
  "expiredat",
  "expiresat",
  "heldat",
  "variance",
  "voidedat",
  "completedat",
];

const metadataLabelsByCategory: Record<string, string[]> = {
  approval: [
    "approval",
    "register",
    "terminal",
    "transaction",
    "requestedBy",
    "requestedAt",
    "reason",
    "notes",
    "openedAt",
    "currentMethod",
    "requestedMethod",
    "expectedCash",
    "countedCash",
    "status",
    "variance",
    "amount",
    "closedAt",
  ],
  cashvariance: [
    "terminal",
    "register",
    "operatingScope",
    "openedAt",
    "expectedCash",
    "countedCash",
    "status",
    "variance",
    "closedAt",
  ],
  possession: [
    "session",
    "terminal",
    "owner",
    "customer",
    "status",
    "total",
    "expiresAt",
    "heldAt",
  ],
  registersession: [
    "terminal",
    "register",
    "operatingScope",
    "openedAt",
    "openedBy",
    "expectedCash",
    "countedCash",
    "status",
    "variance",
    "closedAt",
    "closedBy",
  ],
  sale: [
    "transaction",
    "terminal",
    "owner",
    "customer",
    "paymentMethods",
    "total",
    "totalPaid",
    "changeGiven",
    "completedAt",
  ],
  expense: [
    "report",
    "terminal",
    "register",
    "owner",
    "total",
    "completedAt",
    "notes",
  ],
  voidedsale: [
    "transaction",
    "terminal",
    "owner",
    "customer",
    "paymentMethods",
    "total",
    "totalPaid",
    "voidedAt",
    "completedAt",
  ],
};

function normalizeMetadataLabel(label: string) {
  return label.replace(/[\s_-]+/g, "").toLowerCase();
}

function isMoneyMetadataLabel(label: string) {
  return moneyMetadataLabels.has(normalizeMetadataLabel(label));
}

function isTimestampMetadataLabel(label: string) {
  return timestampMetadataLabels.has(normalizeMetadataLabel(label));
}

function getVarianceTone(variance?: number) {
  if (!variance) {
    return "text-foreground";
  }

  return variance > 0 ? "text-success" : "text-danger";
}

function getNumericMetadataValue(value: unknown) {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value !== "string" || value.trim() === "") {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}

function shouldShowMetadataEntry(label: string, value: unknown) {
  const normalizedLabel = normalizeMetadataLabel(label);

  if (normalizedLabel === "transactionid") {
    return false;
  }

  if (normalizedLabel === "variance") {
    const variance = getNumericMetadataValue(value);
    return variance !== 0;
  }

  return true;
}

function formatTimestampMetadata(value: number) {
  return new Date(value).toLocaleString([], {
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function getDisplayMetadataLabel(label: string, value: unknown) {
  if (normalizeMetadataLabel(label) === "owner") {
    return "Staff";
  }

  if (
    normalizeMetadataLabel(label) === "expiresat" &&
    typeof value === "number" &&
    value < Date.now()
  ) {
    return "Expired At";
  }

  return humanizeMetadataLabel(label);
}

function getMetadataStringValue(
  metadata: DailyCloseItem["metadata"],
  label: string,
) {
  if (!metadata || Array.isArray(metadata)) return undefined;

  const value = metadata[label];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function getMetadataValue(metadata: Record<string, unknown>, label: string) {
  const normalizedLabel = normalizeMetadataLabel(label);

  return Object.entries(metadata).find(
    ([entryLabel]) => normalizeMetadataLabel(entryLabel) === normalizedLabel,
  );
}

function formatMetadataValue(label: string, value: unknown, currency: string) {
  if (value === null || value === undefined || value === "") return "Not set";

  const normalizedLabel = normalizeMetadataLabel(label);

  if (typeof value === "number") {
    if (normalizedLabel === "transaction") {
      return `#${value}`;
    }

    if (isTimestampMetadataLabel(label)) {
      return formatTimestampMetadata(value);
    }

    return isMoneyMetadataLabel(label)
      ? formatMoney(currency, value)
      : String(value);
  }

  if (typeof value === "boolean") {
    return String(value);
  }

  if (typeof value === "string") {
    const numericValue = Number(value);

    if (normalizedLabel === "transaction") {
      return value.startsWith("#") ? value : `#${value}`;
    }

    if (normalizedLabel === "report") {
      return value.startsWith("#") ? value : `#${value}`;
    }

    if (
      isMoneyMetadataLabel(label) &&
      value.trim() !== "" &&
      Number.isFinite(numericValue)
    ) {
      return formatMoney(currency, numericValue);
    }

    if (normalizedLabel === "status") {
      return humanizeMetadataLabel(value);
    }

    if (normalizedLabel === "reason") {
      return formatReviewReason(currencyFormatter(currency), value) ?? value;
    }

    return value;
  }

  return JSON.stringify(value);
}

function formatMetadataDisplayValue({
  currency,
  item,
  label,
  orgUrlSlug,
  storeUrlSlug,
  value,
}: {
  currency: string;
  item: DailyCloseItem;
  label: string;
  orgUrlSlug: string;
  storeUrlSlug: string;
  value: unknown;
}): ReactNode {
  const formattedValue = formatMetadataValue(label, value, currency);
  const transactionId =
    getMetadataStringValue(item.metadata, "transactionId") ??
    (item.subject?.type === "pos_transaction" ? item.subject.id : undefined);
  const reportId =
    getMetadataStringValue(item.metadata, "reportId") ??
    (item.subject?.type === "expense_transaction" ? item.subject.id : undefined);

  if (normalizeMetadataLabel(label) === "transaction" && transactionId) {
    return (
      <Link
        className="inline-flex items-center gap-1 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        params={
          {
            orgUrlSlug,
            storeUrlSlug,
            transactionId,
          } as never
        }
        search={{ o: getOrigin() } as never}
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
      >
        {formattedValue}
        <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
      </Link>
    );
  }

  if (normalizeMetadataLabel(label) === "report" && reportId) {
    return (
      <Link
        className="inline-flex items-center gap-1 text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
        params={
          {
            orgUrlSlug,
            storeUrlSlug,
            reportId,
          } as never
        }
        search={{ o: getOrigin() } as never}
        to="/$orgUrlSlug/store/$storeUrlSlug/pos/expense-reports/$reportId"
      >
        {formattedValue}
        <ArrowUpRight aria-hidden="true" className="h-3 w-3" />
      </Link>
    );
  }

  if (normalizeMetadataLabel(label) === "variance") {
    const variance = getNumericMetadataValue(value);

    if (variance !== null) {
      return (
        <span
          className={cn("font-numeric tabular-nums", getVarianceTone(variance))}
        >
          {formattedValue}
        </span>
      );
    }
  }

  return formattedValue;
}

function getMetadataEntries(
  item: DailyCloseItem,
  currency: string,
  orgUrlSlug: string,
  storeUrlSlug: string,
) {
  if (!item.metadata) return [];
  const registerLabel =
    normalizeMetadataLabel(item.category ?? item.subject?.type ?? "") ===
    "registersession"
      ? item.subject?.label
      : undefined;
  const categoryKey = normalizeMetadataLabel(
    item.category ?? item.subject?.type ?? "",
  );
  const preferredLabels = metadataLabelsByCategory[categoryKey] ?? [];

  const sortEntries = (
    entries: Array<{
      label: string;
      value: ReactNode;
    }>,
  ) =>
    entries.sort((left, right) => {
      const leftIndex = metadataLabelOrder.indexOf(
        normalizeMetadataLabel(left.label),
      );
      const rightIndex = metadataLabelOrder.indexOf(
        normalizeMetadataLabel(right.label),
      );

      return (
        (leftIndex === -1 ? 100 : leftIndex) -
        (rightIndex === -1 ? 100 : rightIndex)
      );
    });
  const combineTerminalAndRegister = (
    entries: Array<{
      label: string;
      value: ReactNode;
    }>,
  ) => {
    const hasExplicitRegister = entries.some(
      (entry) => normalizeMetadataLabel(entry.label) === "register",
    );
    const appendRegister = (value: ReactNode, nextRegisterLabel: ReactNode) => (
      <>
        {value} / {nextRegisterLabel}
      </>
    );

    let combinedEntries = entries.map((entry) =>
      registerLabel &&
      normalizeMetadataLabel(entry.label) === "terminal" &&
      !hasExplicitRegister
        ? { ...entry, value: appendRegister(entry.value, registerLabel) }
        : entry,
    );
    const terminalEntry = combinedEntries.find(
      (entry) => normalizeMetadataLabel(entry.label) === "terminal",
    );
    const registerEntry = combinedEntries.find(
      (entry) => normalizeMetadataLabel(entry.label) === "register",
    );

    if (terminalEntry && registerEntry) {
      combinedEntries = combinedEntries.flatMap((entry) => {
        const normalizedLabel = normalizeMetadataLabel(entry.label);

        if (normalizedLabel === "terminal") {
          return [
            {
              ...entry,
              value: appendRegister(entry.value, registerEntry.value),
            },
          ];
        }

        return normalizedLabel === "register" ? [] : [entry];
      });
    }

    if (
      registerLabel &&
      !combinedEntries.some(
        (entry) => normalizeMetadataLabel(entry.label) === "terminal",
      ) &&
      !combinedEntries.some(
        (entry) => normalizeMetadataLabel(entry.label) === "register",
      )
    ) {
      return [
        ...combinedEntries,
        {
          label: "Register",
          value: registerLabel,
        },
      ];
    }

    return combinedEntries;
  };

  if (Array.isArray(item.metadata)) {
    return sortEntries(
      combineTerminalAndRegister(
        item.metadata
          .filter((entry) => shouldShowMetadataEntry(entry.label, entry.value))
          .map((entry) => ({
            label: getDisplayMetadataLabel(entry.label, entry.value),
            value: formatMetadataDisplayValue({
              currency,
              item,
              label: entry.label,
              orgUrlSlug,
              storeUrlSlug,
              value: entry.value,
            }),
          })),
      ),
    );
  }

  const objectMetadata = item.metadata;
  const metadataEntries = preferredLabels.length
    ? preferredLabels
        .map((preferredLabel) => {
          const entry = getMetadataValue(objectMetadata, preferredLabel);

          if (!entry) return null;

          const [label, value] = entry;

          if (!shouldShowMetadataEntry(label, value)) return null;

          return {
            label: getDisplayMetadataLabel(label, value),
            value: formatMetadataDisplayValue({
              currency,
              item,
              label,
              orgUrlSlug,
              storeUrlSlug,
              value,
            }),
          };
        })
        .filter((entry): entry is { label: string; value: ReactNode } =>
          Boolean(entry),
        )
    : Object.entries(objectMetadata)
        .filter(([label, value]) => shouldShowMetadataEntry(label, value))
        .map(([label, value]) => ({
          label: getDisplayMetadataLabel(label, value),
          value: formatMetadataDisplayValue({
            currency,
            item,
            label,
            orgUrlSlug,
            storeUrlSlug,
            value,
          }),
        }));

  return sortEntries(
    combineTerminalAndRegister(metadataEntries),
  );
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

function getSummaryRegisterVarianceCount(
  summary: DailyCloseSnapshot["summary"],
) {
  if (typeof summary.registerVarianceCount === "number") {
    return summary.registerVarianceCount;
  }

  const variance = getSummaryAmount(
    summary,
    "varianceTotal",
    "netCashVariance",
  );
  return variance === 0 ? 0 : 1;
}

function getExpenseStaffCount(summary: DailyCloseSnapshot["summary"]) {
  if (typeof summary.expenseStaffCount === "number") {
    return summary.expenseStaffCount;
  }

  if (summary.expenseTotal === 0) {
    return 0;
  }

  return typeof summary.staffCount === "number" ? summary.staffCount : 0;
}

function getExpenseTransactionCount(summary: DailyCloseSnapshot["summary"]) {
  if (typeof summary.expenseTransactionCount === "number") {
    return summary.expenseTransactionCount;
  }

  if (summary.expenseTotal === 0) {
    return 0;
  }

  return typeof summary.expenseStaffCount === "number"
    ? summary.expenseStaffCount
    : 0;
}

function isZeroActivityDailyClose(snapshot: DailyCloseSnapshot) {
  return (
    snapshot.blockers.length === 0 &&
    snapshot.reviewItems.length === 0 &&
    snapshot.carryForwardItems.length === 0 &&
    snapshot.readyItems.length === 0 &&
    getSummaryCount(snapshot.summary, "transactionCount", "transactionCount") ===
      0 &&
    getSummaryCount(
      snapshot.summary,
      "currentDayCashTransactionCount",
      "transactionCount",
    ) === 0 &&
    getSummaryCount(
      snapshot.summary,
      "carriedOverRegisterCount",
      "carriedOverRegisterCount",
    ) === 0 &&
    getExpenseStaffCount(snapshot.summary) === 0 &&
    getSummaryRegisterVarianceCount(snapshot.summary) === 0 &&
    getSummaryAmount(snapshot.summary, "totalSales", "salesTotal") === 0 &&
    getSummaryAmount(
      snapshot.summary,
      "currentDayCashTotal",
      "cashExpected",
    ) === 0 &&
    getSummaryAmount(
      snapshot.summary,
      "carriedOverCashTotal",
      "carriedOverCashTotal",
    ) === 0 &&
    snapshot.summary.expenseTotal === 0 &&
    getSummaryAmount(snapshot.summary, "varianceTotal", "netCashVariance") ===
      0
  );
}

function getStatusDisplayCopy(
  snapshot: DailyCloseSnapshot,
  status: DailyCloseStatus,
) {
  if (status === "ready" && isZeroActivityDailyClose(snapshot)) {
    return {
      ...statusCopy.ready,
      title: "No activity to close",
      description:
        "No sales, register activity, expenses, or follow-ups were recorded for this operating day.",
    };
  }

  return statusCopy[status];
}

function getDefaultBucketValue(
  snapshot: DailyCloseSnapshot,
  status: DailyCloseStatus,
): BucketStatus {
  if (snapshot.blockers.length > 0) return "blocked";
  if (status === "needs_review") return "review";
  if (status === "carry_forward") return "carry-forward";
  return "ready";
}

function normalizeBucketTab(value: unknown): BucketStatus | null {
  return typeof value === "string" &&
    bucketTabValues.includes(value as BucketStatus)
    ? (value as BucketStatus)
    : null;
}

function getBucketConfigs(snapshot: DailyCloseSnapshot): BucketConfig[] {
  const readyEmptyText = isZeroActivityDailyClose(snapshot)
    ? "No activity was recorded for this operating day."
    : "Ready items will appear after close inputs are reconciled.";

  return [
    {
      ariaLabel: "Blocked close items",
      description: "These items keep the operating day from closing cleanly.",
      emptyText: "No hard blockers are currently reported.",
      items: snapshot.blockers,
      status: "blocked",
      title: "Blocked",
      value: "blocked",
    },
    {
      ariaLabel: "Review before close",
      description:
        "These items stay visible in the close summary after review.",
      emptyText: "No review items are currently reported.",
      items: snapshot.reviewItems,
      status: "review",
      title: "Needs review",
      value: "review",
    },
    {
      ariaLabel: "Carry-forward items",
      description:
        "Selected items are preserved for follow-up during the next opening workflow.",
      emptyText: "No carry-forward items are currently reported.",
      items: snapshot.carryForwardItems,
      status: "carry-forward",
      title: "Carry forward",
      value: "carry-forward",
    },
    {
      ariaLabel: "Ready close items",
      description:
        "Completed close inputs that support the operating-day summary.",
      emptyText: readyEmptyText,
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
  currency,
  item,
  orgUrlSlug,
  selectable,
  selected,
  storeUrlSlug,
  onSelectedChange,
}: {
  currency: string;
  item: DailyCloseItem;
  onSelectedChange?: (selected: boolean) => void;
  orgUrlSlug: string;
  selectable?: boolean;
  selected?: boolean;
  storeUrlSlug: string;
}) {
  const itemId = getItemId(item);
  const contextLabel = getItemContextLabel(item);
  const description = getItemDescription(item);
  const metadataEntries = getMetadataEntries(
    item,
    currency,
    orgUrlSlug,
    storeUrlSlug,
  );
  const hasSourceLink = Boolean(item.link);

  return (
    <article className="rounded-lg border border-border/80 bg-surface-raised p-layout-md shadow-surface transition-[border-color,box-shadow] hover:border-border">
      <div className="flex flex-col gap-layout-md md:flex-row md:items-start md:justify-between">
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
          <div className="min-w-0 space-y-layout-xs">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                {contextLabel}
              </p>
            </div>
            <p className="font-medium text-foreground">{item.title}</p>
            {description ? (
              <p className="text-sm leading-6 text-muted-foreground">
                {description}
              </p>
            ) : null}
          </div>
        </div>

        {hasSourceLink ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 md:justify-end">
            <ItemLink
              link={item.link}
              orgUrlSlug={orgUrlSlug}
              storeUrlSlug={storeUrlSlug}
            />
          </div>
        ) : null}
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
  ariaLabel,
  currency,
  description,
  emptyText,
  items,
  orgUrlSlug,
  selectedIds,
  showCountBadge = true,
  status,
  storeUrlSlug,
  title,
  onSelectedIdsChange,
}: {
  ariaLabel: string;
  currency: string;
  description: string;
  emptyText: string;
  items: DailyCloseItem[];
  onSelectedIdsChange?: (ids: string[]) => void;
  orgUrlSlug: string;
  selectedIds?: string[];
  showCountBadge?: boolean;
  status: "blocked" | "carry-forward" | "ready" | "review";
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
        {showCountBadge ? (
          <Badge className={getBucketCountClassName(status)} variant="outline">
            {items.length}
          </Badge>
        ) : null}
      </div>

      <div className="space-y-layout-md bg-surface p-layout-md">
        {items.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border bg-surface-raised p-layout-md text-sm text-muted-foreground shadow-sm">
            {emptyText}
          </p>
        ) : (
          items.map((item) => {
            const selectionId = getCarryForwardWorkItemId(item);

            return (
              <DailyCloseItemCard
                currency={currency}
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

function BucketTabs({
  buckets,
  currency,
  value,
  orgUrlSlug,
  selectedIds,
  storeUrlSlug,
  onValueChange,
  onSelectedIdsChange,
}: {
  buckets: BucketConfig[];
  currency: string;
  value: BucketStatus;
  onValueChange: (value: BucketStatus) => void;
  onSelectedIdsChange: (ids: string[]) => void;
  orgUrlSlug: string;
  selectedIds: string[];
  storeUrlSlug: string;
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
        aria-label="End-of-day review buckets"
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
            ariaLabel={bucket.ariaLabel}
            currency={currency}
            description={bucket.description}
            emptyText={bucket.emptyText}
            items={bucket.items}
            onSelectedIdsChange={
              bucket.value === "carry-forward" ? onSelectedIdsChange : undefined
            }
            orgUrlSlug={orgUrlSlug}
            selectedIds={
              bucket.value === "carry-forward" ? selectedIds : undefined
            }
            showCountBadge={false}
            status={bucket.status}
            storeUrlSlug={storeUrlSlug}
            title={bucket.title}
          />
        </TabsContent>
      ))}
    </Tabs>
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
  const checklistItems = [
    {
      label: "Resolve blockers",
      tone: snapshot.blockers.length > 0 ? "danger" : "success",
      value: formatChecklistCount(snapshot.blockers.length, "blocker"),
      valueTone: snapshot.blockers.length > 0 ? "danger" : "plain",
    },
    {
      label: "Review exceptions",
      tone: "warning",
      value: formatChecklistCount(snapshot.reviewItems.length, "item"),
      valueTone: snapshot.reviewItems.length > 0 ? "warning" : "plain",
    },
    {
      label: "Carry forward",
      tone: "workflow",
      value: formatChecklistCount(
        snapshot.carryForwardItems.length,
        "item",
        "None",
      ),
      valueTone:
        snapshot.carryForwardItems.length > 0 ? "workflow" : "plain",
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
              Close status
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
            Close checklist
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
                      item.tone === "muted" && "bg-muted-foreground/35",
                    )}
                  />
                  <span>{item.label}</span>
                </dt>
                <dd
                  className={cn(
                    "shrink-0 text-right font-medium text-foreground",
                    item.valueTone === "danger" && "text-danger",
                    item.valueTone === "warning" &&
                      "text-warning-foreground",
                    item.valueTone === "workflow" && "text-action-workflow",
                  )}
                >
                  {item.value}
                </dd>
              </div>
            ))}
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
              Complete End-of-Day Review
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
  onAuthenticateForApproval,
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
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as { tab?: unknown };
  const carryForwardWorkItemIds = useMemo(
    () => getCarryForwardWorkItemIds(snapshot?.carryForwardItems ?? []),
    [snapshot?.carryForwardItems],
  );
  const selectedIds =
    selectedCarryForwardIds !== null
      ? selectedCarryForwardIds
      : carryForwardWorkItemIds;
  const completionApprovalRunner = useApprovedCommand({
    storeId,
    onAuthenticateForApproval:
      onAuthenticateForApproval ??
      (() =>
        Promise.resolve({
          kind: "user_error",
          error: {
            code: "unavailable",
            message: "Manager approval is not available yet.",
          },
        })),
  });

  if (isLoadingAccess) {
    return (
      <View hideBorder hideHeaderBottomBorder scrollMode="page">
        <FadeIn className="container mx-auto py-layout-xl">
          <div aria-label="Loading end-of-day review access" />
        </FadeIn>
      </View>
    );
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before End-of-Day Review can load protected operating-day data" />
    );
  }

  if (!hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!storeId) {
    return (
      <div className="container mx-auto py-8">
        <EmptyState
          description="Select a store before opening End-of-Day Review."
          title="No active store"
        />
      </div>
    );
  }

  const status = snapshot ? getDailyCloseStatus(snapshot) : "ready";
  const isBlocked = status === "blocked";
  const isCompleted = status === "completed";
  const displayCopy = snapshot
    ? getStatusDisplayCopy(snapshot, status)
    : statusCopy[status];
  const buckets = snapshot ? getBucketConfigs(snapshot) : [];
  const defaultBucketValue = snapshot
    ? getDefaultBucketValue(snapshot, status)
    : "ready";
  const selectedBucketValue =
    normalizeBucketTab(search.tab) ?? defaultBucketValue;

  const handleComplete = async () => {
    if (!snapshot || isBlocked || isCompleted) return;

    setCommandMessage(null);

    const completionArgs = {
      carryForwardWorkItemIds: selectedIds,
      endAt: snapshot.endAt,
      notes,
      operatingDate: snapshot.operatingDate,
      reviewedItemKeys: getReviewedItemKeys(snapshot.reviewItems),
      startAt: snapshot.startAt,
    };

    const result = await completionApprovalRunner.run({
      execute: (approvalArgs: ApprovalRetryArgs) =>
        onComplete({
          ...completionArgs,
          ...(approvalArgs.approvalProofId
            ? { approvalProofId: approvalArgs.approvalProofId }
            : {}),
        }),
      onResult: (commandResult) => {
        if (commandResult.kind === "approval_required") {
          return;
        }

        if (commandResult.kind === "ok") {
          setCommandMessage({
            kind: "success",
            message: "End-of-day review completed.",
          });
          return;
        }

        setCommandMessage({
          kind: "error",
          message: normalizeCommandMessage(commandResult),
        });
      },
    });

    if (result.kind === "approval_required") return;
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
            eyebrow="Store Ops"
            title="End-of-Day Review"
            description="Review the operating day, resolve blockers, and preserve follow-ups before saving the close summary."
          />

          {isLoadingSnapshot || !snapshot ? null : (
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

                <div className="grid gap-layout-sm md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                  <OperationsSummaryMetric
                    helper={formatEntityCount(
                      getSummaryCount(
                        snapshot.summary,
                        "transactionCount",
                        "transactionCount",
                      ),
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
                      currency,
                      getSummaryAmount(
                        snapshot.summary,
                        "totalSales",
                        "salesTotal",
                      ),
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatTodayCashTransactionCount(
                      getSummaryCount(
                        snapshot.summary,
                        "currentDayCashTransactionCount",
                        "transactionCount",
                      ),
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
                      currency,
                      getSummaryAmount(
                        snapshot.summary,
                        "currentDayCashTotal",
                        "cashExpected",
                      ),
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatCarriedOverRegisterCount(
                      getSummaryCount(
                        snapshot.summary,
                        "carriedOverRegisterCount",
                        "carriedOverRegisterCount",
                      ),
                    )}
                    label="Carried-over cash"
                    value={formatMoney(
                      currency,
                      getSummaryAmount(
                        snapshot.summary,
                        "carriedOverCashTotal",
                        "carriedOverCashTotal",
                      ),
                    )}
                  />
                  <OperationsSummaryMetric
                    helper={formatExpenseTransactionCount(
                      getExpenseTransactionCount(snapshot.summary),
                    )}
                    label="Expenses"
                    value={formatMoney(currency, snapshot.summary.expenseTotal)}
                  />
                  <OperationsSummaryMetric
                    helper={formatRegisterVarianceCount(
                      getSummaryRegisterVarianceCount(snapshot.summary),
                    )}
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
                  <BucketTabs
                    buckets={buckets}
                    currency={currency}
                    onSelectedIdsChange={setSelectedCarryForwardIds}
                    onValueChange={handleBucketValueChange}
                    orgUrlSlug={orgUrlSlug}
                    selectedIds={selectedIds}
                    storeUrlSlug={storeUrlSlug}
                    value={selectedBucketValue}
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
      {completionApprovalRunner.dialog}
    </View>
  );
}

function DailyCloseApiPendingView() {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store Ops"
            title="End-of-Day Review"
            description="End-of-Day Review is waiting for the server close snapshot and completion command."
          />
          <EmptyState
            description="The frontend is wired to api.operations.dailyClose.getDailyCloseSnapshot and completeDailyClose."
            title="End-of-Day Review server API pending"
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
  const operatingDateRange = useMemo(() => getLocalOperatingDateRange(), []);
  const snapshot = useExpectedDailyCloseQuery(
    getDailyCloseSnapshot,
    canQueryProtectedData
      ? { ...operatingDateRange, storeId: activeStore!._id }
      : "skip",
  ) as DailyCloseSnapshot | undefined;
  const completeDailyCloseMutation =
    useExpectedDailyCloseMutation(completeDailyClose);
  const authenticateForApproval = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );

  const handleComplete = async (args: CompletionArgs) => {
    if (!activeStore?._id) {
      return {
        kind: "user_error",
        error: {
          code: "validation_failed",
          message: "Select a store before completing End-of-Day Review.",
        },
      } as NormalizedCommandResult<unknown>;
    }

    setIsCompleting(true);

    try {
      return await runCommand(
        () =>
          completeDailyCloseMutation({
            approvalProofId: args.approvalProofId,
            carryForwardWorkItemIds: args.carryForwardWorkItemIds,
            endAt: args.endAt,
            notes: args.notes || undefined,
            operatingDate: args.operatingDate,
            reviewedItemKeys: args.reviewedItemKeys,
            startAt: args.startAt,
            storeId: activeStore._id,
          }) as Promise<ApprovalCommandResult<unknown>>,
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
      onAuthenticateForApproval={(args) =>
        runCommand(
          () =>
            authenticateForApproval({
              actionKey: args.actionKey,
              pinHash: args.pinHash,
              reason: args.reason,
              requiredRole: args.requiredRole,
              requestedByStaffProfileId: args.requestedByStaffProfileId,
              storeId: args.storeId,
              subject: args.subject,
              username: args.username,
            }) as Promise<
              CommandResult<{
                approvalProofId: Id<"approvalProof">;
                approvedByStaffProfileId: Id<"staffProfile">;
                expiresAt: number;
                requestedByStaffProfileId?: Id<"staffProfile">;
              }>
            >,
        )
      }
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
