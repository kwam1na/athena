import {
  Link,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";
import * as AccordionPrimitive from "@radix-ui/react-accordion";
import type { FunctionReference } from "convex/server";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowUpRight,
  Banknote,
  ChevronDown,
  CreditCard,
  Receipt,
  RotateCcw,
  Smartphone,
  WalletCards,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

import { useAuth } from "@/hooks/useAuth";
import { useProtectedAdminPageState } from "@/hooks/useProtectedAdminPageState";
import {
  StaffAuthenticationDialog,
  type StaffAuthenticationResult,
} from "@/components/staff-auth/StaffAuthenticationDialog";
import {
  CommandApprovalDialog,
  type CommandApprovalDialogProps,
  CommandApprovalApprovedResult,
  CommandApprovalProofResult,
} from "@/components/operations/CommandApprovalDialog";
import { toApprovalRequesterBindingArg } from "@/components/operations/approvalRequesterBinding";
import { useApprovedCommand } from "@/components/operations/useApprovedCommand";
import {
  isApprovalRequiredResult,
  type NormalizedCommandResult,
  type NormalizedApprovalCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";
import { getOrigin } from "@/lib/navigationUtils";
import {
  capitalizeFirstLetter,
  capitalizeWords,
  cn,
  currencyFormatter,
} from "@/lib/utils";
import {
  formatStoredCurrencyAmount,
  parseDisplayAmountInput,
} from "@/lib/pos/displayAmounts";
import {
  formatPendingCashVoidNotice,
  getPendingCashVoidContext,
} from "@/lib/cashControls/pendingCashVoidPresentation";
import { formatRegisterSessionCode } from "@/lib/pos/presentation/registerSessionCode";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import { toDisplayAmount } from "~/convex/lib/currency";
import { userError, type CommandResult } from "~/shared/commandResult";
import type {
  ApprovalRequesterBinding,
  ApprovalRequirement,
} from "~/shared/approvalPolicy";
import { currencyDisplaySymbol } from "~/shared/currencyFormatter";
import { formatStaffDisplayName } from "~/shared/staffDisplayName";
import View from "../View";
import { FadeIn } from "../common/FadeIn";
import { FinancialValue } from "../common/FinancialValue";
import { ListPagination } from "../common/ListPagination";
import { ComposedPageHeader } from "../common/PageHeader";
import { RegisterSessionIdentity } from "../common/RegisterSessionIdentity";
import { formatRegisterHeaderName } from "../common/registerSessionIdentityPresentation";
import { EmptyState } from "../states/empty/empty-state";
import { NoPermissionView } from "../states/no-permission/NoPermissionView";
import { ProtectedAdminSignInView } from "../states/signed-out/ProtectedAdminSignInView";
import { formatReviewReason } from "./formatReviewReason";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { LoadingButton } from "../ui/loading-button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../ui/table";
import { Textarea } from "../ui/textarea";
import { WorkflowTraceRouteLink } from "../traces/WorkflowTraceRouteLink";
import { Accordion, AccordionContent, AccordionItem } from "../ui/accordion";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../ui/sheet";
import { ItemsBreakdown } from "../store-pulse/StorePulseSummaryView";
import {
  buildPosSyncStatusPresentation,
  formatPosReconciliationType,
  isDuplicateLocalIdReviewItem,
  isDuplicatePosSessionSaleReviewItem,
  isRegisterCloseoutReviewItem,
  type PosReconciliationItem,
  type PosSyncStatusPresentation,
} from "@/lib/pos/presentation/syncStatusPresentation";

const LINKED_TRANSACTIONS_PREVIEW_LIMIT = 5;
const REGISTER_SESSION_ACTIVITY_PAGE_SIZE = 10;
const CLOSED_REGISTER_SYNCED_CLOSEOUT_SUMMARY =
  "register session is not open for synced pos closeout";
const REGISTER_NOT_OPEN_SYNC_REVIEW_SUMMARY =
  "Register was not open before this sale synced.";
const MISSING_REGISTER_SESSION_MAPPING_SYNC_REVIEW_SUMMARY =
  "Register session mapping is missing for synced POS history.";
const STAFF_ACCESS_SYNC_REVIEW_SUMMARY =
  "Staff access changed before this POS history synced.";
const SERVICE_CUSTOMER_ATTRIBUTION_SYNC_REVIEW_SUMMARY =
  "Service line is missing customer attribution.";
const HEADER_METADATA_TRANSITION = {
  duration: 0.14,
  ease: "easeOut" as const,
};

type RegisterSessionApprovalRequest = {
  _id: string;
  notes?: string | null;
  reason?: string | null;
  requestedByStaffName?: string | null;
  status: string;
};

type RegisterSessionPendingVoidApprovals = {
  cashAffectingCount?: number | null;
  cashAdjustmentCount?: number | null;
  cashAdjustmentDelta?: number | null;
  cashAmount?: number | null;
  count: number;
  items: Array<{
    approvalRequestId: string;
    cashAmount?: number | null;
    requestedAt: number;
    transactionId: string;
    transactionNumber?: string | null;
    workItemId?: string | null;
  }>;
};

type RegisterSessionDetail = {
  _id: string;
  closedAt?: number;
  closedByStaffName?: string | null;
  closeoutRecords?: Array<{
    actorStaffProfileId?: string;
    countedCash?: number;
    expectedCash?: number;
    occurredAt: number;
    type: "closed" | "reopened";
    variance?: number;
  }>;
  countedCash?: number;
  expectedCash: number;
  netExpectedCash?: number;
  notes?: string | null;
  openedAt: number;
  openedOperatingDate?: string;
  openedByStaffName?: string | null;
  openingFloat: number;
  pendingApprovalRequest?: RegisterSessionApprovalRequest | null;
  pendingVoidApprovals?: RegisterSessionPendingVoidApprovals | null;
  registerNumber?: string | null;
  status: string;
  terminalName?: string | null;
  totalDeposited: number;
  variance?: number;
  workflowTraceId?: string | null;
  localSyncStatus?: {
    description?: string | null;
    label?: string | null;
    pendingEventCount?: number | null;
    reconciliationItems?: PosReconciliationItem[] | null;
    status?: string | null;
  } | null;
  reconciliationItems?: PosReconciliationItem[] | null;
};

type RegisterSessionDeposit = {
  _id: string;
  amount: number;
  notes?: string | null;
  recordedAt: number;
  recordedByStaffName?: string | null;
  reference?: string | null;
  registerSessionId?: string | null;
};

type RegisterSessionTransaction = {
  _id: string;
  cashierName?: string | null;
  completedAt: number;
  customerName?: string | null;
  hasMultiplePaymentMethods?: boolean;
  itemCount: number;
  paymentMethod?: string | null;
  status?: "completed" | "void" | string | null;
  total: number;
  transactionNumber: string;
  voidedAt?: number | null;
  workflowTraceId?: string | null;
};

type RegisterSessionItemBreakdown = {
  name: string;
  productSku: string | null;
  quantity: number;
  totalSales: number;
};

type RegisterSessionCloseoutReview = {
  hasVariance: boolean;
  reason?: string | null;
  requiresApproval: boolean;
  variance: number;
};

type RegisterSessionTimelineEvent = {
  _id: string;
  actorStaffName?: string | null;
  createdAt: number;
  eventType: string;
  metadata?: Record<string, unknown> | null;
  message?: string | null;
  reason?: string | null;
};

export type RegisterSessionSnapshot = {
  closeoutReview: RegisterSessionCloseoutReview | null;
  deposits: RegisterSessionDeposit[];
  itemsBreakdown?: RegisterSessionItemBreakdown[];
  financialPosition?: {
    averageTransaction: number;
    paymentMix: Array<{
      method: string;
      share: number;
      total: number;
      transactionCount: number;
    }>;
    totalSales: number;
    transactionCount: number;
  };
  registerSession: RegisterSessionDetail;
  timeline?: RegisterSessionTimelineEvent[];
  transactions?: RegisterSessionTransaction[];
};

type RegisterSessionActivityCategory =
  | "register"
  | "session"
  | "cart"
  | "payment"
  | "service"
  | "cash"
  | "expense"
  | "sale"
  | "closeout"
  | "reopen"
  | "sync"
  | "review";

type RegisterSessionActivity = {
  continueCursor: string;
  integration: {
    activityReadModelAvailable: boolean;
    source: "activity_read_model" | "pos_sync_evidence";
  };
  isDone: boolean;
  registerSession: Pick<
    RegisterSessionDetail,
    "_id" | "registerNumber" | "terminalName"
  >;
  page: Array<{
    _id: string;
    actorStaffName: string | null;
    category: RegisterSessionActivityCategory;
    evidenceLinks: Array<{
      id: string;
      label: string;
      type: "closeout" | "expense" | "review" | "sync" | "transaction";
    }>;
    item?: {
      label: string;
      quantity: number | null;
      unitPrice: number | null;
    } | null;
    label: string;
    localEventId: string | null;
    localRegisterSessionId: string | null;
    openingFloat?: number | null;
    occurredAt: number;
    reportedAt: number | null;
    sequence: number | null;
    source: "activity_read_model" | "pos_sync_evidence";
    status: {
      kind:
        | "activity_patch_failed"
        | "accepted"
        | "projected"
        | "conflicted"
        | "held"
        | "manager_applied"
        | "manager_rejected"
        | "mapping_pending"
        | "repaired"
        | "rejected"
        | "terminal_reported";
      label: string;
      tone: "default" | "success" | "warning" | "destructive";
    };
    summary: string | null;
    terminalName: string | null;
  }>;
  summary: {
    attentionCounts: Record<
      | "activity_patch_failed"
      | "conflicted"
      | "held"
      | "manager_applied"
      | "manager_rejected"
      | "mapping_pending"
      | "rejected",
      number
    >;
    categoryCounts: Record<RegisterSessionActivityCategory, number>;
    coverageState:
      | "reported"
      | "partially_reported"
      | "unreported"
      | "unknown_terminal_state";
    latestCloudStatusAt: number | null;
    lastActivityReportedAt: number | null;
    reportedThroughSequence: number | null;
    rowCount: number;
  };
};
type RegisterSessionActivityFilter =
  | "all"
  | "attention"
  | "register"
  | "sale"
  | "cart"
  | "payment"
  | "service"
  | "cash"
  | "expense"
  | "closeout"
  | "sync_review";

type RegisterSessionActivityQueryReference = FunctionReference<
  "query",
  "public",
  {
    paginationOpts: { cursor: string | null; numItems: number };
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
  RegisterSessionActivity
>;

const registerSessionActivityQuery = (
  api as unknown as {
    cashControls: {
      registerSessionActivity: {
        listRegisterSessionActivity: RegisterSessionActivityQueryReference;
      };
    };
  }
).cashControls.registerSessionActivity.listRegisterSessionActivity;

type RecordRegisterSessionDepositArgs = {
  actorStaffProfileId?: string;
  actorUserId?: string;
  amount: number;
  notes?: string;
  reference?: string;
  registerSessionId: string;
  storeId: string;
  submissionKey: string;
};

type RegisterSessionDepositPayload = {
  action?: "duplicate" | "recorded";
};

type RegisterSessionDepositResult =
  NormalizedCommandResult<RegisterSessionDepositPayload>;

type RegisterCloseoutSubmitArgs = {
  actorStaffProfileId?: string;
  approvalProofId?: string;
  closeoutModificationApprovalProofId?: string;
  countedCash: number;
  notes?: string;
  registerSessionId: string;
  requestedByStaffProfileId?: string;
  staffPinHash?: string;
  staffUsername?: string;
};

type RegisterCloseoutFinalizeArgs = {
  actorStaffProfileId: string;
  approvalProofId?: string;
  registerSessionId: string;
  requestedByStaffProfileId?: string;
  staffPinHash?: string;
  staffUsername?: string;
};

type RegisterCloseoutReviewArgs = {
  approvalProofId: string;
  decision: "approved" | "rejected";
  decisionNotes?: string;
  registerSessionId: string;
};

type RegisterCloseoutCommandPayload = {
  action?: "closed" | "approved" | "rejected" | "reopened" | "submitted";
  pendingVoidApprovalCount?: number;
};

type RegisterCloseoutCommandResult =
  NormalizedApprovalCommandResult<RegisterCloseoutCommandPayload>;

type ResolveSyncReviewArgs = {
  actorStaffProfileId: string;
  approvalProofId?: string;
  decision: "approved" | "rejected";
  registerSessionId: string;
  requestedByStaffProfileId?: string;
  reviewConflictIds?: string[];
};

type ResolveSyncReviewDecisionOptions = {
  approveLabel?: string;
  rejectLabel?: string;
  reviewConflictIds?: string[];
};

type ResolveSyncReviewResult = NormalizedCommandResult<{
  action?: "already_resolved" | "resolved" | "rejected";
  projectedCount?: number;
  resolvedCount?: number;
}>;

type StaffAuthenticationCommandResult =
  NormalizedCommandResult<StaffAuthenticationResult>;

type CloseoutApprovalAuthenticationResult = StaffAuthenticationResult & {
  approvalProofId?: string;
  requestedByStaffProfileId?: string;
};

type CloseoutApprovalAuthenticationCommandResult =
  NormalizedCommandResult<CloseoutApprovalAuthenticationResult>;

type CorrectOpeningFloatArgs = {
  actorStaffProfileId?: string;
  approvalProofId?: string;
  correctedOpeningFloat: number;
  reason: string;
  registerSessionId: string;
};

type CorrectOpeningFloatCommandResult = NormalizedApprovalCommandResult<{
  action?: "corrected" | "duplicate";
}>;

type StaffAuthenticationRole = "cashier" | "manager";

type RegisterSessionViewContentProps = {
  actorStaffProfileId?: string;
  actorUserId?: string;
  canViewFinancialDetails?: boolean;
  currency: string;
  isLoading: boolean;
  onRecordDeposit: (
    args: RecordRegisterSessionDepositArgs,
  ) => Promise<RegisterSessionDepositResult>;
  onCorrectOpeningFloat?: (
    args: CorrectOpeningFloatArgs,
  ) => Promise<CorrectOpeningFloatCommandResult>;
  onReviewCloseout: (
    args: RegisterCloseoutReviewArgs,
  ) => Promise<RegisterCloseoutCommandResult>;
  onResolveSyncReview?: (
    args: ResolveSyncReviewArgs,
  ) => Promise<ResolveSyncReviewResult>;
  onReopenCloseout?: (args: {
    actorStaffProfileId: string;
    approvalProofId: string;
    registerSessionId: string;
    requestedByStaffProfileId?: string;
  }) => Promise<RegisterCloseoutCommandResult>;
  onAuthenticateStaff: (args: {
    allowedRoles: StaffAuthenticationRole[];
    pinHash: string;
    username: string;
  }) => Promise<StaffAuthenticationCommandResult>;
  onAuthenticateCloseoutReviewApproval?: (args: {
    pinHash: string;
    reason?: string;
    registerSessionId: string;
    requesterBinding?: ApprovalRequesterBinding;
    requestedByStaffProfileId?: Id<"staffProfile">;
    username: string;
  }) => Promise<CloseoutApprovalAuthenticationCommandResult>;
  onAuthenticateForApproval?: CommandApprovalDialogProps["onAuthenticateForApproval"];
  onSubmitCloseout: (
    args: RegisterCloseoutSubmitArgs,
  ) => Promise<RegisterCloseoutCommandResult>;
  onFinalizeCloseout?: (
    args: RegisterCloseoutFinalizeArgs,
  ) => Promise<RegisterCloseoutCommandResult>;
  onNavigateBack?: () => void;
  orgUrlSlug?: string;
  registerSessionSnapshot: RegisterSessionSnapshot | null;
  storeId?: string;
  storeUrlSlug?: string;
};

type RegisterSessionActivityViewContentProps = {
  activity?: RegisterSessionActivity | null;
  currency?: string;
  filter?: RegisterSessionActivityFilter;
  isLoading: boolean;
  onFilterChange?: (filter: RegisterSessionActivityFilter) => void;
  onPageChange?: (page: number) => void;
  orgUrlSlug?: string;
  page?: number;
  sessionId?: string;
  storeUrlSlug?: string;
};

type CloseoutStaffAuthIntent =
  | {
      kind: "submit";
      countedCash: number;
      notes?: string;
      registerSessionId: string;
    }
  | {
      decision: "approved" | "rejected";
      decisionNotes?: string;
      kind: "review";
      registerSessionId: string;
    }
  | {
      kind: "finalize";
      registerSessionId: string;
    }
  | {
      kind: "sync_review";
      decision: "approved" | "rejected";
      approveLabel: string;
      registerSessionId: string;
      rejectLabel: string;
      reviewConflictIds?: string[];
    };

type ReopenedCloseoutSubmitIntent = {
  countedCash: number;
  notes?: string;
  registerSessionId: string;
  reopenedByStaffProfileId?: string;
};

type OpeningFloatCorrectionIntent = {
  correctedOpeningFloat: number;
  reason: string;
  registerNumber?: string | null;
  registerSessionId: string;
};

function trimOptional(value?: string) {
  const nextValue = value?.trim();
  return nextValue ? nextValue : undefined;
}

function isManagerStaff(staff: StaffAuthenticationResult) {
  return staff.activeRoles?.includes("manager") ?? false;
}

const REGISTER_SESSION_SYNC_REVIEW_APPROVAL_ACTION_KEY =
  "cash_controls.register_session.resolve_sync_review";

function formatCurrency(currency: string, amount?: number | null) {
  if (amount === undefined || amount === null) {
    return "Pending";
  }

  return formatStoredCurrencyAmount(currency, amount, {
    revealMinorUnits: true,
  });
}

function CashControlsFinancialValue({
  amount,
  canView,
  currency,
  label,
}: {
  amount?: number | null;
  canView: boolean;
  currency: string;
  label: string;
}) {
  return (
    <FinancialValue canView={canView} label={label}>
      {formatCurrency(currency, amount)}
    </FinancialValue>
  );
}

function formatStoredAmountForInput(amount: number) {
  return String(toDisplayAmount(amount));
}

function formatTimestamp(timestamp: number) {
  return new Date(timestamp).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatStatusLabel(status: string) {
  return capitalizeWords(status.replaceAll("_", " "));
}

const ACTIVITY_FILTERS: Array<{
  id: RegisterSessionActivityFilter;
  label: string;
}> = [
  { id: "all", label: "All" },
  { id: "sale", label: "Sale" },
  { id: "cart", label: "Cart" },
  { id: "payment", label: "Payment" },
  { id: "cash", label: "Cash" },
  { id: "closeout", label: "Closeout" },
  { id: "attention", label: "Needs attention" },
];

function activityFilterMatches(
  filter: RegisterSessionActivityFilter,
  row: RegisterSessionActivity["page"][number],
) {
  if (filter === "all") return true;
  if (filter === "attention") {
    return [
      "activity_patch_failed",
      "conflicted",
      "held",
      "manager_rejected",
      "mapping_pending",
      "rejected",
    ].includes(row.status.kind);
  }
  if (filter === "sync_review") {
    return row.category === "sync" || row.category === "review";
  }
  return row.category === filter;
}

function formatActivityCoverageState(
  state: RegisterSessionActivity["summary"]["coverageState"],
) {
  switch (state) {
    case "reported":
      return "Reported";
    case "partially_reported":
      return "Partially reported";
    case "unreported":
      return "No cloud activity yet";
    case "unknown_terminal_state":
      return "Terminal reporting uncertain";
  }
}

function getActivityCoverageCopy(activity: RegisterSessionActivity | null) {
  if (!activity) {
    return "Loading register activity.";
  }

  if (activity.summary.coverageState === "unreported") {
    return "No activity reported yet. Recent activity may take a moment to appear.";
  }

  if (activity.summary.coverageState === "unknown_terminal_state") {
    return "Only reported activity appears here. Recent activity may take a moment to appear.";
  }

  return "Recent register activity may take a moment to appear.";
}

function getActivityStatusDotClass(
  tone: RegisterSessionActivity["page"][number]["status"]["tone"],
) {
  switch (tone) {
    case "success":
      return "bg-success";
    case "warning":
      return "bg-warning";
    case "destructive":
      return "bg-danger";
    case "default":
      return "bg-muted-foreground";
  }
}

function getActivityAttentionCount(activity: RegisterSessionActivity | null) {
  if (!activity) return 0;
  const counts = activity.summary.attentionCounts;
  return (
    counts.mapping_pending + counts.held + counts.conflicted + counts.rejected
  );
}

function getActivityRowKey(
  row: RegisterSessionActivity["page"][number],
  index: number,
) {
  return `${row._id}:${row.sequence ?? "no-sequence"}:${index}`;
}

function parseReceiptActivitySummary(summary: string | null) {
  if (!summary) return null;
  const match = summary.match(/^Receipt\s+(.+?)(\s+-\s+.*)?$/);
  if (!match) return null;
  return {
    receiptNumber: match[1].trim(),
    rest: match[2] ?? "",
  };
}

function parseActivityPageSearchValue(value: unknown) {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : 1;

  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 1;
}

function parseActivityFilterSearchValue(
  value: unknown,
): RegisterSessionActivityFilter {
  return ACTIVITY_FILTERS.some((option) => option.id === value)
    ? (value as RegisterSessionActivityFilter)
    : "all";
}

function renderActivitySummary(
  row: RegisterSessionActivity["page"][number],
  currency: string,
  orgUrlSlug?: string,
  storeUrlSlug?: string,
) {
  if (row.item) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        {[
          capitalizeWords(row.item.label),
          row.item.unitPrice === null
            ? null
            : formatCurrency(currency, row.item.unitPrice),
          row.item.quantity === null || row.item.quantity === 0
            ? null
            : `Qty ${row.item.quantity}`,
        ]
          .filter(Boolean)
          .join(" · ")}
      </p>
    );
  }

  const receiptSummary =
    row.category === "sale" ? parseReceiptActivitySummary(row.summary) : null;
  const transactionLink = row.evidenceLinks.find(
    (link) => link.type === "transaction",
  );

  if (receiptSummary && transactionLink && orgUrlSlug && storeUrlSlug) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        Receipt{" "}
        <Link
          className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline"
          params={{
            orgUrlSlug,
            storeUrlSlug,
            transactionId: transactionLink.id as Id<"posTransaction">,
          }}
          search={{ o: getOrigin() }}
          to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
        >
          #{receiptSummary.receiptNumber}
          <ArrowUpRight className="h-3 w-3" />
        </Link>
        {receiptSummary.rest}
      </p>
    );
  }

  if (row.openingFloat !== null && row.openingFloat !== undefined) {
    return (
      <p className="text-xs leading-5 text-muted-foreground">
        {row.summary ?? "Opening float recorded"}:{" "}
        {formatCurrency(currency, row.openingFloat)}
      </p>
    );
  }

  return row.summary ? (
    <p className="text-xs leading-5 text-muted-foreground">{row.summary}</p>
  ) : null;
}

export function RegisterSessionActivitySection({
  activity,
  currency = "USD",
  filter: controlledFilter,
  onFilterChange,
  onPageChange,
  orgUrlSlug,
  page: controlledPage,
  storeUrlSlug,
}: {
  activity?: RegisterSessionActivity | null;
  currency?: string;
  filter?: RegisterSessionActivityFilter;
  onFilterChange?: (filter: RegisterSessionActivityFilter) => void;
  onPageChange?: (page: number) => void;
  orgUrlSlug?: string;
  page?: number;
  storeUrlSlug?: string;
}) {
  const [localFilter, setLocalFilter] =
    useState<RegisterSessionActivityFilter>("all");
  const filter = controlledFilter ?? localFilter;
  const handleFilterChange = onFilterChange ?? setLocalFilter;
  const [localPage, setLocalPage] = useState(1);
  const previousFilterRef = useRef(filter);
  const page = controlledPage ?? localPage;
  const handlePageChange = onPageChange ?? setLocalPage;
  const rows = activity?.page ?? [];
  const filteredRows = rows.filter((row) => activityFilterMatches(filter, row));
  const pageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / REGISTER_SESSION_ACTIVITY_PAGE_SIZE),
  );
  const currentPage = Math.min(page, pageCount);
  const paginatedRows = filteredRows.slice(
    (currentPage - 1) * REGISTER_SESSION_ACTIVITY_PAGE_SIZE,
    currentPage * REGISTER_SESSION_ACTIVITY_PAGE_SIZE,
  );
  const attentionCount = getActivityAttentionCount(activity ?? null);
  const lastReportedAt = activity?.summary.lastActivityReportedAt ?? null;
  const latestCloudStatusAt = activity?.summary.latestCloudStatusAt ?? null;

  useEffect(() => {
    if (previousFilterRef.current === filter) {
      return;
    }
    previousFilterRef.current = filter;
    handlePageChange(1);
  }, [filter, handlePageChange]);

  useEffect(() => {
    if (page !== currentPage) {
      handlePageChange(currentPage);
    }
  }, [currentPage, handlePageChange, page]);

  return (
    <section className="order-2 space-y-layout-md rounded-lg border border-border bg-surface-raised p-layout-md">
      <div className="flex flex-col gap-layout-md lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <p className="max-w-3xl text-xs leading-5 text-muted-foreground/70">
            {getActivityCoverageCopy(activity ?? null)}
          </p>
        </div>
        {attentionCount > 0 ? (
          <Badge
            className="w-fit border-warning/20 bg-warning/10 text-warning"
            variant="outline"
          >
            {attentionCount} need attention
          </Badge>
        ) : null}
      </div>

      <dl
        className="grid gap-x-8 gap-y-4 px-1 py-1 sm:grid-cols-3"
        data-testid="activity-coverage-summary"
      >
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Coverage</dt>
          <dd className="mt-1 text-sm font-medium text-foreground">
            {activity
              ? formatActivityCoverageState(activity.summary.coverageState)
              : "Loading"}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Last report</dt>
          <dd className="mt-1 font-numeric text-sm tabular-nums text-foreground">
            {lastReportedAt === null
              ? "Not available"
              : formatTimestamp(lastReportedAt)}
          </dd>
        </div>
        <div className="min-w-0">
          <dt className="text-xs text-muted-foreground">Last status update</dt>
          <dd className="mt-1 font-numeric text-sm tabular-nums text-foreground">
            {latestCloudStatusAt === null
              ? "Not available"
              : formatTimestamp(latestCloudStatusAt)}
          </dd>
        </div>
      </dl>

      <div className="flex flex-wrap gap-2">
        {ACTIVITY_FILTERS.map((option) => {
          const isActive = filter === option.id;
          return (
            <button
              className={cn(
                "inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium transition-colors",
                isActive
                  ? "border-primary-border bg-primary-soft text-primary hover:bg-primary-soft/75"
                  : "border-border bg-surface text-muted-foreground hover:bg-muted/50 hover:text-foreground",
              )}
              key={option.id}
              onClick={() => handleFilterChange(option.id)}
              type="button"
            >
              {option.label}
            </button>
          );
        })}
      </div>

      {filteredRows.length === 0 ? (
        <div className="flex min-h-[180px] items-center justify-center rounded-md border border-dashed border-border bg-muted/20">
          <EmptyState
            description={
              rows.length === 0
                ? "This view will update when POS activity reaches the cloud"
                : "No activity matches the selected filter"
            }
            title={
              rows.length === 0
                ? "No cloud-reported POS activity for this session"
                : "No matching activity"
            }
          />
        </div>
      ) : (
        <div className="overflow-hidden rounded-md border border-border">
          <Table>
            <TableHeader>
              <TableRow className="border-b border-border hover:bg-transparent">
                <TableHead className="min-w-[160px] text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Activity
                </TableHead>
                <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  Status
                </TableHead>
                <TableHead className="hidden text-[11px] uppercase tracking-[0.16em] text-muted-foreground lg:table-cell">
                  Actor
                </TableHead>
                <TableHead className="hidden text-[11px] uppercase tracking-[0.16em] text-muted-foreground xl:table-cell">
                  Time
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedRows.map((row, index) => (
                <TableRow
                  className="border-b border-border/70"
                  data-activity-category={row.category}
                  key={getActivityRowKey(row, index)}
                >
                  <TableCell>
                    <div className="space-y-1">
                      <p className="font-medium text-foreground">{row.label}</p>
                      {renderActivitySummary(
                        row,
                        currency,
                        orgUrlSlug,
                        storeUrlSlug,
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2 whitespace-nowrap text-sm text-muted-foreground">
                      <span
                        aria-hidden="true"
                        className={`h-1.5 w-1.5 shrink-0 rounded-full ${getActivityStatusDotClass(row.status.tone)}`}
                      />
                      {row.status.label}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground lg:table-cell">
                    {row.actorStaffName ?? "N/A"}
                  </TableCell>
                  <TableCell className="hidden text-sm text-muted-foreground xl:table-cell">
                    {formatTimestamp(row.occurredAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {filteredRows.length > REGISTER_SESSION_ACTIVITY_PAGE_SIZE ? (
            <ListPagination
              onPageChange={handlePageChange}
              page={currentPage}
              pageCount={pageCount}
              pageSize={REGISTER_SESSION_ACTIVITY_PAGE_SIZE}
              totalItems={filteredRows.length}
            />
          ) : null}
        </div>
      )}
    </section>
  );
}

export function RegisterSessionActivityViewContent({
  activity,
  currency = "USD",
  filter,
  isLoading,
  onFilterChange,
  onPageChange,
  orgUrlSlug,
  page,
  storeUrlSlug,
}: RegisterSessionActivityViewContentProps) {
  return (
    <View
      header={
        <ComposedPageHeader
          className="h-auto min-h-16 flex-col items-stretch gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:border-0 sm:py-4"
          leadingContent={
            <div
              className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-1.5 sm:gap-y-0.5"
              data-testid="register-session-activity-header-identity"
            >
              <RegisterSessionIdentity
                fallbackTitle="POS activity"
                registerSession={activity?.registerSession}
              />
              {activity?.registerSession ? (
                <span className="min-w-0 truncate text-xs text-muted-foreground sm:whitespace-nowrap sm:text-sm">
                  <span className="hidden sm:inline">/ </span>
                  POS activity
                </span>
              ) : null}
            </div>
          }
        />
      }
    >
      <FadeIn>
        <div className="container mx-auto p-layout-md md:p-6">
          {isLoading ? null : (
            <RegisterSessionActivitySection
              activity={activity}
              currency={currency}
              filter={filter}
              onFilterChange={onFilterChange}
              onPageChange={onPageChange}
              orgUrlSlug={orgUrlSlug}
              page={page}
              storeUrlSlug={storeUrlSlug}
            />
          )}
        </div>
      </FadeIn>
    </View>
  );
}

function isCloseoutRejectionEvent(event: RegisterSessionTimelineEvent) {
  return event.eventType === "register_session_closeout_rejected";
}

function isOpeningFloatCorrectionEvent(event: RegisterSessionTimelineEvent) {
  return (
    event.eventType.toLowerCase().includes("opening_float") ||
    event.message?.toLowerCase().includes("opening float")
  );
}

function getNumericEventMetadata(
  event: RegisterSessionTimelineEvent,
  key: string,
) {
  const value = event.metadata?.[key];

  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRegisterSessionCorrectionEvent(event: RegisterSessionTimelineEvent) {
  return (
    isCloseoutRejectionEvent(event) || isOpeningFloatCorrectionEvent(event)
  );
}

function formatPaymentMethod(method?: string | null) {
  if (!method) {
    return "Unknown";
  }

  return capitalizeWords(method.replaceAll("_", " "));
}

function formatPaymentMethods(methods?: string[] | null) {
  const labels = Array.from(
    new Set(
      (methods ?? [])
        .map((method) => formatPaymentMethod(method))
        .filter((method) => method !== "Unknown"),
    ),
  );

  return formatCompactTextList(labels) ?? "Unknown";
}

function getPrimaryPaymentMethod(methods?: string[] | null) {
  const normalizedMethods = Array.from(
    new Set((methods ?? []).map((method) => method?.trim()).filter(Boolean)),
  );

  if (normalizedMethods.length === 0) {
    return null;
  }

  return normalizedMethods[0] ?? null;
}

function formatRegisterCloseoutSubjectLabel(registerNumber?: string | null) {
  return `${formatRegisterHeaderName(registerNumber)} closeout correction`;
}

function formatRegisterOpeningFloatSubjectLabel(
  registerNumber?: string | null,
) {
  return `${formatRegisterHeaderName(registerNumber)} opening float correction`;
}

function getVarianceTone(variance?: number) {
  if (!variance) {
    return "text-foreground";
  }

  return variance > 0 ? "text-success" : "text-destructive";
}

function getPaymentMethodIcon({
  hasMultiplePaymentMethods,
  paymentMethod,
}: {
  hasMultiplePaymentMethods?: boolean;
  paymentMethod?: string | null;
}) {
  if (hasMultiplePaymentMethods) {
    return WalletCards;
  }

  switch (paymentMethod) {
    case "cash":
      return Banknote;
    case "card":
      return CreditCard;
    case "mobile_money":
      return Smartphone;
    default:
      return Receipt;
  }
}

function getSyncReviewActionCopy({
  hasCloseoutReview,
  hasDuplicateRegisterOpenReview,
  hasOnlyRejectedReviewItems,
  hasSaleReview,
}: {
  hasCloseoutReview: boolean;
  hasDuplicateRegisterOpenReview: boolean;
  hasOnlyRejectedReviewItems: boolean;
  hasSaleReview: boolean;
}) {
  if (hasOnlyRejectedReviewItems) {
    return {
      approveAuthDescription:
        "Authenticate to override and sync rejected local activity",
      approveLabel: "Override and sync events",
      rejectAuthDescription: "Authenticate to reject reviewed synced activity",
      rejectLabel: "Reject reviewed activity",
    };
  }

  if (hasCloseoutReview) {
    return {
      approveAuthDescription: "Authenticate to apply the synced closeout",
      approveLabel: "Apply synced closeout",
      rejectAuthDescription: "Authenticate to reject the synced closeout",
      rejectLabel: "Reject synced closeout",
    };
  }

  if (hasDuplicateRegisterOpenReview) {
    return {
      approveAuthDescription:
        "Authenticate to apply duplicate synced register openings",
      approveLabel: "Apply duplicate register openings",
      rejectAuthDescription:
        "Authenticate to reject duplicate synced register openings",
      rejectLabel: "Reject duplicate register openings",
    };
  }

  if (hasSaleReview) {
    return {
      approveAuthDescription:
        "Authenticate to apply reviewed sale activity to this register session",
      approveLabel: "Apply reviewed sale activity",
      rejectAuthDescription:
        "Authenticate to reject reviewed sale activity from this review",
      rejectLabel: "Reject reviewed sale activity",
    };
  }

  return {
    approveAuthDescription: "Authenticate to apply reviewed synced activity",
    approveLabel: "Apply reviewed activity",
    rejectAuthDescription: "Authenticate to reject reviewed synced activity",
    rejectLabel: "Reject reviewed activity",
  };
}

function getSyncBadgeClass(tone: PosSyncStatusPresentation["tone"]) {
  switch (tone) {
    case "success":
      return "border-transparent bg-success/10 text-success";
    case "danger":
      return "border-transparent bg-danger/10 text-danger";
    case "warning":
      return "border-transparent bg-warning/15 text-warning";
    default:
      return "border-border bg-background text-muted-foreground";
  }
}

function getSyncStatusTextClass(tone: PosSyncStatusPresentation["tone"]) {
  switch (tone) {
    case "success":
      return "text-success";
    case "danger":
      return "text-danger";
    case "warning":
      return "text-warning";
    default:
      return "text-muted-foreground";
  }
}

function getSyncStatusDotClass(tone: PosSyncStatusPresentation["tone"]) {
  switch (tone) {
    case "success":
      return "bg-success";
    case "danger":
      return "bg-danger";
    case "warning":
      return "bg-warning";
    default:
      return "bg-muted-foreground/60";
  }
}

function formatHeaderSyncStatus(syncStatus: PosSyncStatusPresentation) {
  const label =
    syncStatus.status === "locally_closed_pending_sync"
      ? "Pending reconciliation"
      : syncStatus.label;

  return label.toLocaleLowerCase();
}

type RegisterSessionHeaderIdentityProps = {
  fallbackTitle?: string;
  registerSession?: Pick<
    RegisterSessionDetail,
    "_id" | "localSyncStatus" | "registerNumber" | "status" | "terminalName"
  > | null;
  statusLabel?: string;
  syncStatus?: PosSyncStatusPresentation;
};

function RegisterSessionHeaderIdentity({
  fallbackTitle = "Register detail",
  registerSession,
  statusLabel,
  syncStatus: suppliedSyncStatus,
}: RegisterSessionHeaderIdentityProps) {
  const syncStatus =
    suppliedSyncStatus ??
    buildPosSyncStatusPresentation(registerSession?.localSyncStatus ?? {});
  const lifecycleLabel = registerSession
    ? (statusLabel ?? formatStatusLabel(registerSession.status))
    : "";
  const isActive = Boolean(
    registerSession && ["active", "open"].includes(registerSession.status),
  );
  const isLive = Boolean(
    registerSession &&
    ["active", "open", "closing"].includes(registerSession.status),
  );

  return (
    <div
      className="flex min-w-0 flex-1 flex-col gap-2 sm:flex-row sm:items-baseline sm:gap-4"
      data-testid="register-session-header-identity"
    >
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:flex-wrap sm:items-baseline sm:gap-x-4 sm:gap-y-0.5">
        <RegisterSessionIdentity
          fallbackTitle={fallbackTitle}
          registerSession={registerSession}
        />
        {registerSession ? (
          <motion.span
            animate={{ opacity: 1, y: 0 }}
            className={cn(
              "inline-flex min-w-0 items-baseline gap-1.5 text-xs font-medium leading-5 sm:whitespace-nowrap sm:text-sm",
              getSyncStatusTextClass(syncStatus.tone),
            )}
            initial={{ opacity: 0, y: 2 }}
            key={`sync-${registerSession._id}-${syncStatus.status}-${syncStatus.label}`}
            transition={{ ...HEADER_METADATA_TRANSITION, delay: 0.01 }}
          >
            <span
              aria-hidden="true"
              className={cn(
                "size-1.5 shrink-0 translate-y-[-0.08em] rounded-full",
                getSyncStatusDotClass(syncStatus.tone),
                isLive && "motion-safe:animate-pulse",
              )}
            />
            <span className="min-w-0 truncate">
              {formatHeaderSyncStatus(syncStatus)}
            </span>
            <span aria-hidden="true" className="text-muted-foreground/50">
              ·
            </span>
            <span
              className={cn(
                "truncate",
                isActive ? "text-success" : "text-muted-foreground",
              )}
            >
              {lifecycleLabel}
            </span>
          </motion.span>
        ) : null}
      </div>
    </div>
  );
}

function formatReviewItemCount(count: number) {
  return `${count} review ${count === 1 ? "item" : "items"}`;
}

function formatReviewItemTimestamp(timestamp?: number | null) {
  return typeof timestamp === "number" && Number.isFinite(timestamp)
    ? formatTimestamp(timestamp)
    : null;
}

function formatCompactTextList(values: string[]) {
  if (values.length === 0) {
    return null;
  }

  if (values.length === 1) {
    return values[0];
  }

  if (values.length === 2) {
    return `${values[0]} and ${values[1]}`;
  }

  return `${values.slice(0, -1).join(", ")}, and ${values[values.length - 1]}`;
}

function formatReviewQueueSummary(items: PosReconciliationItem[]) {
  const sequences = items
    .map((item) =>
      typeof item.sequence === "number" ? `#${item.sequence}` : null,
    )
    .filter((value): value is string => Boolean(value));
  const sequenceList = formatCompactTextList(sequences);

  return sequenceList ? sequenceList : null;
}

function getReviewReportedEntries(items: PosReconciliationItem[]) {
  const reportedEntries = items
    .map((item) =>
      typeof item.createdAt === "number"
        ? {
            timestamp: item.createdAt,
            value: formatReviewItemTimestamp(item.createdAt),
          }
        : null,
    )
    .filter((entry): entry is { timestamp: number; value: string } =>
      Boolean(entry?.value),
    )
    .sort((left, right) => left.timestamp - right.timestamp);

  return Array.from(
    new Map(reportedEntries.map((entry) => [entry.timestamp, entry])).values(),
  );
}

function formatReviewTypeSummary(items: PosReconciliationItem[]) {
  const reviewTypes = Array.from(
    new Set(
      items
        .map((item) => formatPosReconciliationType(item.type, item).trim())
        .filter(Boolean),
    ),
  );
  const typeList = formatCompactTextList(reviewTypes);

  return typeList ? `${typeList}.` : null;
}

function formatReviewReasonSummary(items: PosReconciliationItem[]) {
  const reasons = Array.from(
    new Set(
      items
        .map((item) => item.summary?.trim())
        .filter((value): value is string => Boolean(value)),
    ),
  );

  if (reasons.length === 0) {
    return null;
  }

  const reasonList = reasons
    .map((reason) => reason.replace(/[.!?]+$/, ""))
    .join("; ");

  return `${reasonList}.`;
}

function SyncReviewDetailGrid({
  details,
  title = "Review details",
}: {
  details: Array<{ label: string; value?: string | null }>;
  title?: string;
}) {
  const visibleDetails = details.filter((detail) => detail.value?.trim());

  if (visibleDetails.length === 0) {
    return null;
  }

  return (
    <div className="space-y-layout-xs">
      <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </p>
      <dl className="grid gap-layout-xs sm:grid-cols-2">
        {visibleDetails.map((detail) => (
          <div
            className="rounded-md border border-border/70 bg-background/80 px-layout-sm py-layout-xs"
            key={detail.label}
          >
            <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
              {detail.label}
            </dt>
            <dd className="mt-1 text-sm leading-5 text-foreground">
              {detail.value}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function SyncReviewTimeline({
  items,
  uploadOrder,
}: {
  items: PosReconciliationItem[];
  uploadOrder?: string | null;
}) {
  const reportedEntries = getReviewReportedEntries(items);
  const firstReported = reportedEntries[0]?.value ?? null;
  const latestReported = reportedEntries.at(-1)?.value ?? null;
  const hasMultipleReports = reportedEntries.length > 1;

  if (!firstReported && !uploadOrder?.trim()) {
    return null;
  }

  return (
    <div className="space-y-layout-xs">
      <div className="flex flex-wrap items-baseline justify-between gap-x-layout-sm gap-y-1">
        <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Sync timeline
        </p>
        {reportedEntries.length > 0 ? (
          <p className="text-xs leading-5 text-muted-foreground">
            {reportedEntries.length === 1
              ? "1 report"
              : `${reportedEntries.length} reports`}
          </p>
        ) : null}
      </div>
      <dl className="grid gap-layout-xs rounded-md border border-border/70 bg-background/80 px-layout-sm py-layout-xs text-xs">
        {firstReported ? (
          <div className="flex items-start justify-between gap-layout-sm">
            <dt className="text-muted-foreground">
              {hasMultipleReports ? "First reported" : "Reported"}
            </dt>
            <dd className="text-right leading-5 text-foreground">
              {firstReported}
            </dd>
          </div>
        ) : null}
        {hasMultipleReports && latestReported ? (
          <div className="flex items-start justify-between gap-layout-sm">
            <dt className="text-muted-foreground">Latest report</dt>
            <dd className="text-right leading-5 text-foreground">
              {latestReported}
            </dd>
          </div>
        ) : null}
        {uploadOrder?.trim() ? (
          <div className="flex items-start justify-between gap-layout-sm">
            <dt className="text-muted-foreground">Upload order</dt>
            <dd className="text-right leading-5 text-foreground">
              {uploadOrder}
            </dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

type SyncReviewSaleSummary = NonNullable<PosReconciliationItem["sale"]> & {
  inventoryReviews: NonNullable<PosReconciliationItem["inventoryReview"]>[];
  registerOpeningReviewItems: PosReconciliationItem[];
  reasons: string[];
  reviewItems: PosReconciliationItem[];
  sequences: number[];
};

function getSaleReviewKey(item: PosReconciliationItem) {
  const sale = item.sale;

  return (
    sale?.localTransactionId?.trim() ||
    sale?.receiptNumber?.trim() ||
    sale?.localReceiptNumber?.trim() ||
    item.localEventId?.trim() ||
    item.id
  );
}

function getSyncReviewSaleSummaries(items: PosReconciliationItem[]) {
  const salesByKey = new Map<string, SyncReviewSaleSummary>();

  for (const item of items) {
    if (!item.sale) continue;

    const key = getSaleReviewKey(item);
    if (!key) continue;

    const existing = salesByKey.get(key);
    const summary = item.summary?.trim();
    const nextSale: SyncReviewSaleSummary = existing ?? {
      ...item.sale,
      inventoryReviews: [],
      registerOpeningReviewItems: [],
      reasons: [],
      reviewItems: [],
      sequences: [],
    };
    const isRegisterOpeningReview =
      isDuplicateLocalIdRegisterSyncReviewItem(item);

    if (
      !isRegisterOpeningReview &&
      summary &&
      !nextSale.reasons.includes(summary)
    ) {
      nextSale.reasons.push(summary);
    }

    if (
      typeof item.sequence === "number" &&
      !nextSale.sequences.includes(item.sequence)
    ) {
      nextSale.sequences.push(item.sequence);
    }

    if (item.inventoryReview) {
      const inventoryReviewKey = JSON.stringify(item.inventoryReview);
      const hasInventoryReview = nextSale.inventoryReviews.some(
        (review) => JSON.stringify(review) === inventoryReviewKey,
      );
      if (!hasInventoryReview) {
        nextSale.inventoryReviews.push(item.inventoryReview);
      }
    }

    salesByKey.set(key, {
      ...nextSale,
      registerOpeningReviewItems: isRegisterOpeningReview
        ? [...nextSale.registerOpeningReviewItems, item]
        : nextSale.registerOpeningReviewItems,
      reviewItems: isRegisterOpeningReview
        ? nextSale.reviewItems
        : [...nextSale.reviewItems, item],
      sequences: nextSale.sequences.sort((left, right) => left - right),
    });
  }

  return Array.from(salesByKey.values());
}

function formatSaleItemCount(
  sale: Pick<SyncReviewSaleSummary, "itemCount" | "items">,
) {
  const itemCount =
    typeof sale.itemCount === "number" && sale.itemCount > 0
      ? sale.itemCount
      : (sale.items?.length ?? 0);

  if (itemCount === 0) {
    return "Items not recorded";
  }

  return itemCount === 1 ? "1 item" : `${itemCount} items`;
}

function formatSaleItemName(name: string) {
  return capitalizeWords(name.trim());
}

function getSaleItemsTotal(sale: Pick<SyncReviewSaleSummary, "items">) {
  const itemsTotal = sale.items?.reduce(
    (sum, item) => sum + (typeof item.total === "number" ? item.total : 0),
    0,
  );

  return itemsTotal && itemsTotal > 0 ? itemsTotal : null;
}

function formatPaymentMismatchSummary(
  sale: Pick<SyncReviewSaleSummary, "paymentMethods" | "total" | "totalPaid">,
  currency: string,
) {
  if (
    typeof sale.total !== "number" ||
    typeof sale.totalPaid !== "number" ||
    sale.totalPaid <= sale.total
  ) {
    return null;
  }

  return `collected ${formatCurrency(currency, sale.totalPaid)} by ${formatPaymentMethods(
    sale.paymentMethods,
  )} against expected total ${formatCurrency(currency, sale.total)}`;
}

function formatPaymentMismatchDetailSummary(
  sales: SyncReviewSaleSummary[],
  currency: string,
) {
  const mismatches = sales
    .map((sale) => formatPaymentMismatchSummary(sale, currency))
    .filter((summary): summary is string => Boolean(summary));

  if (mismatches.length === 0) {
    return null;
  }

  const summary = mismatches
    .map((mismatch, index) =>
      index === 0 ? capitalizeFirstLetter(mismatch) : mismatch,
    )
    .join("; ");

  return `${summary}.`;
}

function formatInventoryQuantity(label: string, value?: number | null) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${label} ${value}`
    : null;
}

function findInventoryReviewItem(
  sale: Pick<SyncReviewSaleSummary, "items">,
  review: NonNullable<PosReconciliationItem["inventoryReview"]>,
) {
  const productSkuId = review.productSkuId?.trim();

  return (
    sale.items?.find(
      (item) => productSkuId && item.productSkuId?.trim() === productSkuId,
    ) ?? (sale.items?.length === 1 ? sale.items[0] : null)
  );
}

function InventoryReviewList({
  orgUrlSlug,
  sale,
  storeUrlSlug,
}: {
  orgUrlSlug?: string;
  sale: SyncReviewSaleSummary;
  storeUrlSlug?: string;
}) {
  if (sale.inventoryReviews.length === 0) {
    return null;
  }

  return (
    <div className="space-y-layout-xs">
      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        Inventory review
      </p>
      <div className="grid gap-layout-xs">
        {sale.inventoryReviews.map((review, index) => {
          const item = findInventoryReviewItem(sale, review);
          const origin = getOrigin();
          const sku = item?.sku?.trim();
          const productSkuId = review.productSkuId?.trim();
          const quantityDetails = [
            formatInventoryQuantity("Requested", review.requestedQuantity),
            formatInventoryQuantity(
              "Available after holds",
              review.quantityAvailableAfterHolds,
            ),
            formatInventoryQuantity("Available", review.quantityAvailable),
            formatInventoryQuantity("Active holds", review.activeHeldQuantity),
            formatInventoryQuantity("On hand", review.availableInventoryCount),
            formatInventoryQuantity("Held for sale", review.heldForSession),
          ].filter((detail): detail is string => Boolean(detail));

          return (
            <div
              className="space-y-layout-xs rounded-md border border-border/70 bg-muted/10 px-layout-sm py-layout-xs"
              key={`${productSkuId ?? "inventory"}-${index}`}
            >
              <div className="min-w-0">
                <p className="truncate text-xs font-medium text-foreground">
                  {item?.name ? formatSaleItemName(item.name) : "Sale item"}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {sku ?? productSkuId ?? "SKU not recorded"}
                </p>
              </div>
              {quantityDetails.length > 0 ? (
                <div className="flex flex-wrap gap-x-layout-sm gap-y-1 text-xs text-muted-foreground">
                  {quantityDetails.map((detail) => (
                    <span key={detail}>{detail}</span>
                  ))}
                </div>
              ) : null}
              {review.reason ? (
                <p className="text-xs leading-5 text-muted-foreground">
                  {review.reason === "existing_pos_session_hold_expired"
                    ? "The original inventory hold expired before this sale synced."
                    : review.reason}
                </p>
              ) : null}
              {orgUrlSlug && storeUrlSlug ? (
                <div className="flex flex-row flex-wrap items-center gap-layout-xs pt-1">
                  <Button asChild size="sm" variant="ghost">
                    <Link
                      params={{ orgUrlSlug, storeUrlSlug }}
                      search={{
                        mode: "manual",
                        ...(productSkuId ? { sku: productSkuId } : {}),
                        o: origin,
                      }}
                      to="/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments"
                    >
                      Open stock adjustments
                      <ArrowUpRight className="h-3.5 w-3.5" />
                    </Link>
                  </Button>
                  {productSkuId ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link
                        params={{ orgUrlSlug, storeUrlSlug }}
                        search={{
                          productSkuId,
                          ...(sku ? { sku } : {}),
                          o: origin,
                        }}
                        to="/$orgUrlSlug/store/$storeUrlSlug/operations/sku-activity"
                      >
                        View SKU activity
                        <ArrowUpRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function SalesUnderReviewList({
  currency,
  isResolving,
  onReviewDecision,
  orgUrlSlug,
  sales,
  storeUrlSlug,
}: {
  currency: string;
  isResolving?: boolean;
  onReviewDecision?: (
    decision: "approved" | "rejected",
    options?: ResolveSyncReviewDecisionOptions,
  ) => void;
  orgUrlSlug?: string;
  sales: SyncReviewSaleSummary[];
  storeUrlSlug?: string;
}) {
  if (sales.length === 0) {
    return null;
  }

  const totalSalesAmount = sales.reduce(
    (sum, sale) =>
      sum + (typeof sale.total === "number" ? Math.max(0, sale.total) : 0),
    0,
  );
  const totalCashImpact = sales.reduce(
    (sum, sale) =>
      sum +
      (typeof sale.cashAmount === "number" ? Math.max(0, sale.cashAmount) : 0),
    0,
  );

  return (
    <div className="space-y-layout-xs md:col-span-2">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {sales.some((sale) => sale.reviewItems.length > 0)
              ? "Sales under review"
              : "Synced sale evidence"}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {sales.some((sale) => sale.reviewItems.length > 0)
              ? "These synced sale details will affect this register session if applied."
              : "These synced sale details were reported with the duplicate register-opening evidence."}
          </p>
        </div>
        <div className="flex flex-wrap gap-x-layout-sm gap-y-1 text-xs text-muted-foreground">
          <span>{sales.length === 1 ? "1 sale" : `${sales.length} sales`}</span>
          {totalSalesAmount > 0 ? (
            <span>Total {formatCurrency(currency, totalSalesAmount)}</span>
          ) : null}
          {totalCashImpact > 0 ? (
            <span>Cash impact {formatCurrency(currency, totalCashImpact)}</span>
          ) : null}
        </div>
      </div>
      <Accordion className="grid gap-layout-xs" collapsible type="single">
        {sales.map((sale, index) => {
          const receiptNumber =
            sale.receiptNumber?.trim() ||
            sale.localReceiptNumber?.trim() ||
            sale.localTransactionId?.trim() ||
            `Sale ${index + 1}`;
          const completedAt =
            typeof sale.occurredAt === "number"
              ? formatTimestamp(sale.occurredAt)
              : null;
          const sequenceList = formatCompactTextList(
            sale.sequences.map((sequence) => `#${sequence}`),
          );
          const primaryPaymentMethod = getPrimaryPaymentMethod(
            sale.paymentMethods,
          );
          const hasMultiplePaymentMethods =
            (sale.paymentMethods?.length ?? 0) > 1;
          const PaymentIcon = getPaymentMethodIcon({
            hasMultiplePaymentMethods,
            paymentMethod: primaryPaymentMethod,
          });
          const itemsTotal = getSaleItemsTotal(sale);
          const transactionId = sale.transactionId?.trim();
          const paymentMismatchSummary = formatPaymentMismatchSummary(
            sale,
            currency,
          );
          const reviewReasons =
            paymentMismatchSummary !== null
              ? [`Payment mismatch: ${paymentMismatchSummary}`, ...sale.reasons]
              : sale.reasons;

          return (
            <AccordionItem
              className="overflow-hidden rounded-md border border-border/70 bg-background/85"
              key={`${receiptNumber}-${index}`}
              value={`sale-${index}`}
            >
              <AccordionPrimitive.Header className="flex">
                <AccordionPrimitive.Trigger className="grid w-full min-w-0 gap-layout-sm px-layout-sm py-layout-sm text-left transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring data-[state=open]:bg-muted/10 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center [&[data-state=open]_.review-sale-chevron]:rotate-180">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      Receipt #{receiptNumber}
                    </p>
                    <p className="truncate text-xs leading-5 text-muted-foreground">
                      {[
                        sale.staffName ? `Cashier ${sale.staffName}` : null,
                        completedAt,
                        sequenceList ? `Upload ${sequenceList}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-layout-sm gap-y-1 text-xs leading-5 text-muted-foreground sm:justify-end">
                    <span className="inline-flex items-center gap-1.5 text-foreground">
                      <PaymentIcon className="h-3.5 w-3.5 text-muted-foreground" />
                      {hasMultiplePaymentMethods
                        ? "Multiple"
                        : formatPaymentMethod(primaryPaymentMethod)}
                    </span>
                    <span className="font-numeric tabular-nums text-foreground">
                      {formatCurrency(currency, sale.total)}
                    </span>
                    <span>{formatSaleItemCount(sale)}</span>
                  </div>
                  <span className="flex shrink-0 items-center self-stretch justify-center text-muted-foreground transition-colors">
                    <ChevronDown className="review-sale-chevron h-4 w-4 shrink-0 transition-transform duration-200" />
                  </span>
                </AccordionPrimitive.Trigger>
              </AccordionPrimitive.Header>
              <AccordionContent className="border-t border-border/70 px-layout-sm pb-layout-sm pt-layout-sm">
                <div className="space-y-layout-sm">
                  {transactionId && orgUrlSlug && storeUrlSlug ? (
                    <div className="flex justify-end">
                      <Link
                        aria-label={`Open transaction for receipt ${receiptNumber}`}
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        params={{
                          orgUrlSlug,
                          storeUrlSlug,
                          transactionId: transactionId as Id<"posTransaction">,
                        }}
                        search={{ o: getOrigin() }}
                        to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId"
                      >
                        Open transaction
                        <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                      </Link>
                    </div>
                  ) : null}
                  <div className="grid gap-layout-sm lg:grid-cols-[minmax(0,1fr)_minmax(14rem,0.7fr)]">
                    <div className="space-y-layout-xs">
                      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Items
                      </p>
                      {sale.items?.length ? (
                        <div className="divide-y divide-border/70 rounded-md border border-border/70 bg-muted/10">
                          {sale.items.map((item, itemIndex) => (
                            <div
                              className="grid gap-1 px-layout-sm py-layout-xs text-xs sm:grid-cols-[minmax(0,1fr)_auto]"
                              key={`${item.name}-${itemIndex}`}
                            >
                              <div className="min-w-0">
                                <p className="truncate font-medium text-foreground">
                                  {formatSaleItemName(item.name)}
                                </p>
                                {item.sku ? (
                                  <p className="text-muted-foreground">
                                    {item.sku}
                                  </p>
                                ) : null}
                              </div>
                              <div className="text-left sm:text-right">
                                {typeof item.quantity === "number" ? (
                                  <p className="text-muted-foreground">
                                    Qty {item.quantity}
                                  </p>
                                ) : null}
                                {typeof item.total === "number" ? (
                                  <p className="font-numeric tabular-nums text-foreground">
                                    {formatCurrency(currency, item.total)}
                                  </p>
                                ) : null}
                              </div>
                            </div>
                          ))}
                          {itemsTotal ? (
                            <div className="flex items-center justify-between gap-layout-sm px-layout-sm py-layout-xs text-xs">
                              <span className="text-muted-foreground">
                                Items total
                              </span>
                              <span className="font-numeric tabular-nums text-foreground">
                                {formatCurrency(currency, itemsTotal)}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <p className="text-xs leading-5 text-muted-foreground">
                          Item details were not included with this synced sale.
                        </p>
                      )}
                    </div>
                    <div className="space-y-layout-xs">
                      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Sale impact
                      </p>
                      <dl className="grid gap-layout-xs rounded-md border border-border/70 bg-muted/10 px-layout-sm py-layout-xs text-xs">
                        <div className="flex items-center justify-between gap-layout-sm">
                          <dt className="text-muted-foreground">Payment</dt>
                          <dd className="inline-flex items-center gap-1.5 text-right text-foreground">
                            <PaymentIcon className="h-3.5 w-3.5 text-muted-foreground" />
                            {formatPaymentMethods(sale.paymentMethods)}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-layout-sm">
                          <dt className="text-muted-foreground">Cash impact</dt>
                          <dd className="font-numeric tabular-nums text-foreground">
                            {typeof sale.cashAmount === "number" &&
                            sale.cashAmount > 0
                              ? formatCurrency(currency, sale.cashAmount)
                              : "None recorded"}
                          </dd>
                        </div>
                        <div className="flex items-center justify-between gap-layout-sm">
                          <dt className="text-muted-foreground">Items</dt>
                          <dd className="text-foreground">
                            {formatSaleItemCount(sale)}
                          </dd>
                        </div>
                      </dl>
                      <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                        Review reason
                      </p>
                      <div className="rounded-md border border-border/70 bg-muted/10 px-layout-sm py-layout-xs">
                        <p className="text-xs leading-5 text-muted-foreground">
                          {reviewReasons.length > 0
                            ? `${reviewReasons
                                .map((reason) => reason.replace(/[.!?]+$/, ""))
                                .join("; ")}.`
                            : sale.registerOpeningReviewItems.length > 0
                              ? "This sale is shown as evidence for the duplicate register-opening review."
                              : "This sale needs manager review before it is applied."}
                        </p>
                      </div>
                    </div>
                  </div>
                  <InventoryReviewList
                    orgUrlSlug={orgUrlSlug}
                    sale={sale}
                    storeUrlSlug={storeUrlSlug}
                  />
                  {onReviewDecision && sale.reviewItems.length > 0 ? (
                    <RegisterSyncReviewItemDecisionList
                      isResolving={isResolving}
                      items={sale.reviewItems}
                      onReviewDecision={onReviewDecision}
                    />
                  ) : null}
                </div>
              </AccordionContent>
            </AccordionItem>
          );
        })}
      </Accordion>
    </div>
  );
}

function RegisterSyncReviewItemDecisionList({
  description = "Resolve only the review item that matches this sale decision.",
  isResolving,
  items,
  onReviewDecision,
}: {
  description?: string;
  isResolving?: boolean;
  items: PosReconciliationItem[];
  onReviewDecision: (
    decision: "approved" | "rejected",
    options?: ResolveSyncReviewDecisionOptions,
  ) => void;
}) {
  const duplicateItems = items.filter(isDuplicateLocalIdRegisterSyncReviewItem);
  const decisionItems = duplicateItems.length > 0 ? duplicateItems : items;
  const actionableItems = decisionItems.filter((item) => item.id);
  const approveConflictIds = actionableItems.some(
    isDuplicatePosSessionSaleReviewItem,
  )
    ? actionableItems.flatMap((item) => (item.id ? [item.id] : []))
    : null;

  if (actionableItems.length === 0) {
    return null;
  }

  return (
    <div className="space-y-layout-xs">
      <div className="space-y-1">
        <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
          Review decisions
        </p>
        <p className="text-xs leading-5 text-muted-foreground">{description}</p>
      </div>
      <div className="grid gap-layout-xs">
        {actionableItems.map((item, index) => {
          const labels = getRegisterSyncReviewItemActionLabels(item);
          const reviewConflictIds = item.id ? [item.id] : undefined;
          const approveReviewConflictIds =
            approveConflictIds ?? reviewConflictIds;

          return (
            <article
              className="grid gap-layout-sm rounded-md border border-border/70 bg-background/80 p-layout-sm sm:grid-cols-[minmax(0,1fr)_auto]"
              key={item.id ?? `${item.type ?? "review"}-${index}`}
            >
              <div className="min-w-0 space-y-1">
                <p className="text-xs font-medium text-foreground">
                  {formatPosReconciliationType(item.type, item)}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {getRegisterSyncReviewItemSummary(item)}
                </p>
              </div>
              <div className="flex flex-col gap-layout-xs sm:flex-row sm:items-center">
                {isApprovableRegisterSyncReviewItem(item) ? (
                  <LoadingButton
                    className="w-full sm:w-auto"
                    disabled={isResolving}
                    isLoading={Boolean(isResolving)}
                    onClick={() =>
                      onReviewDecision("approved", {
                        approveLabel: labels.approveLabel,
                        reviewConflictIds: approveReviewConflictIds,
                      })
                    }
                    size="sm"
                    type="button"
                    variant="default"
                  >
                    {labels.approveLabel}
                  </LoadingButton>
                ) : null}
                <Button
                  className="w-full border-destructive/30 bg-background text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                  disabled={isResolving}
                  onClick={() =>
                    onReviewDecision("rejected", {
                      rejectLabel: labels.rejectLabel,
                      reviewConflictIds,
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {labels.rejectLabel}
                </Button>
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}

function formatReviewItemActivity(item: PosReconciliationItem) {
  const localEventId = item.localEventId?.toLowerCase() ?? "";
  const summary = item.summary?.toLowerCase() ?? "";

  if (isRegisterCloseoutReviewItem(item)) {
    return "Register closeout with variance came from local register activity.";
  }

  if (localEventId.includes("sale-completed")) {
    if (item.type === "permission" && summary.includes("not open")) {
      return "Sale completed while Athena did not have this register open.";
    }

    return "Sale completed from local register activity.";
  }

  if (localEventId.includes("register-opened")) {
    return "Register opening came from local register activity.";
  }

  if (
    localEventId.includes("register-closed") ||
    localEventId.includes("register-closeout")
  ) {
    return "Register closeout came from local register activity.";
  }

  if (localEventId.includes("payment")) {
    return "Payment update came from local register activity.";
  }

  return "Local register activity needs review before it is treated as settled.";
}

function isClosedRegisterSyncedCloseoutReviewItem(item: PosReconciliationItem) {
  if (item.reviewKind === "duplicate_register_closeout") {
    return true;
  }

  const summary = item.summary?.trim().toLowerCase() ?? "";

  return summary.includes(CLOSED_REGISTER_SYNCED_CLOSEOUT_SUMMARY);
}

function isVisibleRegisterSyncReviewItem(item: PosReconciliationItem) {
  return !(
    item.status === "rejected" && isClosedRegisterSyncedCloseoutReviewItem(item)
  );
}

function hasOnlyRejectedSyncReviewItems(syncStatus: PosSyncStatusPresentation) {
  const visibleItems = syncStatus.reconciliationItems.filter(
    isVisibleRegisterSyncReviewItem,
  );

  return (
    syncStatus.status === "needs_review" &&
    visibleItems.length > 0 &&
    visibleItems.every((item) => item.status === "rejected")
  );
}

function getAutomaticStaffAccessSyncReviewSignature(
  registerSession?: RegisterSessionDetail | null,
) {
  const syncStatus = buildPosSyncStatusPresentation(
    registerSession?.localSyncStatus,
  );
  if (
    !registerSession ||
    syncStatus.status !== "needs_review" ||
    syncStatus.reconciliationItems.length === 0
  ) {
    return null;
  }

  const unresolvedItems = syncStatus.reconciliationItems.filter(
    (item) => item.status !== "rejected",
  );
  if (
    unresolvedItems.length === 0 ||
    unresolvedItems.some((item) =>
      item.reviewKind
        ? item.reviewKind !== "staff_access"
        : item.type !== "permission" ||
          item.summary?.trim() !== STAFF_ACCESS_SYNC_REVIEW_SUMMARY,
    )
  ) {
    return null;
  }

  return [
    registerSession._id,
    ...unresolvedItems.map(
      (item) =>
        `${item.id ?? item.localEventId ?? "event"}:${item.sequence ?? ""}`,
    ),
  ].join("|");
}

function isApprovableRegisterSyncReviewItem(item: PosReconciliationItem) {
  if (item.status === "rejected") {
    return true;
  }

  if (item.actionPolicy) {
    return item.actionPolicy !== "reject_only";
  }

  return (
    (isRegisterCloseoutReviewItem(item) &&
      !isClosedRegisterSyncedCloseoutReviewItem(item)) ||
    (item.type === "permission" &&
      (item.summary?.trim() === REGISTER_NOT_OPEN_SYNC_REVIEW_SUMMARY ||
        item.summary?.trim() === STAFF_ACCESS_SYNC_REVIEW_SUMMARY))
  );
}

function hasServiceCustomerAttributionReview(items: PosReconciliationItem[]) {
  return items.some(
    (item) =>
      item.reviewKind === "service_customer_attribution" ||
      item.summary?.trim() === SERVICE_CUSTOMER_ATTRIBUTION_SYNC_REVIEW_SUMMARY,
  );
}

function getCombinedReviewNextStep(items: PosReconciliationItem[]) {
  if (hasServiceCustomerAttributionReview(items)) {
    return "This synced activity cannot be applied because a service line is missing customer attribution. Reject it to clear this review, then recreate the service work with a customer if needed.";
  }

  if (items.some(isDuplicatePosSessionSaleReviewItem)) {
    return "Preserve the synced sale as a completed transaction without reusing the duplicate POS session, or reject the sale evidence if it is not valid.";
  }

  if (items.every(isDuplicateLocalIdRegisterSyncReviewItem)) {
    return "Reject the duplicate register-opening evidence to keep the current register session. Any sale details shown below are evidence only.";
  }

  if (items.some((item) => !isApprovableRegisterSyncReviewItem(item))) {
    return "This synced activity needs correction before it can be applied. Reject it to clear this review, then correct the sale from the appropriate workflow if needed.";
  }

  if (items.some(isMissingRegisterSessionMappingReviewItem)) {
    return "Manager sign-in repairs the completed sale link to this register session so the drawer can be settled.";
  }

  if (
    items.some(
      (item) =>
        item.reviewKind === "inventory_review" ||
        item.type === "inventory" ||
        item.type === "inventory_conflict",
    )
  ) {
    return "Manager sign-in reviews the inventory details and applies the synced sale activity to this register session.";
  }

  return "Manager sign-in reviews and applies the synced register activity to this register session.";
}

function isInventoryRegisterSyncReviewItem(item: PosReconciliationItem) {
  return (
    item.reviewKind === "inventory_review" ||
    item.type === "inventory" ||
    item.type === "inventory_conflict"
  );
}

function isMissingRegisterSessionMappingReviewItem(
  item: PosReconciliationItem,
) {
  return (
    item.reviewKind === "missing_register_session_mapping" ||
    item.summary?.trim() ===
      MISSING_REGISTER_SESSION_MAPPING_SYNC_REVIEW_SUMMARY
  );
}

function isDuplicateLocalIdRegisterSyncReviewItem(item: PosReconciliationItem) {
  return isDuplicateLocalIdReviewItem(item);
}

function getRegisterSyncReviewItemActionLabels(item: PosReconciliationItem) {
  if (isRegisterCloseoutReviewItem(item)) {
    return {
      approveLabel: isClosedRegisterSyncedCloseoutReviewItem(item)
        ? "Apply duplicate closeout"
        : "Apply synced closeout",
      rejectLabel: isClosedRegisterSyncedCloseoutReviewItem(item)
        ? "Reject duplicate closeout"
        : "Reject synced closeout",
    };
  }

  if (isDuplicatePosSessionSaleReviewItem(item)) {
    return {
      approveLabel: "Preserve synced sale",
      rejectLabel: "Reject duplicate sale evidence",
    };
  }

  if (isDuplicateLocalIdRegisterSyncReviewItem(item)) {
    return {
      approveLabel: "Apply duplicate register opening",
      rejectLabel: "Reject duplicate register opening",
    };
  }

  if (isInventoryRegisterSyncReviewItem(item)) {
    return {
      approveLabel: "Apply inventory review item",
      rejectLabel: "Reject inventory review item",
    };
  }

  if (isMissingRegisterSessionMappingReviewItem(item)) {
    return {
      approveLabel: "Repair sale mapping",
      rejectLabel: "Reject sale mapping review",
    };
  }

  return {
    approveLabel: "Apply review item",
    rejectLabel: "Reject review item",
  };
}

function getRegisterSyncReviewItemSummary(item: PosReconciliationItem) {
  if (isDuplicatePosSessionSaleReviewItem(item)) {
    return "This sale reused a local POS session that belongs to another transaction. Preserve it to record the receipt without changing that POS session.";
  }

  if (isDuplicateLocalIdRegisterSyncReviewItem(item)) {
    return "Duplicate synced register opening. Reject this item to keep the current register session and clear the review.";
  }

  if (isInventoryRegisterSyncReviewItem(item)) {
    return "Inventory needs manager review before this synced sale can be applied.";
  }

  if (isMissingRegisterSessionMappingReviewItem(item)) {
    return "Completed sale needs its register-session link repaired before this drawer can be settled.";
  }

  if (item.reviewKind === "register_closeout_variance") {
    return "Closeout variance needs manager review before this synced closeout can be applied.";
  }

  if (item.reviewKind === "duplicate_register_closeout") {
    return "This synced closeout has already been reviewed. Reject this item to clear it.";
  }

  if (
    item.reviewKind === "service_customer_attribution" ||
    item.summary?.trim() === SERVICE_CUSTOMER_ATTRIBUTION_SYNC_REVIEW_SUMMARY
  ) {
    return "Service customer attribution is missing. Reject this item, then recreate the service work with a customer if needed.";
  }

  if (
    item.reviewKind === "staff_access" ||
    item.summary?.trim() === STAFF_ACCESS_SYNC_REVIEW_SUMMARY
  ) {
    return "Staff access changed before this local register activity synced.";
  }

  if (
    item.reviewKind === "register_not_open_sale" ||
    item.summary?.trim() === REGISTER_NOT_OPEN_SYNC_REVIEW_SUMMARY
  ) {
    return "Drawer state needs manager review before this synced sale can be applied.";
  }

  return "Review synced register activity before it is applied.";
}

function getRegisterSyncReviewDecisionScope(item: PosReconciliationItem) {
  if (isDuplicatePosSessionSaleReviewItem(item)) {
    return "duplicate_pos_session_sale";
  }

  if (isDuplicateLocalIdRegisterSyncReviewItem(item)) {
    return "duplicate_register_open";
  }

  if (isInventoryRegisterSyncReviewItem(item)) {
    return "inventory";
  }

  if (isMissingRegisterSessionMappingReviewItem(item)) {
    return "missing_register_session_mapping";
  }

  if (isRegisterCloseoutReviewItem(item)) {
    return "register_closeout";
  }

  if (
    item.reviewKind === "service_customer_attribution" ||
    item.summary?.trim() === SERVICE_CUSTOMER_ATTRIBUTION_SYNC_REVIEW_SUMMARY
  ) {
    return "service_customer_attribution";
  }

  return `${item.actionPolicy ?? "default"}:${item.reviewKind ?? item.type ?? "unknown"}`;
}

function hasUniformRegisterSyncReviewDecisionScope(
  items: PosReconciliationItem[],
) {
  const scopes = new Set(items.map(getRegisterSyncReviewDecisionScope));

  return scopes.size <= 1;
}

function RegisterSessionSyncNotice({
  currency,
  errorMessage,
  isResolving,
  onReviewDecision,
  orgUrlSlug,
  storeUrlSlug,
  syncStatus,
}: {
  currency: string;
  errorMessage?: string;
  isResolving?: boolean;
  onReviewDecision?: (
    decision: "approved" | "rejected",
    options?: ResolveSyncReviewDecisionOptions,
  ) => void;
  orgUrlSlug?: string;
  storeUrlSlug?: string;
  syncStatus: PosSyncStatusPresentation;
}) {
  if (syncStatus.status === "synced") {
    return null;
  }

  const reconciliationItems = syncStatus.reconciliationItems.filter(
    isVisibleRegisterSyncReviewItem,
  );
  if (
    syncStatus.status === "needs_review" &&
    reconciliationItems.length === 0
  ) {
    return null;
  }

  const hasOnlyRejectedReviewItems = hasOnlyRejectedSyncReviewItems(syncStatus);
  const hasClosedRegisterSyncedCloseout = reconciliationItems.some(
    isClosedRegisterSyncedCloseoutReviewItem,
  );
  const hasCloseoutReview = reconciliationItems.some(
    isRegisterCloseoutReviewItem,
  );
  const hasDuplicateRegisterOpenReview = reconciliationItems.some(
    isDuplicateLocalIdRegisterSyncReviewItem,
  );
  const closeoutReviewCount = reconciliationItems.filter(
    isRegisterCloseoutReviewItem,
  ).length;
  const hasMixedReviewQueue =
    hasCloseoutReview && reconciliationItems.length > closeoutReviewCount;
  const noticeLabel = hasClosedRegisterSyncedCloseout
    ? "Synced closeout cannot be applied"
    : hasOnlyRejectedReviewItems
      ? "Manager override available"
      : syncStatus.status === "locally_closed_pending_sync"
        ? "Pending reconciliation"
        : hasMixedReviewQueue
          ? "Review queue needs attention"
          : hasCloseoutReview
            ? "Closeout needs review"
            : syncStatus.label;
  const noticeDescription = hasClosedRegisterSyncedCloseout
    ? "This register is already closed. Reject the duplicate synced activity to clear the review."
    : hasOnlyRejectedReviewItems
      ? "Rejected local activity can be synced from Cash Controls. A manager can override and apply these events without the cashier present."
      : hasMixedReviewQueue
        ? `${formatReviewItemCount(reconciliationItems.length)} need manager review before this drawer can be settled.`
        : syncStatus.description;
  const reviewItems = reconciliationItems;
  const canApproveSyncReview = !hasClosedRegisterSyncedCloseout;
  const shouldCombineReviewItems =
    syncStatus.status === "needs_review" &&
    reconciliationItems.length > 0 &&
    !hasCloseoutReview;
  const hasUnsupportedReviewItems =
    shouldCombineReviewItems &&
    !hasOnlyRejectedReviewItems &&
    reconciliationItems.some(
      (item) => !isApprovableRegisterSyncReviewItem(item),
    );
  const hasUniformBatchReviewDecision =
    !shouldCombineReviewItems ||
    hasUniformRegisterSyncReviewDecisionScope(reconciliationItems);
  const canApplySyncReview = canApproveSyncReview && !hasUnsupportedReviewItems;
  const shouldShowRejectedReviewAction =
    syncStatus.status === "needs_review" &&
    hasOnlyRejectedReviewItems &&
    Boolean(onReviewDecision);
  const shouldShowRejectedReviewRetryLink =
    syncStatus.status === "needs_review" &&
    hasOnlyRejectedReviewItems &&
    !onReviewDecision &&
    Boolean(orgUrlSlug && storeUrlSlug);
  const shouldShowNeedsReviewBatchActions =
    syncStatus.status === "needs_review" &&
    !hasOnlyRejectedReviewItems &&
    Boolean(onReviewDecision) &&
    hasUniformBatchReviewDecision &&
    !hasDuplicateRegisterOpenReview &&
    !hasMixedReviewQueue;
  const shouldShowReviewItemActions =
    syncStatus.status === "needs_review" &&
    Boolean(onReviewDecision) &&
    hasMixedReviewQueue;
  const shouldShowDuplicateOpeningItemActions =
    syncStatus.status === "needs_review" &&
    Boolean(onReviewDecision) &&
    hasDuplicateRegisterOpenReview &&
    shouldCombineReviewItems;
  const reviewItemDecisionHandler = shouldShowReviewItemActions
    ? onReviewDecision
    : undefined;
  const duplicateOpeningDecisionHandler = shouldShowDuplicateOpeningItemActions
    ? onReviewDecision
    : undefined;
  const shouldShowSyncFooter =
    shouldShowRejectedReviewAction ||
    shouldShowRejectedReviewRetryLink ||
    shouldShowNeedsReviewBatchActions ||
    syncStatus.status !== "needs_review";
  const rejectedSyncQueueSummary = hasOnlyRejectedReviewItems
    ? formatReviewQueueSummary(reconciliationItems)
    : null;
  const rejectedSyncSaleSummaries = hasOnlyRejectedReviewItems
    ? getSyncReviewSaleSummaries(reconciliationItems)
    : [];
  const rejectedPaymentMismatchSummary = hasOnlyRejectedReviewItems
    ? formatPaymentMismatchDetailSummary(rejectedSyncSaleSummaries, currency)
    : null;
  const rejectedSyncNextStep = rejectedPaymentMismatchSummary
    ? "Manager sign-in applies the expected sale total as the collected amount and records the override for audit."
    : "Manager sign-in applies the rejected local activity to this register session and records the override for audit.";
  const reviewQueueSummary = shouldCombineReviewItems
    ? formatReviewQueueSummary(reconciliationItems)
    : null;
  const reviewTypeSummary = shouldCombineReviewItems
    ? formatReviewTypeSummary(reconciliationItems)
    : null;
  const reviewReasonSummary = shouldCombineReviewItems
    ? formatReviewReasonSummary(reconciliationItems)
    : null;
  const allSyncReviewSaleSummaries =
    getSyncReviewSaleSummaries(reconciliationItems);
  const syncReviewSaleSummaries = shouldCombineReviewItems
    ? allSyncReviewSaleSummaries
    : [];
  const duplicateRegisterOpeningReviewItems = shouldCombineReviewItems
    ? reconciliationItems.filter(isDuplicateLocalIdRegisterSyncReviewItem)
    : [];
  const actionCopy = getSyncReviewActionCopy({
    hasCloseoutReview,
    hasDuplicateRegisterOpenReview,
    hasOnlyRejectedReviewItems,
    hasSaleReview:
      syncReviewSaleSummaries.length > 0 ||
      allSyncReviewSaleSummaries.length > 0 ||
      rejectedSyncSaleSummaries.length > 0,
  });
  const rejectedSyncEvidenceDetails = hasOnlyRejectedReviewItems
    ? [
        {
          label: "Items",
          value: `${formatReviewItemCount(reconciliationItems.length)} rejected by the server.`,
        },
        {
          label: "Payment mismatch",
          value: rejectedPaymentMismatchSummary,
        },
      ]
    : [];
  const combinedSyncEvidenceDetails = shouldCombineReviewItems
    ? [
        {
          label: "Items",
          value: `${formatReviewItemCount(reconciliationItems.length)} ${
            reconciliationItems.length === 1 ? "needs" : "need"
          } manager review.`,
        },
        { label: "Reasons", value: reviewReasonSummary },
        { label: "Categories", value: reviewTypeSummary },
      ]
    : [];

  return (
    <section
      className={cn(
        "rounded-lg border p-layout-md",
        hasCloseoutReview
          ? "border-warning-border/40 bg-warning-soft/40"
          : syncStatus.tone === "danger"
            ? "border-danger/25 bg-danger/10"
            : "border-warning/30 bg-warning/10",
      )}
    >
      <div className="grid gap-layout-md">
        <div className="max-w-3xl space-y-1">
          <p
            className={cn(
              "text-[11px] font-medium uppercase tracking-[0.18em]",
              hasCloseoutReview
                ? "text-warning"
                : syncStatus.tone === "danger"
                  ? "text-danger"
                  : "text-warning",
            )}
          >
            {noticeLabel}
          </p>
          <p className="text-pretty text-sm leading-6 text-muted-foreground">
            {noticeDescription}
          </p>
          {hasOnlyRejectedReviewItems ? (
            <div className="pt-layout-xs">
              <div className="grid gap-layout-md rounded-md border border-danger/15 bg-background/70 p-layout-sm md:grid-cols-[minmax(0,0.9fr)_minmax(18rem,1.1fr)]">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Next step
                  </p>
                  <p className="text-sm leading-6 text-foreground">
                    {rejectedSyncNextStep}
                  </p>
                </div>
                <div className="border-t border-border pt-layout-sm md:border-l md:border-t-0 md:pl-layout-sm md:pt-0">
                  <div className="space-y-layout-sm">
                    <SyncReviewDetailGrid
                      details={rejectedSyncEvidenceDetails}
                    />
                    <SyncReviewTimeline
                      items={reconciliationItems}
                      uploadOrder={rejectedSyncQueueSummary}
                    />
                  </div>
                </div>
                <SalesUnderReviewList
                  currency={currency}
                  orgUrlSlug={orgUrlSlug}
                  sales={rejectedSyncSaleSummaries}
                  storeUrlSlug={storeUrlSlug}
                />
              </div>
            </div>
          ) : shouldCombineReviewItems ? (
            <div className="pt-layout-xs">
              <div className="grid gap-layout-md rounded-md border border-danger/15 bg-background/70 p-layout-sm md:grid-cols-[minmax(0,0.9fr)_minmax(18rem,1.1fr)]">
                <div className="space-y-1">
                  <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground">
                    Next step
                  </p>
                  <p className="text-sm leading-6 text-foreground">
                    {getCombinedReviewNextStep(reconciliationItems)}
                  </p>
                </div>
                <div className="border-t border-border pt-layout-sm md:border-l md:border-t-0 md:pl-layout-sm md:pt-0">
                  <div className="space-y-layout-sm">
                    <SyncReviewDetailGrid
                      details={combinedSyncEvidenceDetails}
                    />
                    <SyncReviewTimeline
                      items={reconciliationItems}
                      uploadOrder={reviewQueueSummary}
                    />
                  </div>
                </div>
                {duplicateOpeningDecisionHandler &&
                duplicateRegisterOpeningReviewItems.length > 0 ? (
                  <div className="md:col-span-2">
                    <RegisterSyncReviewItemDecisionList
                      description="Resolve duplicate-opening evidence without clearing the synced sale details shown below."
                      isResolving={isResolving}
                      items={duplicateRegisterOpeningReviewItems}
                      onReviewDecision={duplicateOpeningDecisionHandler}
                    />
                  </div>
                ) : null}
                <SalesUnderReviewList
                  currency={currency}
                  isResolving={isResolving}
                  onReviewDecision={onReviewDecision}
                  orgUrlSlug={orgUrlSlug}
                  sales={syncReviewSaleSummaries}
                  storeUrlSlug={storeUrlSlug}
                />
              </div>
            </div>
          ) : syncStatus.status === "needs_review" &&
            reconciliationItems.length > 0 ? (
            <div className="space-y-2 pt-layout-xs">
              {!hasCloseoutReview || hasMixedReviewQueue ? (
                <p className="text-xs font-medium text-foreground">
                  {formatReviewItemCount(reconciliationItems.length)}
                </p>
              ) : null}
              <div className="grid gap-2">
                {reviewItems.map((item, index) => {
                  const reportedAt = formatReviewItemTimestamp(item.createdAt);
                  const isCloseoutItem = isRegisterCloseoutReviewItem(item);
                  const itemVariance = item.variance ?? null;
                  const itemExpectedCash = item.expectedCash;
                  const itemCountedCash = item.countedCash;
                  const itemNote = item.notes?.trim();

                  return (
                    <article
                      className={cn(
                        "rounded-md border bg-background/80 p-layout-md shadow-sm",
                        isCloseoutItem
                          ? "border-warning-border/40 bg-background/80"
                          : "border-danger/15",
                      )}
                      key={item.id ?? `${item.type ?? "review"}-${index}`}
                    >
                      {isCloseoutItem &&
                      !isClosedRegisterSyncedCloseoutReviewItem(item) ? (
                        <div className="space-y-layout-md">
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                              Closeout variance review
                            </p>
                            <p className="text-pretty text-sm leading-6 text-muted-foreground">
                              Review the synced count before applying this
                              closeout to the drawer.
                            </p>
                          </div>
                          <dl className="grid gap-layout-sm text-sm sm:grid-cols-3">
                            {typeof itemExpectedCash === "number" ? (
                              <div className="rounded-md border border-border/70 bg-muted/20 px-layout-sm py-layout-sm">
                                <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                  Expected
                                </dt>
                                <dd className="mt-1 font-numeric tabular-nums text-foreground">
                                  {formatCurrency(currency, itemExpectedCash)}
                                </dd>
                              </div>
                            ) : null}
                            {typeof itemCountedCash === "number" ? (
                              <div className="rounded-md border border-border/70 bg-muted/20 px-layout-sm py-layout-sm">
                                <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                  Counted
                                </dt>
                                <dd className="mt-1 font-numeric tabular-nums text-foreground">
                                  {formatCurrency(currency, itemCountedCash)}
                                </dd>
                              </div>
                            ) : null}
                            <div className="rounded-md border border-border/70 bg-muted/20 px-layout-sm py-layout-sm">
                              <dt className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Variance
                              </dt>
                              <dd
                                className={cn(
                                  "mt-1 font-numeric tabular-nums",
                                  typeof itemVariance === "number"
                                    ? getVarianceTone(itemVariance)
                                    : "text-foreground",
                                )}
                              >
                                {typeof itemVariance === "number"
                                  ? formatCurrency(currency, itemVariance)
                                  : "Needs review"}
                              </dd>
                            </div>
                          </dl>
                          {itemNote ? (
                            <div className="space-y-2 border-t border-border/70 pt-layout-md">
                              <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Notes
                              </p>
                              <p className="text-pretty text-sm leading-6 text-muted-foreground">
                                {itemNote}
                              </p>
                            </div>
                          ) : null}
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm font-medium text-foreground">
                            {isClosedRegisterSyncedCloseoutReviewItem(item)
                              ? "Duplicate closeout"
                              : formatPosReconciliationType(item.type, item)}
                          </p>
                          <p className="text-pretty text-sm leading-6 text-muted-foreground">
                            {isClosedRegisterSyncedCloseoutReviewItem(item)
                              ? "The synced closeout is from local activity for a register that is already closed."
                              : getRegisterSyncReviewItemSummary(item)}
                          </p>
                        </div>
                      )}
                      {(!isCloseoutItem || hasMixedReviewQueue) &&
                      (item.localEventId ||
                        typeof item.sequence === "number" ||
                        reportedAt) ? (
                        <dl className="mt-layout-sm grid gap-layout-sm text-xs text-muted-foreground sm:grid-cols-3">
                          {item.localEventId ? (
                            <div className="min-w-0">
                              <dt className="font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Activity
                              </dt>
                              <dd className="text-foreground">
                                {formatReviewItemActivity(item)}
                              </dd>
                            </div>
                          ) : null}
                          {typeof item.sequence === "number" ? (
                            <div>
                              <dt className="font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Upload order
                              </dt>
                              <dd className="text-foreground">
                                #{item.sequence} in local queue
                              </dd>
                            </div>
                          ) : null}
                          {reportedAt ? (
                            <div>
                              <dt className="font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                Reported
                              </dt>
                              <dd className="text-foreground">{reportedAt}</dd>
                            </div>
                          ) : null}
                        </dl>
                      ) : null}
                      {reviewItemDecisionHandler && item.id ? (
                        <div className="mt-layout-md border-t border-border/70 pt-layout-md">
                          <RegisterSyncReviewItemDecisionList
                            isResolving={isResolving}
                            items={[item]}
                            onReviewDecision={reviewItemDecisionHandler}
                          />
                        </div>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            </div>
          ) : null}
          {errorMessage ? (
            <p className="text-sm leading-6 text-destructive">{errorMessage}</p>
          ) : null}
        </div>
        {shouldShowSyncFooter ? (
          <div
            className={cn(
              "flex w-full flex-col gap-layout-sm border-t pt-layout-md sm:flex-row sm:flex-wrap sm:items-center",
              hasCloseoutReview
                ? "border-warning-border/40"
                : "border-border/70",
            )}
          >
            {shouldShowRejectedReviewAction ? (
              <LoadingButton
                className="w-full border-border bg-background text-foreground hover:bg-muted sm:w-auto"
                disabled={isResolving}
                isLoading={Boolean(isResolving)}
                onClick={() => onReviewDecision?.("approved")}
                size="sm"
                type="button"
                variant="outline"
              >
                Override and sync events
              </LoadingButton>
            ) : shouldShowRejectedReviewRetryLink &&
              orgUrlSlug &&
              storeUrlSlug ? (
              <Button
                asChild
                className="w-full border-border bg-background text-foreground hover:bg-muted sm:w-auto"
                size="sm"
                variant="outline"
              >
                <Link
                  params={{ orgUrlSlug, storeUrlSlug }}
                  search={{ o: getOrigin() }}
                  to="/$orgUrlSlug/store/$storeUrlSlug/pos/register"
                >
                  <span>Open POS to retry sync</span>
                  <ArrowUpRight className="size-3.5" aria-hidden="true" />
                </Link>
              </Button>
            ) : null}
            {shouldShowNeedsReviewBatchActions ? (
              <>
                {canApplySyncReview ? (
                  <LoadingButton
                    className="w-full sm:w-auto"
                    disabled={isResolving}
                    isLoading={Boolean(isResolving)}
                    onClick={() => onReviewDecision?.("approved")}
                    size="sm"
                    type="button"
                    variant="default"
                  >
                    {actionCopy.approveLabel}
                  </LoadingButton>
                ) : null}
                <Button
                  className="w-full border-destructive/30 bg-background text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-auto"
                  disabled={isResolving}
                  onClick={() => onReviewDecision?.("rejected")}
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  {actionCopy.rejectLabel}
                </Button>
              </>
            ) : null}
            {syncStatus.status !== "needs_review" ? (
              <Badge
                className={getSyncBadgeClass(syncStatus.tone)}
                size="sm"
                variant="outline"
              >
                {syncStatus.pendingEventCount
                  ? `${syncStatus.pendingEventCount} pending`
                  : syncStatus.label}
              </Badge>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

function RegisterSessionTransactionCard({
  canOpenTransaction,
  currency,
  onOpen,
  transaction,
}: {
  canOpenTransaction: boolean;
  currency: string;
  onOpen?: () => void;
  transaction: RegisterSessionTransaction;
}) {
  const PaymentIcon = getPaymentMethodIcon({
    hasMultiplePaymentMethods: transaction.hasMultiplePaymentMethods,
    paymentMethod: transaction.paymentMethod,
  });
  const transactionLabel = `#${transaction.transactionNumber}`;
  const isVoidedTransaction =
    transaction.status === "void" || typeof transaction.voidedAt === "number";

  return (
    <article
      aria-label={
        canOpenTransaction ? `Open transaction ${transactionLabel}` : undefined
      }
      className={cn(
        "rounded-lg border border-border/70 bg-background p-layout-md transition-colors",
        canOpenTransaction &&
          "cursor-pointer hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      )}
      onClick={canOpenTransaction ? onOpen : undefined}
      onKeyDown={
        canOpenTransaction
          ? (event) => {
              if (event.key !== "Enter" && event.key !== " ") {
                return;
              }

              event.preventDefault();
              onOpen?.();
            }
          : undefined
      }
      role={canOpenTransaction ? "link" : undefined}
      tabIndex={canOpenTransaction ? 0 : undefined}
    >
      <div className="flex items-start justify-between gap-layout-md">
        <div className="min-w-0 space-y-1">
          <p className="inline-flex min-w-0 items-center gap-1 font-medium text-foreground">
            <span className="truncate">{transactionLabel}</span>
            {canOpenTransaction ? (
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
            ) : null}
          </p>
          <p className="text-xs leading-5 text-muted-foreground">
            {transaction.itemCount}{" "}
            {transaction.itemCount === 1 ? "item" : "items"}
            {transaction.customerName ? ` - ${transaction.customerName}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-numeric text-sm tabular-nums text-foreground">
            {formatCurrency(currency, transaction.total)}
          </p>
          {isVoidedTransaction ? (
            <span className="mt-1 inline-flex rounded-sm border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
              Voided
            </span>
          ) : null}
        </div>
      </div>
      <dl className="mt-layout-md grid gap-layout-sm border-t border-border/70 pt-layout-sm">
        <div className="flex items-center justify-between gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Payment
          </dt>
          <dd className="inline-flex items-center gap-2 text-sm leading-5 text-foreground">
            <PaymentIcon className="h-4 w-4 text-muted-foreground" />
            {transaction.hasMultiplePaymentMethods
              ? "Multiple"
              : formatPaymentMethod(transaction.paymentMethod)}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Cashier
          </dt>
          <dd className="text-right text-sm leading-5 text-foreground">
            {transaction.cashierName
              ? formatStaffDisplayName({ fullName: transaction.cashierName })
              : "N/A"}
          </dd>
        </div>
        <div className="flex items-center justify-between gap-layout-sm">
          <dt className="text-xs font-medium uppercase leading-5 tracking-[0.12em] text-muted-foreground">
            Completed
          </dt>
          <dd className="text-right text-sm leading-5 text-foreground">
            {formatTimestamp(transaction.completedAt)}
          </dd>
        </div>
      </dl>
    </article>
  );
}

export function RegisterSessionViewContent({
  actorStaffProfileId,
  canViewFinancialDetails = true,
  currency,
  isLoading,
  onAuthenticateForApproval,
  onAuthenticateStaff,
  onAuthenticateCloseoutReviewApproval,
  onCorrectOpeningFloat,
  onFinalizeCloseout,
  onReopenCloseout,
  onNavigateBack,
  onReviewCloseout,
  onResolveSyncReview,
  onSubmitCloseout,
  orgUrlSlug,
  registerSessionSnapshot,
  storeId,
  storeUrlSlug,
}: RegisterSessionViewContentProps) {
  const navigate = useNavigate();
  const registerSession = registerSessionSnapshot?.registerSession ?? null;
  const [countedCash, setCountedCash] = useState("");
  const [closeoutNotes, setCloseoutNotes] = useState("");
  const [managerNotes, setManagerNotes] = useState("");
  const [closeoutErrorMessage, setCloseoutErrorMessage] = useState("");
  const [pendingCloseoutAction, setPendingCloseoutAction] = useState<
    "approved" | "finalize" | "rejected" | "reopen" | "submit" | null
  >(null);
  const [syncReviewErrorMessage, setSyncReviewErrorMessage] = useState("");
  const [isResolvingSyncReview, setIsResolvingSyncReview] = useState(false);
  const [closeoutStaffAuthIntent, setCloseoutStaffAuthIntent] =
    useState<CloseoutStaffAuthIntent | null>(null);
  const [reopenedCloseoutSubmitIntent, setReopenedCloseoutSubmitIntent] =
    useState<ReopenedCloseoutSubmitIntent | null>(null);
  const [
    isReopenedCloseoutSubmitApprovalOpen,
    setIsReopenedCloseoutSubmitApprovalOpen,
  ] = useState(false);
  const [isOpeningFloatCorrectionOpen, setIsOpeningFloatCorrectionOpen] =
    useState(false);
  const [correctedOpeningFloat, setCorrectedOpeningFloat] = useState("");
  const [openingFloatCorrectionReason, setOpeningFloatCorrectionReason] =
    useState("");
  const [openingFloatCorrectionError, setOpeningFloatCorrectionError] =
    useState("");
  const [openingFloatCorrectionInfo, setOpeningFloatCorrectionInfo] =
    useState("");
  const [openingFloatCorrectionSuccess, setOpeningFloatCorrectionSuccess] =
    useState("");
  const [openingFloatCorrectionIntent, setOpeningFloatCorrectionIntent] =
    useState<OpeningFloatCorrectionIntent | null>(null);
  const [pendingOpeningFloatApproval, setPendingOpeningFloatApproval] =
    useState<ApprovalRequirement | null>(null);
  const [isCorrectingOpeningFloat, setIsCorrectingOpeningFloat] =
    useState(false);
  const [isReopenApprovalOpen, setIsReopenApprovalOpen] = useState(false);
  const [isItemsBreakdownOpen, setIsItemsBreakdownOpen] = useState(false);
  const closeoutApprovalRunner = useApprovedCommand({
    storeId: storeId as Id<"store"> | undefined,
    onAuthenticateForApproval:
      onAuthenticateForApproval ??
      (() =>
        Promise.resolve(
          userError({
            code: "unavailable",
            message:
              "Manager approval is not available yet. Try again after the register tools refresh.",
          }),
        )),
  });
  useEffect(() => {
    if (!registerSession?._id) {
      setCountedCash("");
      setCloseoutNotes("");
      setManagerNotes("");
      setCloseoutErrorMessage("");
      setPendingCloseoutAction(null);
      setCloseoutStaffAuthIntent(null);
      setReopenedCloseoutSubmitIntent(null);
      setIsReopenedCloseoutSubmitApprovalOpen(false);
      setIsOpeningFloatCorrectionOpen(false);
      setCorrectedOpeningFloat("");
      setOpeningFloatCorrectionReason("");
      setOpeningFloatCorrectionError("");
      setOpeningFloatCorrectionInfo("");
      setOpeningFloatCorrectionSuccess("");
      setOpeningFloatCorrectionIntent(null);
      setPendingOpeningFloatApproval(null);
      setIsReopenApprovalOpen(false);
      setIsItemsBreakdownOpen(false);
      return;
    }

    setCountedCash(
      registerSession.countedCash !== undefined
        ? formatStoredAmountForInput(registerSession.countedCash)
        : "",
    );
    setCloseoutNotes("");
    setManagerNotes("");
    setCloseoutErrorMessage("");
    setPendingCloseoutAction(null);
    setCloseoutStaffAuthIntent(null);
    setReopenedCloseoutSubmitIntent(null);
    setIsReopenedCloseoutSubmitApprovalOpen(false);
    setIsOpeningFloatCorrectionOpen(false);
    setCorrectedOpeningFloat(
      formatStoredAmountForInput(registerSession.openingFloat),
    );
    setOpeningFloatCorrectionReason("");
    setOpeningFloatCorrectionError("");
    setOpeningFloatCorrectionInfo("");
    setOpeningFloatCorrectionSuccess("");
    setOpeningFloatCorrectionIntent(null);
    setPendingOpeningFloatApproval(null);
    setIsReopenApprovalOpen(false);
    setIsItemsBreakdownOpen(false);
  }, [
    registerSession?._id,
    registerSession?.countedCash,
    registerSession?.openingFloat,
  ]);

  const reopenCloseoutApproval = useMemo<ApprovalRequirement | null>(() => {
    if (!registerSession || !storeId) {
      return null;
    }

    return {
      action: {
        key: "cash_controls.register_session.reopen_closeout",
        label: "Reopen register closeout",
      },
      copy: {
        title: "Manager approval required",
        message: "Manager approval is required to reopen this saved closeout.",
        primaryActionLabel: "Reopen closeout",
        secondaryActionLabel: "Cancel",
      },
      reason: "Manager approval is required to reopen this saved closeout.",
      requiredRole: "manager",
      resolutionModes: [{ kind: "inline_manager_proof" }],
      subject: {
        id: registerSession._id,
        label: formatRegisterCloseoutSubjectLabel(
          registerSession.registerNumber,
        ),
        type: "register_session",
      },
    };
  }, [registerSession, storeId]);

  const latestCloseoutRecord = registerSession?.closeoutRecords?.at(-1) ?? null;
  const reopenedCloseoutRecord =
    latestCloseoutRecord?.type === "reopened" ? latestCloseoutRecord : null;
  const requiresReopenedCloseoutSubmitApproval =
    registerSession?.status === "closing" && Boolean(reopenedCloseoutRecord);
  const isReopenedCloseoutCorrection = requiresReopenedCloseoutSubmitApproval;

  const reopenedCloseoutSubmitApproval =
    useMemo<ApprovalRequirement | null>(() => {
      if (
        !registerSession ||
        !storeId ||
        !requiresReopenedCloseoutSubmitApproval
      ) {
        return null;
      }

      return {
        action: {
          key: "cash_controls.register_session.submit_reopened_closeout",
          label: "Submit reopened register closeout",
        },
        copy: {
          title: "Manager approval required",
          message:
            "The manager who reopened this closeout must submit the corrected count.",
          primaryActionLabel: "Submit correction",
          secondaryActionLabel: "Cancel",
        },
        reason:
          "The manager who reopened this closeout must submit the corrected count.",
        requiredRole: "manager",
        resolutionModes: [{ kind: "inline_manager_proof" }],
        subject: {
          id: registerSession._id,
          label: formatRegisterCloseoutSubjectLabel(
            registerSession.registerNumber,
          ),
          type: "register_session",
        },
      };
    }, [registerSession, requiresReopenedCloseoutSubmitApproval, storeId]);

  const applyCloseoutCommandResult = (
    result: RegisterCloseoutCommandResult,
  ) => {
    if (isApprovalRequiredResult(result)) {
      setCloseoutErrorMessage("");
      return true;
    }

    if (result.kind === "ok") {
      setCloseoutErrorMessage("");
      return true;
    }

    setCloseoutErrorMessage(result.error.message);
    return false;
  };

  async function handleSubmitCloseout() {
    if (!registerSession?._id) {
      setCloseoutErrorMessage(
        "A register session is required before submitting a closeout",
      );
      return;
    }

    const parsedCountedCash = parseDisplayAmountInput(countedCash);

    if (parsedCountedCash === undefined) {
      setCloseoutErrorMessage(
        "Enter the counted cash before submitting the closeout",
      );
      return;
    }

    const trimmedCloseoutNotes = trimOptional(closeoutNotes);
    setCloseoutErrorMessage("");

    if (requiresReopenedCloseoutSubmitApproval) {
      if (
        !onAuthenticateForApproval ||
        !storeId ||
        !reopenedCloseoutSubmitApproval
      ) {
        setCloseoutErrorMessage(
          "Manager approval is not available yet. Try again after the register tools refresh.",
        );
        return;
      }

      setReopenedCloseoutSubmitIntent({
        countedCash: parsedCountedCash,
        notes: trimmedCloseoutNotes,
        registerSessionId: registerSession._id,
        reopenedByStaffProfileId: reopenedCloseoutRecord?.actorStaffProfileId,
      });
      setIsReopenedCloseoutSubmitApprovalOpen(true);
      return;
    }

    setCloseoutStaffAuthIntent({
      kind: "submit",
      countedCash: parsedCountedCash,
      notes: trimmedCloseoutNotes,
      registerSessionId: registerSession._id,
    });
  }

  async function handleFinalizeCloseout() {
    if (!registerSession?._id) {
      setCloseoutErrorMessage(
        "A register session is required before finalizing a closeout",
      );
      return;
    }

    if (!onFinalizeCloseout) {
      setCloseoutErrorMessage(
        "Closeout finalization is not available yet. Try again after the register tools refresh.",
      );
      return;
    }

    setCloseoutErrorMessage("");
    setCloseoutStaffAuthIntent({
      kind: "finalize",
      registerSessionId: registerSession._id,
    });
  }

  async function handleReviewCloseout(decision: "approved" | "rejected") {
    if (!registerSession?._id) {
      setCloseoutErrorMessage(
        "A register session is required before reviewing a closeout",
      );
      return;
    }

    setCloseoutErrorMessage("");
    setCloseoutStaffAuthIntent({
      kind: "review",
      decision,
      decisionNotes: trimOptional(managerNotes),
      registerSessionId: registerSession._id,
    });
  }

  async function handleReopenClosedCloseout() {
    if (!registerSession?._id) {
      setCloseoutErrorMessage(
        "A register session is required before reopening a closeout",
      );
      return;
    }

    if (!onReopenCloseout) {
      setCloseoutErrorMessage(
        "Closeout reopening is not available yet. Try again after the register tools refresh.",
      );
      return;
    }

    if (!onAuthenticateForApproval || !storeId || !reopenCloseoutApproval) {
      setCloseoutErrorMessage(
        "Manager approval is not available yet. Try again after the register tools refresh.",
      );
      return;
    }

    setCloseoutErrorMessage("");
    setIsReopenApprovalOpen(true);
  }

  async function handleSubmitOpeningFloatCorrection() {
    if (!registerSession?._id) {
      setOpeningFloatCorrectionError(
        "A register session is required before correcting opening float",
      );
      setOpeningFloatCorrectionInfo("");
      return;
    }

    if (!["open", "active"].includes(registerSession.status)) {
      setOpeningFloatCorrectionError(
        "Opening float can only be corrected while the drawer is open",
      );
      setOpeningFloatCorrectionInfo("");
      return;
    }

    const parsedOpeningFloat = parseDisplayAmountInput(correctedOpeningFloat);
    const trimmedReason = openingFloatCorrectionReason.trim();

    if (parsedOpeningFloat === undefined) {
      setOpeningFloatCorrectionError("Enter the corrected opening float");
      setOpeningFloatCorrectionInfo("");
      return;
    }

    if (parsedOpeningFloat === registerSession.openingFloat) {
      setOpeningFloatCorrectionError("");
      setOpeningFloatCorrectionInfo(
        "Corrected amount matches the current opening float. Enter a different amount to submit a correction.",
      );
      setOpeningFloatCorrectionSuccess("");
      setOpeningFloatCorrectionIntent(null);
      setPendingOpeningFloatApproval(null);
      return;
    }

    if (!trimmedReason) {
      setOpeningFloatCorrectionError("Add a reason for this correction");
      setOpeningFloatCorrectionInfo("");
      return;
    }

    const intent = {
      correctedOpeningFloat: parsedOpeningFloat,
      reason: trimmedReason,
      registerNumber: registerSession.registerNumber,
      registerSessionId: registerSession._id,
    };

    setOpeningFloatCorrectionError("");
    setOpeningFloatCorrectionInfo("");
    setOpeningFloatCorrectionSuccess("");
    setOpeningFloatCorrectionIntent(intent);
    await runOpeningFloatCorrection(intent);
  }

  async function handleAuthenticatedCloseoutStaff(
    result: CloseoutApprovalAuthenticationResult,
    credentials?: { pinHash: string; username: string },
  ) {
    if (!closeoutStaffAuthIntent) {
      return;
    }

    const intent = closeoutStaffAuthIntent;

    if (intent.kind === "sync_review") {
      if (!onResolveSyncReview) {
        setSyncReviewErrorMessage(
          "Sync review resolution is not available yet. Try again after the register tools refresh.",
        );
        setCloseoutStaffAuthIntent(null);
        return;
      }

      setSyncReviewErrorMessage("");
      setIsResolvingSyncReview(true);
      setCloseoutStaffAuthIntent(null);

      try {
        const commandResult = await onResolveSyncReview({
          actorStaffProfileId: result.staffProfileId,
          approvalProofId: result.approvalProofId,
          decision: intent.decision,
          registerSessionId: intent.registerSessionId,
          requestedByStaffProfileId: result.requestedByStaffProfileId,
          reviewConflictIds: intent.reviewConflictIds,
        });

        if (commandResult.kind !== "ok") {
          setSyncReviewErrorMessage(commandResult.error.message);
          return;
        }

        toast.success(
          commandResult.data?.action === "already_resolved"
            ? "Register review already resolved"
            : commandResult.data?.action === "rejected"
              ? "Synced register activity rejected"
              : commandResult.data?.projectedCount
                ? commandResult.data.projectedCount === 1
                  ? "Reviewed sale applied"
                  : `${commandResult.data.projectedCount} reviewed sales applied`
                : "Register review resolved",
        );
      } finally {
        setIsResolvingSyncReview(false);
      }
      return;
    }

    const action =
      intent.kind === "submit"
        ? "submit"
        : intent.kind === "finalize"
          ? "finalize"
          : intent.decision;

    setCloseoutErrorMessage("");
    setPendingCloseoutAction(action);
    setCloseoutStaffAuthIntent(null);

    try {
      const commandResult =
        intent.kind === "submit"
          ? await closeoutApprovalRunner.run({
              sameSubmissionApproval: credentials
                ? {
                    canAttemptInlineManagerProof: isManagerStaff(result),
                    pinHash: credentials.pinHash,
                    username: credentials.username,
                  }
                : undefined,
              execute: (approvalArgs) =>
                onSubmitCloseout({
                  actorStaffProfileId: result.staffProfileId,
                  approvalProofId:
                    approvalArgs.approvalProofId ?? result.approvalProofId,
                  countedCash: intent.countedCash,
                  notes: intent.notes,
                  registerSessionId: intent.registerSessionId,
                  staffPinHash: credentials?.pinHash,
                  staffUsername: credentials?.username,
                }),
              onResult: () => undefined,
            })
          : intent.kind === "finalize"
            ? onFinalizeCloseout
              ? await closeoutApprovalRunner.run({
                  sameSubmissionApproval: credentials
                    ? {
                        canAttemptInlineManagerProof: isManagerStaff(result),
                        pinHash: credentials.pinHash,
                        username: credentials.username,
                      }
                    : undefined,
                  execute: (approvalArgs) =>
                    onFinalizeCloseout({
                      actorStaffProfileId: result.staffProfileId,
                      approvalProofId:
                        approvalArgs.approvalProofId ?? result.approvalProofId,
                      registerSessionId: intent.registerSessionId,
                      staffPinHash: credentials?.pinHash,
                      staffUsername: credentials?.username,
                    }),
                  onResult: () => undefined,
                })
              : userError({
                  code: "precondition_failed",
                  message:
                    "Closeout finalization is not available yet. Try again after the register tools refresh.",
                })
            : result.approvalProofId
              ? await onReviewCloseout({
                  approvalProofId: result.approvalProofId,
                  decision: intent.decision,
                  decisionNotes: intent.decisionNotes,
                  registerSessionId: intent.registerSessionId,
                })
              : userError({
                  code: "authentication_failed",
                  message:
                    "Manager approval could not be verified. Confirm manager credentials again.",
                });

      if (!applyCloseoutCommandResult(commandResult)) {
        return;
      }

      if (intent.kind === "submit") {
        setCloseoutNotes("");
      } else {
        setManagerNotes("");
      }
    } finally {
      setPendingCloseoutAction(null);
    }
  }

  async function runOpeningFloatCorrection(
    intent: OpeningFloatCorrectionIntent,
    args?: { approvalProofId?: string },
  ) {
    if (!onCorrectOpeningFloat) {
      setOpeningFloatCorrectionError(
        "Opening float correction is not available yet. Try again after the register tools refresh.",
      );
      return;
    }

    setOpeningFloatCorrectionError("");
    setOpeningFloatCorrectionInfo("");
    setIsCorrectingOpeningFloat(true);

    try {
      const commandResult = await onCorrectOpeningFloat({
        approvalProofId: args?.approvalProofId,
        correctedOpeningFloat: intent.correctedOpeningFloat,
        reason: intent.reason,
        registerSessionId: intent.registerSessionId,
      });

      if (isApprovalRequiredResult(commandResult)) {
        setOpeningFloatCorrectionInfo("");
        setPendingOpeningFloatApproval({
          ...commandResult.approval,
          subject: {
            ...commandResult.approval.subject,
            label: formatRegisterOpeningFloatSubjectLabel(
              intent.registerNumber,
            ),
          },
        });
        return;
      }

      if (commandResult.kind !== "ok") {
        setOpeningFloatCorrectionError(commandResult.error.message);
        setOpeningFloatCorrectionInfo("");
        return;
      }

      setOpeningFloatCorrectionSuccess("Opening float corrected");
      setOpeningFloatCorrectionInfo("");
      setOpeningFloatCorrectionReason("");
      setIsOpeningFloatCorrectionOpen(false);
      setOpeningFloatCorrectionIntent(null);
      setPendingOpeningFloatApproval(null);
    } finally {
      setIsCorrectingOpeningFloat(false);
    }
  }

  function handleOpeningFloatApprovalApproved(
    result: CommandApprovalApprovedResult,
  ) {
    if (!openingFloatCorrectionIntent) {
      setOpeningFloatCorrectionError(
        "Opening float correction details were not available. Review the amount and submit again.",
      );
      setOpeningFloatCorrectionInfo("");
      setPendingOpeningFloatApproval(null);
      return;
    }

    setPendingOpeningFloatApproval(null);
    void runOpeningFloatCorrection(openingFloatCorrectionIntent, {
      approvalProofId: result.approvalProofId,
    });
  }

  async function handleReopenCloseoutApproved(
    result: CommandApprovalApprovedResult,
  ) {
    if (!registerSession?._id || !onReopenCloseout) {
      setCloseoutErrorMessage(
        "A register session is required before reopening a closeout",
      );
      setIsReopenApprovalOpen(false);
      return;
    }

    setCloseoutErrorMessage("");
    setPendingCloseoutAction("reopen");
    setIsReopenApprovalOpen(false);

    try {
      const commandResult = await onReopenCloseout({
        actorStaffProfileId: result.approvedByStaffProfileId,
        approvalProofId: result.approvalProofId,
        registerSessionId: registerSession._id,
      });

      applyCloseoutCommandResult(commandResult);
    } finally {
      setPendingCloseoutAction(null);
    }
  }

  async function handleReopenedCloseoutSubmitApproved(
    result: CommandApprovalApprovedResult,
  ) {
    if (!reopenedCloseoutSubmitIntent) {
      setCloseoutErrorMessage(
        "Closeout correction details were not available. Review the count and submit again.",
      );
      setIsReopenedCloseoutSubmitApprovalOpen(false);
      return;
    }

    if (
      reopenedCloseoutSubmitIntent.reopenedByStaffProfileId &&
      result.approvedByStaffProfileId !==
        reopenedCloseoutSubmitIntent.reopenedByStaffProfileId
    ) {
      setCloseoutErrorMessage(
        "The manager who reopened this closeout must submit the correction.",
      );
      setIsReopenedCloseoutSubmitApprovalOpen(false);
      return;
    }

    const intent = reopenedCloseoutSubmitIntent;

    setCloseoutErrorMessage("");
    setPendingCloseoutAction("submit");
    setReopenedCloseoutSubmitIntent(null);
    setIsReopenedCloseoutSubmitApprovalOpen(false);

    try {
      const commandResult = await onSubmitCloseout({
        actorStaffProfileId,
        closeoutModificationApprovalProofId: result.approvalProofId,
        countedCash: intent.countedCash,
        notes: intent.notes,
        registerSessionId: intent.registerSessionId,
      });

      if (!applyCloseoutCommandResult(commandResult)) {
        return;
      }

      setCloseoutNotes("");
    } finally {
      setPendingCloseoutAction(null);
    }
  }

  const transactions = registerSessionSnapshot?.transactions ?? [];
  const itemsBreakdown = registerSessionSnapshot?.itemsBreakdown ?? [];
  const totalItemsSold = itemsBreakdown.reduce(
    (total, item) => total + item.quantity,
    0,
  );
  const financialPosition = registerSessionSnapshot?.financialPosition;
  const previewTransactions = transactions.slice(
    0,
    LINKED_TRANSACTIONS_PREVIEW_LIMIT,
  );
  const hasAdditionalTransactions =
    transactions.length > previewTransactions.length;
  const transactionTotal = transactions.reduce(
    (sum, transaction) => sum + transaction.total,
    0,
  );
  const expectedCash =
    registerSession?.netExpectedCash ?? registerSession?.expectedCash ?? 0;
  const pendingCashVoidContext = getPendingCashVoidContext({
    expectedCash,
    pendingVoidApprovals: registerSession?.pendingVoidApprovals,
  });
  const pendingCashVoidText = pendingCashVoidContext
    ? formatPendingCashVoidNotice({
        context: pendingCashVoidContext,
        formatAmount: (amount) => formatCurrency(currency, amount),
      })
    : null;
  const pendingCashVoidApprovedExpectedCash =
    pendingCashVoidContext?.expectedCashAfterApproval;
  const reviewReasonFormatter = currencyFormatter(currency);
  const formattedCurrency = currencyDisplaySymbol(currency);
  const parsedCountedCash = parseDisplayAmountInput(countedCash);
  const draftVariance =
    registerSession && parsedCountedCash !== undefined
      ? parsedCountedCash - expectedCash
      : (registerSession?.variance ?? null);
  const hasPendingCloseoutApproval =
    registerSession?.pendingApprovalRequest?.status === "pending";
  const hasPendingCashCorrections = pendingCashVoidContext !== null;
  const formattedApprovalReason = formatReviewReason(
    reviewReasonFormatter,
    registerSession?.pendingApprovalRequest?.reason,
  );
  const closeoutRequestNotes =
    registerSession?.pendingApprovalRequest?.notes ?? registerSession?.notes;
  const formattedCloseoutReviewReason = formatReviewReason(
    reviewReasonFormatter,
    registerSessionSnapshot?.closeoutReview?.reason,
  );
  const correctionTimeline = (registerSessionSnapshot?.timeline ?? []).filter(
    isRegisterSessionCorrectionEvent,
  );
  const hasCloseoutRejectionHistory = correctionTimeline.some(
    isCloseoutRejectionEvent,
  );
  const isClosedRegisterSession = registerSession?.status === "closed";
  const hasRejectedCloseoutApproval =
    registerSession?.pendingApprovalRequest?.status === "rejected";
  const isRejectedRegisterSession =
    registerSession?.status === "closeout_rejected";
  const needsCloseoutCorrection =
    !isClosedRegisterSession &&
    (isRejectedRegisterSession ||
      hasRejectedCloseoutApproval ||
      hasCloseoutRejectionHistory);
  const canFinalizeCloseout =
    Boolean(registerSession) &&
    registerSession?.status === "closing" &&
    registerSession.countedCash !== undefined &&
    !hasPendingCloseoutApproval &&
    !hasPendingCashCorrections &&
    !needsCloseoutCorrection &&
    !isReopenedCloseoutCorrection &&
    Boolean(onFinalizeCloseout);
  const isWaitingOnVoidReview =
    Boolean(registerSession) &&
    registerSession?.status === "closing" &&
    hasPendingCashCorrections &&
    !needsCloseoutCorrection &&
    !isReopenedCloseoutCorrection;
  const syncStatus = buildPosSyncStatusPresentation({
    ...registerSession?.localSyncStatus,
    reconciliationItems:
      registerSession?.localSyncStatus?.reconciliationItems ??
      registerSession?.reconciliationItems ??
      [],
  });
  const visibleSyncReviewItems = syncStatus.reconciliationItems.filter(
    isVisibleRegisterSyncReviewItem,
  );
  const isRegisterCloseoutSyncReview =
    syncStatus.status === "needs_review" &&
    visibleSyncReviewItems.some(isRegisterCloseoutReviewItem);
  const pendingCloseoutReviewItem = isRegisterCloseoutSyncReview
    ? visibleSyncReviewItems.find(isRegisterCloseoutReviewItem)
    : undefined;
  const displayedExpectedCash =
    typeof pendingCloseoutReviewItem?.expectedCash === "number"
      ? pendingCloseoutReviewItem.expectedCash
      : expectedCash;
  const displayedCountedCash =
    typeof pendingCloseoutReviewItem?.countedCash === "number"
      ? pendingCloseoutReviewItem.countedCash
      : registerSession?.countedCash;
  const displayedVariance =
    typeof pendingCloseoutReviewItem?.variance === "number"
      ? pendingCloseoutReviewItem.variance
      : registerSession?.variance;
  const syncReviewActionCopy = getSyncReviewActionCopy({
    hasCloseoutReview: isRegisterCloseoutSyncReview,
    hasDuplicateRegisterOpenReview: visibleSyncReviewItems.some(
      isDuplicateLocalIdRegisterSyncReviewItem,
    ),
    hasOnlyRejectedReviewItems: hasOnlyRejectedSyncReviewItems(syncStatus),
    hasSaleReview:
      getSyncReviewSaleSummaries(visibleSyncReviewItems).length > 0,
  });
  const closeoutStaffAuthCopy =
    closeoutStaffAuthIntent?.kind === "review"
      ? {
          title: "Manager sign-in required",
          description:
            closeoutStaffAuthIntent.decision === "approved"
              ? "Authenticate to approve variance"
              : "Authenticate to reject variance",
          submitLabel:
            closeoutStaffAuthIntent.decision === "approved"
              ? "Approve variance"
              : "Reject variance",
        }
      : closeoutStaffAuthIntent?.kind === "sync_review"
        ? {
            title: "Manager sign-in required",
            description:
              closeoutStaffAuthIntent.decision === "approved"
                ? syncReviewActionCopy.approveAuthDescription
                : syncReviewActionCopy.rejectAuthDescription,
            submitLabel:
              closeoutStaffAuthIntent.decision === "approved"
                ? closeoutStaffAuthIntent.approveLabel
                : closeoutStaffAuthIntent.rejectLabel,
          }
        : closeoutStaffAuthIntent?.kind === "finalize"
          ? {
              title: "Closeout sign-in required",
              description: "Authenticate to finalize closeout",
              submitLabel: "Finalize closeout",
            }
          : {
              title: "Closeout sign-in required",
              description: "Authenticate to submit closeout",
              submitLabel: "Submit closeout",
            };
  const canResolveSyncReview =
    syncStatus.status === "needs_review" && Boolean(onResolveSyncReview);
  function requestResolveSyncReview(
    decision: "approved" | "rejected",
    options: ResolveSyncReviewDecisionOptions = {},
  ) {
    if (!registerSession || !canResolveSyncReview) {
      return;
    }

    const actionCopy = getSyncReviewActionCopy({
      hasCloseoutReview: isRegisterCloseoutSyncReview,
      hasDuplicateRegisterOpenReview: visibleSyncReviewItems.some(
        isDuplicateLocalIdRegisterSyncReviewItem,
      ),
      hasOnlyRejectedReviewItems: hasOnlyRejectedSyncReviewItems(syncStatus),
      hasSaleReview:
        getSyncReviewSaleSummaries(visibleSyncReviewItems).length > 0,
    });
    const saleReviewConflictIds = visibleSyncReviewItems
      .filter((item) => item.sale)
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));
    const visibleReviewConflictIds = visibleSyncReviewItems
      .map((item) => item.id)
      .filter((id): id is string => Boolean(id));

    setSyncReviewErrorMessage("");
    setCloseoutStaffAuthIntent({
      kind: "sync_review",
      decision,
      approveLabel: options.approveLabel ?? actionCopy.approveLabel,
      registerSessionId: registerSession._id,
      rejectLabel: options.rejectLabel ?? actionCopy.rejectLabel,
      reviewConflictIds:
        options.reviewConflictIds ??
        (isRegisterCloseoutSyncReview && pendingCloseoutReviewItem?.id
          ? [pendingCloseoutReviewItem.id]
          : saleReviewConflictIds.length > 0
            ? saleReviewConflictIds
            : visibleReviewConflictIds.length > 0
              ? visibleReviewConflictIds
              : undefined),
    });
  }
  const sessionCode = registerSession
    ? formatRegisterSessionCode(registerSession._id)
    : undefined;
  const openedByLine = registerSession?.openedByStaffName
    ? `By ${formatStaffDisplayName({ fullName: registerSession.openedByStaffName })}`
    : "Staff not recorded";
  const linkedSalesLabel =
    transactions.length === 1
      ? "1 linked sale"
      : `${transactions.length} linked sales`;
  const closeoutState = isRegisterCloseoutSyncReview
    ? "Closeout review pending"
    : registerSession?.status === "closed"
      ? "Closed"
      : registerSession?.status === "closeout_rejected"
        ? "Closeout rejected"
        : registerSession?.status === "closing"
          ? needsCloseoutCorrection
            ? "Closeout rejected"
            : hasPendingCloseoutApproval
              ? "Manager approval pending"
              : "Closeout in progress"
          : undefined;
  const shouldShowCloseoutSummary = Boolean(closeoutState);
  const closeoutTimestamp =
    registerSession?.status === "closed" && registerSession.closedAt
      ? formatTimestamp(registerSession.closedAt)
      : undefined;
  const closeoutActorLine = isRegisterCloseoutSyncReview
    ? "Synced closeout not applied yet; manager approval is required."
    : registerSession?.status === "closed"
      ? registerSession.closedByStaffName
        ? `By ${formatStaffDisplayName({ fullName: registerSession.closedByStaffName })}`
        : "Staff not recorded"
      : undefined;
  const canCorrectOpeningFloat =
    !isRegisterCloseoutSyncReview &&
    (registerSession?.status === "open" ||
      registerSession?.status === "active");
  const showOpeningFloatCorrectionUnavailable =
    registerSession &&
    !canCorrectOpeningFloat &&
    registerSession.status !== "closed";
  const openingFloatCorrectionUnavailableMessage = isRegisterCloseoutSyncReview
    ? "Opening float corrections are unavailable while synced closeout review is pending."
    : "Opening float corrections are unavailable after closeout starts.";
  const correctedOpeningFloatAmount = parseDisplayAmountInput(
    correctedOpeningFloat,
  );
  const openingFloatDelta =
    registerSession && correctedOpeningFloatAmount !== undefined
      ? correctedOpeningFloatAmount - registerSession.openingFloat
      : null;
  const hasOpeningFloatCorrectionHistory = correctionTimeline.some(
    isOpeningFloatCorrectionEvent,
  );
  const openingFloatCorrectionCardTitle =
    hasCloseoutRejectionHistory &&
    !isClosedRegisterSession &&
    !isOpeningFloatCorrectionOpen &&
    !openingFloatCorrectionSuccess &&
    !hasOpeningFloatCorrectionHistory
      ? "Closeout correction needed"
      : "Opening float correction";
  const openingFloatCorrectionCardDescription =
    hasCloseoutRejectionHistory &&
    !isClosedRegisterSession &&
    !isOpeningFloatCorrectionOpen &&
    !openingFloatCorrectionSuccess &&
    !hasOpeningFloatCorrectionHistory
      ? "Review the rejected closeout, then recount or correct the drawer"
      : "Correct the starting cash amount without changing linked sales";
  const correctionHistoryLabel = hasCloseoutRejectionHistory
    ? "Closeout history"
    : "Correction history";
  const closeoutFollowUpMessage = needsCloseoutCorrection
    ? "Manager rejected this closeout. Recount or correct the drawer before submitting again."
    : formattedApprovalReason;
  const registerStatusLabel = isRegisterCloseoutSyncReview
    ? "Closeout review pending"
    : registerSession
      ? formatStatusLabel(registerSession.status)
      : "";
  const shouldShowProminentCorrectionPanel =
    Boolean(registerSession) &&
    (isOpeningFloatCorrectionOpen ||
      Boolean(openingFloatCorrectionSuccess) ||
      (correctionTimeline.length > 0 && !isClosedRegisterSession));
  const pendingVoidApprovalPanel =
    registerSession && hasPendingCashCorrections ? (
      <section className="space-y-3 rounded-lg border border-warning-border/40 bg-warning-soft/40 p-layout-md">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-warning">
            Register corrections pending
          </p>
          <h2 className="font-display text-lg font-semibold text-foreground">
            Register corrections block final closeout
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            Resolve pending cash-impacting sale voids or item adjustments before
            final closeout can complete.
          </p>
          {canViewFinancialDetails && pendingCashVoidText ? (
            <p className="text-sm leading-6 text-muted-foreground">
              {pendingCashVoidText}
            </p>
          ) : null}
        </div>
        {orgUrlSlug && storeUrlSlug ? (
          <Button asChild size="sm" variant="outline">
            <Link
              params={{ orgUrlSlug, storeUrlSlug }}
              search={{ o: getOrigin() }}
              to="/$orgUrlSlug/store/$storeUrlSlug/operations/approvals"
            >
              Review approvals
            </Link>
          </Button>
        ) : null}
      </section>
    ) : null;
  const pendingCloseoutApprovalPanel =
    registerSession && hasPendingCloseoutApproval ? (
      <section className="space-y-4 rounded-[calc(var(--radius)*1.2)] border border-warning-border/40 bg-warning-soft/40 p-layout-lg shadow-surface">
        <div className="space-y-2">
          <div className="space-y-2">
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-warning">
              Manager approval required
            </p>
            <div className="space-y-1">
              <h2 className="font-display text-2xl font-semibold text-foreground">
                Review closeout variance
              </h2>
              <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
                {formattedApprovalReason ??
                  formattedCloseoutReviewReason ??
                  "Review the submitted count before closing this drawer"}
              </p>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-warning-border/40 bg-background/70 p-4">
          <div
            className={cn(
              "grid gap-4 text-sm",
              pendingCashVoidApprovedExpectedCash !== undefined
                ? "sm:grid-cols-4"
                : "sm:grid-cols-3",
            )}
          >
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                {pendingCashVoidText ? "Expected now" : "Expected"}
              </p>
              <p className="font-numeric tabular-nums text-base text-foreground">
                {formatCurrency(currency, expectedCash)}
              </p>
            </div>
            {pendingCashVoidApprovedExpectedCash !== undefined ? (
              <div className="space-y-1">
                <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                  After adjustments
                </p>
                <p className="font-numeric tabular-nums text-base text-foreground">
                  {formatCurrency(
                    currency,
                    pendingCashVoidApprovedExpectedCash,
                  )}
                </p>
              </div>
            ) : null}
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Counted
              </p>
              <p className="font-numeric tabular-nums text-base text-foreground">
                {formatCurrency(currency, registerSession.countedCash)}
              </p>
            </div>
            <div className="space-y-1">
              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                Variance
              </p>
              <p
                className={`font-numeric tabular-nums text-base ${getVarianceTone(registerSession.variance)}`}
              >
                {formatCurrency(currency, registerSession.variance ?? 0)}
              </p>
            </div>
          </div>
          {pendingCashVoidText ? (
            <p className="mt-4 border-t border-warning-border/40 pt-3 text-xs leading-5 text-muted-foreground">
              {pendingCashVoidText}
            </p>
          ) : null}
          <div className="mt-4 space-y-3 border-t border-warning-border/40 pt-3 text-xs text-muted-foreground">
            <p>
              Requested by{" "}
              {registerSession.pendingApprovalRequest?.requestedByStaffName
                ? formatStaffDisplayName({
                    fullName:
                      registerSession.pendingApprovalRequest
                        .requestedByStaffName,
                  })
                : "staff not recorded"}
            </p>
            {closeoutRequestNotes ? (
              <div className="space-y-1 rounded-md bg-warning-soft/40 px-3 py-2 text-muted-foreground">
                <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-warning">
                  Request notes
                </p>
                <p className="text-sm leading-5 text-foreground">
                  {closeoutRequestNotes}
                </p>
              </div>
            ) : null}
          </div>
        </div>

        <label className="block w-full max-w-[480px] space-y-2">
          <span className="text-sm font-medium text-foreground">
            Manager notes
          </span>
          <Textarea
            aria-label="Manager closeout notes"
            className="min-h-[112px] w-full border-input bg-background"
            onChange={(event) => setManagerNotes(event.target.value)}
            placeholder="Add approval or rejection notes."
            value={managerNotes}
          />
        </label>

        <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
          <LoadingButton
            className="w-full sm:w-auto"
            disabled={Boolean(pendingCloseoutAction)}
            isLoading={pendingCloseoutAction === "approved"}
            onClick={() => void handleReviewCloseout("approved")}
            type="button"
            variant="default"
          >
            Approve variance
          </LoadingButton>
          <LoadingButton
            className="w-full sm:w-auto"
            disabled={Boolean(pendingCloseoutAction)}
            isLoading={pendingCloseoutAction === "rejected"}
            onClick={() => void handleReviewCloseout("rejected")}
            type="button"
            variant="outline"
          >
            Reject variance
          </LoadingButton>
        </div>
      </section>
    ) : null;

  return (
    <View
      header={
        <ComposedPageHeader
          className="h-auto min-h-16 flex-col items-stretch gap-3 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:border-0 sm:py-4"
          onNavigateBack={onNavigateBack}
          leadingContent={
            <RegisterSessionHeaderIdentity
              registerSession={registerSession}
              statusLabel={registerStatusLabel}
              syncStatus={syncStatus}
            />
          }
          trailingContent={
            <div
              className="flex w-full shrink-0 flex-col items-stretch gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-start sm:justify-end"
              data-testid="register-session-header-actions"
            >
              {canViewFinancialDetails &&
              registerSession &&
              orgUrlSlug &&
              storeUrlSlug ? (
                <Button
                  asChild
                  className="h-8 border-border bg-surface px-2.5 text-xs text-muted-foreground hover:bg-muted sm:h-9 sm:px-3 sm:text-sm"
                  size="sm"
                  variant="outline"
                >
                  <Link
                    params={{
                      orgUrlSlug,
                      sessionId: registerSession._id,
                      storeUrlSlug,
                    }}
                    search={{ o: getOrigin() }}
                    to="/$orgUrlSlug/store/$storeUrlSlug/cash-controls/registers/$sessionId/activity"
                  >
                    POS activity
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </Button>
              ) : null}
              {canViewFinancialDetails && registerSession?.workflowTraceId ? (
                <Button
                  asChild
                  className="h-8 border-border bg-surface px-2.5 text-xs text-muted-foreground hover:bg-muted sm:h-9 sm:px-3 sm:text-sm"
                  size="sm"
                  variant="outline"
                >
                  <WorkflowTraceRouteLink
                    className="inline-flex items-center gap-1.5"
                    traceId={registerSession.workflowTraceId}
                  >
                    <span aria-hidden="true">History</span>
                    <span className="sr-only">View register history</span>
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </WorkflowTraceRouteLink>
                </Button>
              ) : null}
            </div>
          }
        />
      }
    >
      <StaffAuthenticationDialog
        copy={closeoutStaffAuthCopy}
        getSuccessMessage={(result) => {
          const staffDisplayName = formatStaffDisplayName(result.staffProfile);
          return staffDisplayName
            ? `Confirmed as ${staffDisplayName}`
            : "Staff credentials confirmed";
        }}
        onAuthenticate={(args) => {
          if (
            closeoutStaffAuthIntent?.kind === "sync_review" &&
            onAuthenticateForApproval &&
            storeId
          ) {
            return onAuthenticateForApproval({
              actionKey: REGISTER_SESSION_SYNC_REVIEW_APPROVAL_ACTION_KEY,
              pinHash: args.pinHash,
              requiredRole: "manager",
              requestedByStaffProfileId: actorStaffProfileId as
                Id<"staffProfile"> | undefined,
              storeId: storeId as Id<"store">,
              subject: {
                id: closeoutStaffAuthIntent.registerSessionId,
                label: registerSession?.registerNumber ?? undefined,
                type: "register_session",
              },
              username: args.username,
            }).then((result) => {
              if (result.kind !== "ok") {
                return result;
              }

              return {
                kind: "ok" as const,
                data: {
                  approvalProofId: result.data.approvalProofId,
                  requestedByStaffProfileId:
                    result.data.requestedByStaffProfileId,
                  staffProfile: {},
                  staffProfileId: result.data.approvedByStaffProfileId,
                },
              };
            });
          }

          if (
            closeoutStaffAuthIntent?.kind === "review" &&
            onAuthenticateCloseoutReviewApproval
          ) {
            return onAuthenticateCloseoutReviewApproval({
              pinHash: args.pinHash,
              reason: closeoutStaffAuthIntent.decisionNotes,
              registerSessionId: closeoutStaffAuthIntent.registerSessionId,
              username: args.username,
            });
          }

          return Promise.resolve(
            onAuthenticateStaff({
              allowedRoles:
                closeoutStaffAuthIntent?.kind === "review" ||
                closeoutStaffAuthIntent?.kind === "sync_review" ||
                closeoutStaffAuthIntent?.kind === "finalize"
                  ? ["manager"]
                  : ["cashier", "manager"],
              pinHash: args.pinHash,
              username: args.username,
            }),
          );
        }}
        onAuthenticated={(result, _mode, credentials) => {
          void handleAuthenticatedCloseoutStaff(result, credentials);
        }}
        onDismiss={() => setCloseoutStaffAuthIntent(null)}
        open={Boolean(closeoutStaffAuthIntent)}
      />
      {closeoutApprovalRunner.dialog}
      <CommandApprovalDialog
        approval={pendingOpeningFloatApproval}
        onAuthenticateForApproval={
          onAuthenticateForApproval ??
          (() =>
            Promise.resolve(
              userError({
                code: "unavailable",
                message:
                  "Manager approval is not available yet. Try again after the register tools refresh.",
              }),
            ))
        }
        onApproved={handleOpeningFloatApprovalApproved}
        onDismiss={() => {
          setPendingOpeningFloatApproval(null);
          setOpeningFloatCorrectionIntent(null);
        }}
        open={Boolean(pendingOpeningFloatApproval)}
        storeId={(storeId ?? "missing-store") as Id<"store">}
      />
      <CommandApprovalDialog
        approval={reopenCloseoutApproval}
        onAuthenticateForApproval={
          onAuthenticateForApproval ??
          (() =>
            Promise.resolve(
              userError({
                code: "unavailable",
                message:
                  "Manager approval is not available yet. Try again after the register tools refresh.",
              }),
            ))
        }
        onApproved={(result) => {
          void handleReopenCloseoutApproved(result);
        }}
        onDismiss={() => setIsReopenApprovalOpen(false)}
        open={isReopenApprovalOpen}
        storeId={(storeId ?? "missing-store") as Id<"store">}
      />
      <CommandApprovalDialog
        approval={reopenedCloseoutSubmitApproval}
        onAuthenticateForApproval={
          onAuthenticateForApproval ??
          (() =>
            Promise.resolve(
              userError({
                code: "unavailable",
                message:
                  "Manager approval is not available yet. Try again after the register tools refresh.",
              }),
            ))
        }
        onApproved={(result) => {
          void handleReopenedCloseoutSubmitApproved(result);
        }}
        onDismiss={() => {
          setIsReopenedCloseoutSubmitApprovalOpen(false);
          setReopenedCloseoutSubmitIntent(null);
        }}
        open={isReopenedCloseoutSubmitApprovalOpen}
        storeId={(storeId ?? "missing-store") as Id<"store">}
      />
      <FadeIn>
        <div className="container mx-auto space-y-layout-md p-layout-md md:space-y-6 md:p-6">
          {registerSession ? (
            <RegisterSessionSyncNotice
              currency={currency}
              errorMessage={syncReviewErrorMessage}
              isResolving={isResolvingSyncReview}
              onReviewDecision={
                canResolveSyncReview ? requestResolveSyncReview : undefined
              }
              orgUrlSlug={orgUrlSlug}
              storeUrlSlug={storeUrlSlug}
              syncStatus={syncStatus}
            />
          ) : null}
          <section className="overflow-hidden rounded-[calc(var(--radius)*1.35)] border border-border bg-surface shadow-surface">
            {isLoading ? null : !registerSession ? (
              <div className="px-layout-lg py-layout-xl">
                <EmptyState
                  description="Try re-opening the cash-controls workspace and selecting a register session again"
                  title="Register session not found"
                />
              </div>
            ) : (
              <div className="grid gap-0 xl:grid-cols-[380px_minmax(0,1fr)]">
                <aside className="border-b border-border/80 bg-muted/20 px-layout-md py-layout-md md:px-layout-lg md:py-layout-lg xl:border-b-0 xl:border-r">
                  <dl className="space-y-layout-md">
                    {financialPosition ? (
                      <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                          Sales summary
                        </dt>
                        <dd className="mt-layout-sm space-y-1 border-b border-border/70 pb-layout-sm">
                          <span className="block text-xs text-muted-foreground">
                            Total sales
                          </span>
                          <span className="block font-numeric text-2xl tabular-nums text-foreground sm:text-3xl">
                            <CashControlsFinancialValue
                              amount={financialPosition.totalSales}
                              canView={canViewFinancialDetails}
                              currency={currency}
                              label="Total register sales"
                            />
                          </span>
                        </dd>

                        <div className="mt-layout-lg grid grid-cols-2 gap-layout-md">
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">
                              Completed sales
                            </p>
                            <p className="mt-1 font-numeric text-lg tabular-nums text-foreground">
                              {financialPosition.transactionCount === 0
                                ? "-"
                                : financialPosition.transactionCount.toLocaleString()}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80">
                              Average sale
                            </p>
                            <p className="mt-1 font-numeric text-lg tabular-nums text-foreground">
                              {financialPosition.transactionCount === 0 ? (
                                "-"
                              ) : (
                                <CashControlsFinancialValue
                                  amount={financialPosition.averageTransaction}
                                  canView={canViewFinancialDetails}
                                  currency={currency}
                                  label="Average register sale"
                                />
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="mt-layout-lg border-t border-border/70 pt-layout-md">
                          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                            Payment mix
                          </p>
                          <div className="mt-layout-md space-y-layout-md">
                            {financialPosition.paymentMix.length === 0 ? (
                              <p className="text-sm text-muted-foreground">
                                No completed payments
                              </p>
                            ) : null}
                            {financialPosition.paymentMix.map((payment) => {
                              const PaymentIcon = getPaymentMethodIcon({
                                hasMultiplePaymentMethods: false,
                                paymentMethod: payment.method,
                              });

                              return (
                                <div key={payment.method}>
                                  <div className="flex items-center justify-between gap-layout-md text-sm">
                                    <span className="flex min-w-0 items-center gap-2 text-foreground">
                                      <PaymentIcon
                                        aria-hidden="true"
                                        className="h-3.5 w-3.5 shrink-0 self-center text-muted-foreground"
                                      />
                                      <span className="flex min-w-0 items-baseline gap-2">
                                        <span className="truncate">
                                          {formatPaymentMethod(payment.method)}
                                        </span>
                                        <span className="text-xs tabular-nums text-muted-foreground">
                                          {payment.transactionCount.toLocaleString()}{" "}
                                          {payment.transactionCount === 1
                                            ? "sale"
                                            : "sales"}
                                        </span>
                                      </span>
                                    </span>
                                    <span className="font-numeric shrink-0 tabular-nums text-foreground">
                                      <CashControlsFinancialValue
                                        amount={payment.total}
                                        canView={canViewFinancialDetails}
                                        currency={currency}
                                        label={`${formatPaymentMethod(payment.method)} total`}
                                      />
                                    </span>
                                  </div>
                                  {canViewFinancialDetails ? (
                                    <div
                                      aria-label={`${formatPaymentMethod(payment.method)}: ${payment.share}% of session sales`}
                                      className="mt-2 h-1 overflow-hidden rounded-full bg-primary-soft"
                                      role="img"
                                    >
                                      <div
                                        className="h-full rounded-full bg-primary"
                                        style={{ width: `${payment.share}%` }}
                                      />
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Cash position
                      </dt>
                      <dd className="mt-layout-sm space-y-2 pb-1">
                        <span className="block text-xs text-muted-foreground">
                          {pendingCashVoidText
                            ? "Expected now"
                            : "Expected cash"}
                        </span>
                        <span className="block font-numeric text-2xl tabular-nums text-foreground sm:text-3xl">
                          <CashControlsFinancialValue
                            amount={displayedExpectedCash}
                            canView={canViewFinancialDetails}
                            currency={currency}
                            label="Expected cash"
                          />
                        </span>
                      </dd>
                      <details className="group mt-layout-sm border-t border-border/70 pt-layout-xs">
                        <summary className="flex cursor-pointer list-none items-center justify-between gap-layout-md rounded-md px-1 py-2 text-xs font-medium text-muted-foreground transition-[color,transform] duration-fast ease-standard hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                          <span>Cash details</span>
                          <ChevronDown
                            aria-hidden="true"
                            className="h-4 w-4 transition-transform duration-fast ease-standard group-open:rotate-180 motion-reduce:transition-none"
                          />
                        </summary>
                        <div className="mt-layout-xs divide-y divide-border/70 rounded-md border border-border/70 bg-muted/10">
                          <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                            <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Opening float
                            </dt>
                            <dd className="font-numeric tabular-nums text-sm text-foreground">
                              {formatCurrency(
                                currency,
                                registerSession.openingFloat,
                              )}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                            <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Counted
                            </dt>
                            <dd className="font-numeric tabular-nums text-sm text-foreground">
                              {formatCurrency(currency, displayedCountedCash)}
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                            <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Deposited
                            </dt>
                            <dd className="font-numeric tabular-nums text-sm text-foreground">
                              <CashControlsFinancialValue
                                amount={registerSession.totalDeposited}
                                canView={canViewFinancialDetails}
                                currency={currency}
                                label="Deposited cash"
                              />
                            </dd>
                          </div>
                          <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                            <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                              Variance
                            </dt>
                            <dd
                              className={`font-numeric tabular-nums text-sm ${getVarianceTone(displayedVariance)}`}
                            >
                              <CashControlsFinancialValue
                                amount={displayedVariance ?? 0}
                                canView={canViewFinancialDetails}
                                currency={currency}
                                label="Variance"
                              />
                            </dd>
                          </div>
                          {pendingCashVoidApprovedExpectedCash !== undefined ? (
                            <div className="flex items-center justify-between gap-layout-md px-3 py-2.5">
                              <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                                After adjustments
                              </dt>
                              <dd className="font-numeric tabular-nums text-sm text-foreground">
                                <CashControlsFinancialValue
                                  amount={pendingCashVoidApprovedExpectedCash}
                                  canView={canViewFinancialDetails}
                                  currency={currency}
                                  label="Expected cash after adjustments"
                                />
                              </dd>
                            </div>
                          ) : null}
                        </div>
                      </details>
                      {canViewFinancialDetails && pendingCashVoidText ? (
                        <p className="mt-layout-md border-t border-border/70 pt-layout-md text-xs leading-5 text-muted-foreground">
                          {pendingCashVoidText}
                        </p>
                      ) : null}
                      {canViewFinancialDetails &&
                      (canCorrectOpeningFloat ||
                        showOpeningFloatCorrectionUnavailable) ? (
                        <div className="mt-layout-md border-t border-border/70 pt-layout-md">
                          {canCorrectOpeningFloat ? (
                            <Button
                              className="w-full"
                              disabled={isOpeningFloatCorrectionOpen}
                              onClick={() => {
                                setIsOpeningFloatCorrectionOpen(
                                  (value) => !value,
                                );
                                setOpeningFloatCorrectionError("");
                                setOpeningFloatCorrectionSuccess("");
                              }}
                              size="sm"
                              type="button"
                              variant="outline"
                            >
                              Correct opening float
                            </Button>
                          ) : (
                            <p className="text-xs leading-relaxed text-muted-foreground">
                              {openingFloatCorrectionUnavailableMessage}
                            </p>
                          )}
                        </div>
                      ) : null}
                    </div>

                    {!hasPendingCloseoutApproval ? (
                      <div className="space-y-4 rounded-lg border border-border bg-surface-raised p-layout-md">
                        <div className="space-y-2">
                          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                            Closeout workflow
                          </p>
                          <h2 className="font-display text-xl font-semibold text-foreground">
                            {isRegisterCloseoutSyncReview
                              ? "Closeout review pending"
                              : registerSession?.status === "closed"
                                ? "Drawer closed"
                                : "Count and close drawer"}
                          </h2>
                          <p className="text-sm text-muted-foreground">
                            {isRegisterCloseoutSyncReview
                              ? "Synced count is waiting for review."
                              : registerSession?.status === "closed"
                                ? "The final count is saved and this drawer is no longer accepting sales."
                                : "Submit the cash count, then resolve any variance approval before closing."}
                          </p>
                        </div>

                        {isRegisterCloseoutSyncReview ? (
                          <div className="rounded-lg border border-border bg-muted/20 p-4">
                            <dl className="grid gap-3 text-sm sm:grid-cols-3">
                              <div className="space-y-1">
                                <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                  Expected
                                </dt>
                                <dd className="font-numeric tabular-nums text-foreground">
                                  {formatCurrency(
                                    currency,
                                    displayedExpectedCash,
                                  )}
                                </dd>
                              </div>
                              <div className="space-y-1">
                                <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                  Counted
                                </dt>
                                <dd className="font-numeric tabular-nums text-foreground">
                                  {formatCurrency(
                                    currency,
                                    displayedCountedCash,
                                  )}
                                </dd>
                              </div>
                              <div className="space-y-1">
                                <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                  Variance
                                </dt>
                                <dd
                                  className={`font-numeric tabular-nums ${getVarianceTone(displayedVariance ?? undefined)}`}
                                >
                                  {formatCurrency(
                                    currency,
                                    displayedVariance ?? 0,
                                  )}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        ) : registerSession?.status === "closed" ||
                          registerSession?.status === "closeout_rejected" ? (
                          <div className="space-y-4 border-t border-border/70 pt-4">
                            {registerSession.status === "closeout_rejected" ? (
                              <p className="text-sm font-medium text-foreground">
                                Closeout rejected
                              </p>
                            ) : null}
                            {canViewFinancialDetails ? (
                              <dl
                                className={cn(
                                  "grid gap-3 text-sm",
                                  pendingCashVoidApprovedExpectedCash !==
                                    undefined
                                    ? "sm:grid-cols-4"
                                    : "sm:grid-cols-3",
                                )}
                              >
                                <div className="space-y-1">
                                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                    {pendingCashVoidText
                                      ? "Expected now"
                                      : "Expected"}
                                  </dt>
                                  <dd className="font-numeric tabular-nums text-foreground">
                                    {formatCurrency(currency, expectedCash)}
                                  </dd>
                                </div>
                                {pendingCashVoidApprovedExpectedCash !==
                                undefined ? (
                                  <div className="space-y-1">
                                    <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                      After adjustments
                                    </dt>
                                    <dd className="font-numeric tabular-nums text-foreground">
                                      {formatCurrency(
                                        currency,
                                        pendingCashVoidApprovedExpectedCash,
                                      )}
                                    </dd>
                                  </div>
                                ) : null}
                                <div className="space-y-1">
                                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                    Counted
                                  </dt>
                                  <dd className="font-numeric tabular-nums text-foreground">
                                    {formatCurrency(
                                      currency,
                                      registerSession.countedCash,
                                    )}
                                  </dd>
                                </div>
                                <div className="space-y-1">
                                  <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                    Variance
                                  </dt>
                                  <dd
                                    className={`font-numeric tabular-nums ${getVarianceTone(registerSession.variance)}`}
                                  >
                                    {formatCurrency(
                                      currency,
                                      registerSession.variance ?? 0,
                                    )}
                                  </dd>
                                </div>
                              </dl>
                            ) : null}
                            {canViewFinancialDetails && pendingCashVoidText ? (
                              <p className="border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
                                {pendingCashVoidText}
                              </p>
                            ) : null}
                            <div className="space-y-2 border-t border-border/70 pt-3">
                              <p className="text-xs leading-5 text-muted-foreground">
                                {registerSession.status === "closeout_rejected"
                                  ? "Manager approval is required to reopen this rejected closeout before a corrected count can be submitted."
                                  : "Reopen the closeout to submit a corrected count. The saved closeout stays in the drawer history."}
                              </p>
                              <LoadingButton
                                className="-ml-3 w-fit justify-start text-muted-foreground hover:text-foreground"
                                disabled={pendingCloseoutAction === "reopen"}
                                isLoading={pendingCloseoutAction === "reopen"}
                                onClick={() =>
                                  void handleReopenClosedCloseout()
                                }
                                size="sm"
                                type="button"
                                variant="ghost"
                              >
                                <RotateCcw className="h-3.5 w-3.5" />
                                Reopen closeout
                              </LoadingButton>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {registerSessionSnapshot?.closeoutReview ? (
                              <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-4">
                                <p className="text-sm font-medium text-foreground">
                                  {isReopenedCloseoutCorrection
                                    ? "Previous submitted closeout"
                                    : "Submitted closeout"}
                                </p>
                                <dl className="flex flex-wrap gap-x-4 gap-y-3 text-sm">
                                  <div className="min-w-[6rem] flex-1 space-y-1">
                                    <dt className="text-[11px] uppercase leading-4 tracking-[0.14em] text-muted-foreground">
                                      {pendingCashVoidText
                                        ? "Expected now"
                                        : "Expected"}
                                    </dt>
                                    <dd className="font-numeric tabular-nums text-foreground">
                                      {formatCurrency(currency, expectedCash)}
                                    </dd>
                                  </div>
                                  {pendingCashVoidApprovedExpectedCash !==
                                  undefined ? (
                                    <div className="min-w-[8.5rem] flex-1 space-y-1">
                                      <dt className="text-[11px] uppercase leading-4 tracking-[0.14em] text-muted-foreground">
                                        After adjustments
                                      </dt>
                                      <dd className="font-numeric tabular-nums text-foreground">
                                        {formatCurrency(
                                          currency,
                                          pendingCashVoidApprovedExpectedCash,
                                        )}
                                      </dd>
                                    </div>
                                  ) : null}
                                  <div className="min-w-[5.5rem] flex-1 space-y-1">
                                    <dt className="text-[11px] uppercase leading-4 tracking-[0.14em] text-muted-foreground">
                                      Counted
                                    </dt>
                                    <dd className="font-numeric tabular-nums text-foreground">
                                      {formatCurrency(
                                        currency,
                                        registerSessionSnapshot.registerSession
                                          .countedCash,
                                      )}
                                    </dd>
                                  </div>
                                  <div className="min-w-[5.5rem] flex-1 space-y-1">
                                    <dt className="text-[11px] uppercase leading-4 tracking-[0.14em] text-muted-foreground">
                                      Variance
                                    </dt>
                                    <dd
                                      className={`font-numeric tabular-nums ${getVarianceTone(registerSessionSnapshot.closeoutReview.variance)}`}
                                    >
                                      {formatCurrency(
                                        currency,
                                        registerSessionSnapshot.closeoutReview
                                          .variance,
                                      )}
                                    </dd>
                                  </div>
                                </dl>
                                {pendingCashVoidText ? (
                                  <p className="border-t border-border/70 pt-3 text-xs leading-5 text-muted-foreground">
                                    {pendingCashVoidText}
                                  </p>
                                ) : null}
                                <p className="text-sm text-muted-foreground">
                                  Approval required:{" "}
                                  {registerSessionSnapshot.closeoutReview
                                    .requiresApproval
                                    ? "Yes"
                                    : "No"}
                                </p>
                                {formattedCloseoutReviewReason ? (
                                  <p className="max-w-full overflow-hidden break-words text-sm leading-relaxed text-foreground">
                                    {formattedCloseoutReviewReason}
                                  </p>
                                ) : null}
                              </div>
                            ) : null}

                            {canFinalizeCloseout ? (
                              <div className="space-y-3 rounded-lg border border-border bg-background p-4">
                                <div className="space-y-1">
                                  <p className="text-sm font-medium text-foreground">
                                    Ready for final closeout
                                  </p>
                                  <p className="text-sm leading-6 text-muted-foreground">
                                    Pending register corrections are resolved.
                                    Finalize this submitted closeout against the
                                    current expected cash.
                                  </p>
                                </div>
                                <LoadingButton
                                  className="w-full"
                                  disabled={Boolean(pendingCloseoutAction)}
                                  isLoading={
                                    pendingCloseoutAction === "finalize"
                                  }
                                  onClick={() => void handleFinalizeCloseout()}
                                  type="button"
                                  variant="default"
                                >
                                  Finalize closeout
                                </LoadingButton>
                              </div>
                            ) : null}

                            {!canFinalizeCloseout && !isWaitingOnVoidReview ? (
                              <details
                                className="group border-t border-border/70 pt-layout-xs"
                                open={isReopenedCloseoutCorrection}
                              >
                                <summary className="flex cursor-pointer list-none items-center justify-between gap-layout-md rounded-md px-1 py-2 text-xs font-medium text-muted-foreground transition-[color,transform] duration-fast ease-standard hover:text-foreground active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 [&::-webkit-details-marker]:hidden">
                                  <span>Closeout details</span>
                                  <ChevronDown
                                    aria-hidden="true"
                                    className="h-4 w-4 transition-transform duration-fast ease-standard group-open:rotate-180 motion-reduce:transition-none"
                                  />
                                </summary>
                                <div className="space-y-4 pt-layout-xs">
                                  <label className="block space-y-2">
                                    <span className="text-sm font-medium text-foreground">
                                      Counted cash ({formattedCurrency})
                                    </span>
                                    <Input
                                      aria-label="Closeout counted cash"
                                      className="border-input bg-background"
                                      inputMode="decimal"
                                      onChange={(event) =>
                                        setCountedCash(event.target.value)
                                      }
                                      pattern="[0-9]*[.]?[0-9]*"
                                      type="text"
                                      value={countedCash}
                                    />
                                  </label>

                                  {canViewFinancialDetails ? (
                                    <div className="rounded-lg border border-border bg-muted/20 p-4">
                                      <dl
                                        className={cn(
                                          "grid gap-3 text-sm",
                                          pendingCashVoidApprovedExpectedCash !==
                                            undefined
                                            ? "grid-cols-3"
                                            : "grid-cols-2",
                                        )}
                                      >
                                        <div className="space-y-1">
                                          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                            {pendingCashVoidText
                                              ? "Expected now"
                                              : "Expected"}
                                          </dt>
                                          <dd className="font-numeric tabular-nums text-foreground">
                                            {formatCurrency(
                                              currency,
                                              expectedCash,
                                            )}
                                          </dd>
                                        </div>
                                        {pendingCashVoidApprovedExpectedCash !==
                                        undefined ? (
                                          <div className="space-y-1">
                                            <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                              After adjustments
                                            </dt>
                                            <dd className="font-numeric tabular-nums text-foreground">
                                              {formatCurrency(
                                                currency,
                                                pendingCashVoidApprovedExpectedCash,
                                              )}
                                            </dd>
                                          </div>
                                        ) : null}
                                        <div className="space-y-1">
                                          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                            Draft variance
                                          </dt>
                                          <dd
                                            className={`font-numeric tabular-nums ${getVarianceTone(draftVariance ?? undefined)}`}
                                          >
                                            {draftVariance === null
                                              ? "Pending count"
                                              : formatCurrency(
                                                  currency,
                                                  draftVariance,
                                                )}
                                          </dd>
                                        </div>
                                      </dl>
                                      {pendingCashVoidText ? (
                                        <p className="mt-4 border-t border-border pt-3 text-xs leading-5 text-muted-foreground">
                                          {pendingCashVoidText}
                                        </p>
                                      ) : null}
                                    </div>
                                  ) : null}

                                  <label className="block space-y-2">
                                    <span className="text-sm font-medium text-foreground">
                                      Closeout notes
                                    </span>
                                    <Textarea
                                      aria-label="Closeout notes"
                                      className="min-h-[96px] border-input bg-background"
                                      onChange={(event) =>
                                        setCloseoutNotes(event.target.value)
                                      }
                                      placeholder="Add drawer notes if anything needs follow-up."
                                      value={closeoutNotes}
                                    />
                                  </label>

                                  <LoadingButton
                                    className="w-full"
                                    disabled={Boolean(pendingCloseoutAction)}
                                    isLoading={
                                      pendingCloseoutAction === "submit"
                                    }
                                    onClick={() => void handleSubmitCloseout()}
                                    type="button"
                                    variant="default"
                                  >
                                    Submit closeout
                                  </LoadingButton>
                                </div>
                              </details>
                            ) : null}
                          </div>
                        )}

                        {closeoutErrorMessage ? (
                          <p className="text-sm text-destructive" role="alert">
                            {closeoutErrorMessage}
                          </p>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="rounded-lg border border-border bg-surface-raised p-layout-md">
                      <dt className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
                        Session
                      </dt>
                      <dd className="mt-3 flex items-center justify-between gap-3 rounded-md border border-border/70 bg-muted/20 px-3 py-2">
                        <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                          Code
                        </span>
                        <span className="font-numeric tabular-nums text-sm text-foreground">
                          {sessionCode}
                        </span>
                      </dd>
                    </div>

                    <div className="divide-y divide-border rounded-lg border border-border bg-surface-raised">
                      <div className="grid gap-1 px-layout-md py-3">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Opened
                        </dt>
                        <dd className="text-sm font-medium text-foreground">
                          {formatTimestamp(registerSession.openedAt)}
                        </dd>
                        <dd className="text-xs text-muted-foreground">
                          {openedByLine}
                        </dd>
                      </div>
                      <div className="grid gap-1 px-layout-md py-3">
                        <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                          Activity
                        </dt>
                        <dd className="text-sm font-medium text-foreground">
                          {linkedSalesLabel}
                        </dd>
                        <dd className="text-xs text-muted-foreground">
                          {formatCurrency(currency, transactionTotal)} in linked
                          sales
                        </dd>
                      </div>
                      {shouldShowCloseoutSummary ? (
                        <div className="grid gap-1 px-layout-md py-3">
                          <dt className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                            {registerSession.status === "closed"
                              ? "Closed"
                              : "Closeout"}
                          </dt>
                          <dd className="text-sm font-medium text-foreground">
                            {closeoutTimestamp ?? closeoutState}
                          </dd>
                          {closeoutActorLine ? (
                            <dd className="text-xs text-muted-foreground">
                              {closeoutActorLine}
                            </dd>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  </dl>

                  {canViewFinancialDetails && closeoutFollowUpMessage ? (
                    <div className="mt-layout-lg border-t border-border/70 pt-layout-lg">
                      <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted-foreground">
                        Manager follow-up
                      </p>
                      <p className="mt-2 text-sm text-foreground">
                        {closeoutFollowUpMessage}
                      </p>
                    </div>
                  ) : null}
                </aside>

                <div className="flex flex-col gap-layout-md px-layout-md py-layout-md md:gap-layout-lg md:px-layout-lg md:py-layout-lg">
                  {pendingVoidApprovalPanel}
                  {canViewFinancialDetails
                    ? pendingCloseoutApprovalPanel
                    : null}

                  {shouldShowProminentCorrectionPanel ? (
                    <section
                      className={
                        isOpeningFloatCorrectionOpen ||
                        openingFloatCorrectionSuccess
                          ? "order-1 space-y-4 rounded-lg border border-border bg-surface-raised p-layout-md"
                          : "order-1 space-y-3 rounded-lg border border-border bg-muted/20 px-layout-md py-3"
                      }
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="space-y-1">
                          <h2
                            className={
                              isOpeningFloatCorrectionOpen ||
                              openingFloatCorrectionSuccess
                                ? "font-display text-xl font-semibold text-foreground"
                                : "font-display text-base font-semibold text-foreground"
                            }
                          >
                            {openingFloatCorrectionCardTitle}
                          </h2>
                          <p
                            className={
                              isOpeningFloatCorrectionOpen ||
                              openingFloatCorrectionSuccess
                                ? "text-sm text-muted-foreground"
                                : "text-xs text-muted-foreground"
                            }
                          >
                            {openingFloatCorrectionCardDescription}
                          </p>
                        </div>
                      </div>

                      {isOpeningFloatCorrectionOpen ? (
                        <div className="space-y-4">
                          <div className="grid gap-3 text-sm sm:grid-cols-3">
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Current
                              </p>
                              <p className="font-numeric tabular-nums text-foreground">
                                {formatCurrency(
                                  currency,
                                  registerSession.openingFloat,
                                )}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Corrected
                              </p>
                              <p className="font-numeric tabular-nums text-foreground">
                                {correctedOpeningFloatAmount === undefined
                                  ? "Pending"
                                  : formatCurrency(
                                      currency,
                                      correctedOpeningFloatAmount,
                                    )}
                              </p>
                            </div>
                            <div className="space-y-1">
                              <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Drawer impact
                              </p>
                              <p className="font-numeric tabular-nums text-foreground">
                                {openingFloatDelta === null
                                  ? "Pending"
                                  : formatCurrency(currency, openingFloatDelta)}
                              </p>
                            </div>
                          </div>

                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-foreground">
                              Corrected amount ({formattedCurrency})
                            </span>
                            <Input
                              aria-label="Corrected opening float"
                              className="border-input bg-background"
                              inputMode="decimal"
                              onChange={(event) => {
                                setCorrectedOpeningFloat(event.target.value);
                                setOpeningFloatCorrectionInfo("");
                              }}
                              pattern="[0-9]*[.]?[0-9]*"
                              type="text"
                              value={correctedOpeningFloat}
                            />
                          </label>

                          <label className="block space-y-2">
                            <span className="text-sm font-medium text-foreground">
                              Reason
                            </span>
                            <Textarea
                              aria-label="Opening float correction reason"
                              className="min-h-[88px] border-input bg-background"
                              onChange={(event) =>
                                setOpeningFloatCorrectionReason(
                                  event.target.value,
                                )
                              }
                              placeholder="Record why the starting cash amount changed."
                              value={openingFloatCorrectionReason}
                            />
                          </label>

                          {openingFloatCorrectionError ? (
                            <p
                              className="text-sm text-destructive"
                              role="alert"
                            >
                              {openingFloatCorrectionError}
                            </p>
                          ) : null}

                          {openingFloatCorrectionInfo ? (
                            <p
                              className="text-sm text-muted-foreground"
                              role="status"
                            >
                              {openingFloatCorrectionInfo}
                            </p>
                          ) : null}

                          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
                            <LoadingButton
                              className="w-full sm:w-auto"
                              disabled={isCorrectingOpeningFloat}
                              isLoading={isCorrectingOpeningFloat}
                              onClick={() =>
                                void handleSubmitOpeningFloatCorrection()
                              }
                              type="button"
                              variant="default"
                            >
                              Submit
                            </LoadingButton>
                            <Button
                              className="w-full sm:w-auto"
                              disabled={isCorrectingOpeningFloat}
                              onClick={() => {
                                setIsOpeningFloatCorrectionOpen(false);
                                setOpeningFloatCorrectionError("");
                                setOpeningFloatCorrectionInfo("");
                              }}
                              type="button"
                              variant="outline"
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      {openingFloatCorrectionSuccess ? (
                        <p
                          className="text-sm text-[hsl(var(--success))]"
                          role="status"
                        >
                          {openingFloatCorrectionSuccess}
                        </p>
                      ) : null}

                      {correctionTimeline.length > 0 ? (
                        <details className="group border-t border-border/70 pt-3">
                          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-md py-1 text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                            <span>{correctionHistoryLabel}</span>
                            <span className="inline-flex items-center gap-2">
                              {correctionTimeline.length}{" "}
                              {correctionTimeline.length === 1
                                ? "entry"
                                : "entries"}
                              <ChevronDown className="h-4 w-4 transition-transform group-open:rotate-180" />
                            </span>
                          </summary>
                          <div className="space-y-3 pt-3">
                            {correctionTimeline.map((event) => {
                              const previousOpeningFloat =
                                getNumericEventMetadata(
                                  event,
                                  "previousOpeningFloat",
                                );
                              const correctedOpeningFloat =
                                getNumericEventMetadata(
                                  event,
                                  "correctedOpeningFloat",
                                );
                              const openingFloatDelta =
                                previousOpeningFloat !== null &&
                                correctedOpeningFloat !== null
                                  ? correctedOpeningFloat - previousOpeningFloat
                                  : null;

                              return (
                                <div
                                  className="space-y-3 rounded-md border border-border/70 bg-muted/20 p-4"
                                  key={event._id}
                                >
                                  <div className="space-y-1.5">
                                    <p className="text-sm font-medium leading-6 text-foreground">
                                      {event.message ??
                                        formatStatusLabel(event.eventType)}
                                    </p>
                                    <p className="text-xs leading-5 text-muted-foreground">
                                      {formatTimestamp(event.createdAt)}
                                      {event.actorStaffName
                                        ? ` by ${formatStaffDisplayName({ fullName: event.actorStaffName })}`
                                        : ""}
                                    </p>
                                  </div>
                                  {previousOpeningFloat !== null &&
                                  correctedOpeningFloat !== null ? (
                                    <dl className="grid gap-3 border-t border-border/70 pt-3 text-sm sm:grid-cols-3">
                                      <div className="space-y-1">
                                        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Original float
                                        </dt>
                                        <dd className="font-numeric tabular-nums text-foreground">
                                          {formatCurrency(
                                            currency,
                                            previousOpeningFloat,
                                          )}
                                        </dd>
                                      </div>
                                      <div className="space-y-1">
                                        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Corrected float
                                        </dt>
                                        <dd className="font-numeric tabular-nums text-foreground">
                                          {formatCurrency(
                                            currency,
                                            correctedOpeningFloat,
                                          )}
                                        </dd>
                                      </div>
                                      <div className="space-y-1">
                                        <dt className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                          Drawer impact
                                        </dt>
                                        <dd className="font-numeric tabular-nums text-foreground">
                                          {openingFloatDelta === null
                                            ? "Not recorded"
                                            : formatCurrency(
                                                currency,
                                                openingFloatDelta,
                                              )}
                                        </dd>
                                      </div>
                                    </dl>
                                  ) : null}
                                  {event.reason ? (
                                    <div className="space-y-1 border-t border-border/70 pt-3">
                                      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
                                        Notes
                                      </p>
                                      <p className="text-sm leading-6 text-muted-foreground">
                                        {event.reason}
                                      </p>
                                    </div>
                                  ) : null}
                                </div>
                              );
                            })}
                          </div>
                        </details>
                      ) : null}
                    </section>
                  ) : null}

                  <div
                    className={`order-2 flex flex-col items-start gap-layout-sm sm:flex-row sm:justify-between ${hasPendingCloseoutApproval ? "pt-4" : ""}`}
                  >
                    <div className="space-y-1">
                      <h2 className="font-display text-2xl font-semibold text-foreground">
                        Linked transactions
                      </h2>
                      <p className="text-sm text-muted-foreground">
                        Completed sales recorded against this register session.
                      </p>
                    </div>
                    <div className="flex items-center gap-layout-xs">
                      {transactions.length > 0 ? (
                        <Button
                          onClick={() => setIsItemsBreakdownOpen(true)}
                          size="sm"
                          type="button"
                          variant="ghost"
                        >
                          Items breakdown • {transactions.length}{" "}
                          {transactions.length === 1 ? "sale" : "sales"}
                        </Button>
                      ) : null}
                    </div>
                  </div>

                  <Sheet
                    open={isItemsBreakdownOpen}
                    onOpenChange={setIsItemsBreakdownOpen}
                  >
                    <SheetContent
                      className="flex w-[min(100vw,36rem)] max-w-[calc(100vw-1rem)] flex-col overflow-hidden border-border bg-app-canvas p-0 shadow-overlay sm:max-w-xl"
                      side="right"
                    >
                      <SheetHeader className="border-b border-border px-layout-lg py-layout-md">
                        <SheetTitle>Items breakdown</SheetTitle>
                      </SheetHeader>
                      <div className="min-h-0 flex-1 overflow-y-auto p-layout-lg">
                        <ItemsBreakdown
                          canViewFinancialDetails={canViewFinancialDetails}
                          currencyFormatter={reviewReasonFormatter}
                          description="Highest-volume items sold in this register session."
                          emptyStateDescription="Completed sales will populate the item breakdown here."
                          emptyStateTitle="No item history yet"
                          items={itemsBreakdown}
                          paginate={false}
                          title="Items sold"
                          totalItemsSold={totalItemsSold}
                          variant="canvas"
                        />
                      </div>
                    </SheetContent>
                  </Sheet>

                  {transactions.length === 0 ? (
                    <div className="order-2 flex min-h-[260px] items-center justify-center rounded-lg border border-dashed border-border bg-muted/25">
                      <EmptyState
                        icon={
                          <WalletCards className="h-12 w-12 text-muted-foreground" />
                        }
                        description="Completed POS sales linked to this register will appear here"
                        title="No linked transactions"
                      />
                    </div>
                  ) : (
                    <>
                      <div className="order-2 space-y-layout-sm md:hidden">
                        {previewTransactions.map((transaction) => {
                          const canOpenTransaction = Boolean(
                            orgUrlSlug && storeUrlSlug,
                          );
                          const transactionRoute = canOpenTransaction
                            ? {
                                params: {
                                  orgUrlSlug: orgUrlSlug!,
                                  storeUrlSlug: storeUrlSlug!,
                                  transactionId: transaction._id,
                                },
                                search: { o: getOrigin() },
                                to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId" as const,
                              }
                            : null;
                          const openTransaction = () => {
                            if (!transactionRoute) {
                              return;
                            }

                            navigate(transactionRoute);
                          };

                          return (
                            <RegisterSessionTransactionCard
                              canOpenTransaction={canOpenTransaction}
                              currency={currency}
                              key={transaction._id}
                              onOpen={openTransaction}
                              transaction={transaction}
                            />
                          );
                        })}
                      </div>
                      <div className="order-2 hidden overflow-hidden rounded-lg border border-border bg-surface-raised md:block">
                        <Table>
                          <TableHeader>
                            <TableRow className="border-b border-border hover:bg-transparent">
                              <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Transaction
                              </TableHead>
                              <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Total
                              </TableHead>
                              <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Cashier
                              </TableHead>
                              <TableHead className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                                Completed
                              </TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {previewTransactions.map((transaction) => {
                              const PaymentIcon = getPaymentMethodIcon({
                                hasMultiplePaymentMethods:
                                  transaction.hasMultiplePaymentMethods,
                                paymentMethod: transaction.paymentMethod,
                              });
                              const paymentMethodLabel =
                                transaction.hasMultiplePaymentMethods
                                  ? "Multiple payment methods"
                                  : `${formatPaymentMethod(transaction.paymentMethod)} payment`;
                              const transactionLabel = `#${transaction.transactionNumber}`;
                              const isVoidedTransaction =
                                transaction.status === "void" ||
                                typeof transaction.voidedAt === "number";
                              const canOpenTransaction = Boolean(
                                orgUrlSlug && storeUrlSlug,
                              );
                              const transactionRoute = canOpenTransaction
                                ? {
                                    params: {
                                      orgUrlSlug: orgUrlSlug!,
                                      storeUrlSlug: storeUrlSlug!,
                                      transactionId: transaction._id,
                                    },
                                    search: { o: getOrigin() },
                                    to: "/$orgUrlSlug/store/$storeUrlSlug/pos/transactions/$transactionId" as const,
                                  }
                                : null;

                              const openTransaction = () => {
                                if (!transactionRoute) {
                                  return;
                                }

                                navigate(transactionRoute);
                              };

                              return (
                                <TableRow
                                  aria-label={
                                    canOpenTransaction
                                      ? `Open transaction ${transactionLabel}`
                                      : undefined
                                  }
                                  className={
                                    canOpenTransaction
                                      ? "group border-b border-border/70 cursor-pointer transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                      : "border-b border-border/70 transition-colors"
                                  }
                                  key={transaction._id}
                                  onClick={
                                    canOpenTransaction
                                      ? openTransaction
                                      : undefined
                                  }
                                  onKeyDown={
                                    canOpenTransaction
                                      ? (event) => {
                                          if (
                                            event.key !== "Enter" &&
                                            event.key !== " "
                                          ) {
                                            return;
                                          }

                                          event.preventDefault();
                                          openTransaction();
                                        }
                                      : undefined
                                  }
                                  role={canOpenTransaction ? "link" : undefined}
                                  tabIndex={canOpenTransaction ? 0 : undefined}
                                >
                                  <TableCell>
                                    <div className="flex flex-col gap-1">
                                      <span className="inline-flex w-fit items-center gap-1 font-medium text-foreground group-hover:text-primary">
                                        {transactionLabel}
                                        {isVoidedTransaction ? (
                                          <span className="rounded-sm border border-destructive/30 bg-destructive/10 px-1.5 py-0.5 text-xs font-medium text-destructive">
                                            Voided
                                          </span>
                                        ) : null}
                                        {canOpenTransaction ? (
                                          <ArrowUpRight className="h-3.5 w-3.5" />
                                        ) : null}
                                      </span>
                                      <span className="text-xs text-muted-foreground">
                                        {transaction.itemCount}{" "}
                                        {transaction.itemCount === 1
                                          ? "item"
                                          : "items"}
                                        {transaction.customerName
                                          ? ` - ${transaction.customerName}`
                                          : ""}
                                      </span>
                                    </div>
                                  </TableCell>
                                  <TableCell>
                                    <span className="inline-flex items-center gap-2 text-foreground">
                                      <span className="font-numeric tabular-nums">
                                        {formatCurrency(
                                          currency,
                                          transaction.total,
                                        )}
                                      </span>
                                      <PaymentIcon
                                        aria-hidden="true"
                                        className="h-4 w-4 text-muted-foreground"
                                      />
                                      <span className="sr-only">
                                        {paymentMethodLabel}
                                      </span>
                                    </span>
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {transaction.cashierName
                                      ? formatStaffDisplayName({
                                          fullName: transaction.cashierName,
                                        })
                                      : "N/A"}
                                  </TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {formatTimestamp(transaction.completedAt)}
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                      {hasAdditionalTransactions &&
                      registerSession &&
                      orgUrlSlug &&
                      storeUrlSlug ? (
                        <div className="order-2 flex flex-col gap-layout-sm rounded-lg border border-border/70 bg-surface-raised px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:rounded-t-none md:border-t-0">
                          <p className="text-sm text-muted-foreground">
                            Showing latest {previewTransactions.length} of{" "}
                            {transactions.length} linked sales.
                          </p>
                          <Button
                            asChild
                            className="w-full sm:w-auto"
                            size="sm"
                            variant="outline"
                          >
                            <Link
                              params={{ orgUrlSlug, storeUrlSlug }}
                              search={{
                                o: getOrigin(),
                                ...(registerSession.openedOperatingDate
                                  ? {
                                      operatingDate:
                                        registerSession.openedOperatingDate,
                                    }
                                  : {}),
                                registerSessionId: registerSession._id,
                              }}
                              to="/$orgUrlSlug/store/$storeUrlSlug/pos/transactions"
                            >
                              View all linked transactions
                              <ArrowUpRight className="h-3.5 w-3.5" />
                            </Link>
                          </Button>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              </div>
            )}
          </section>
        </div>
      </FadeIn>
    </View>
  );
}

export function RegisterSessionView() {
  const {
    activeStore,
    canAccessProtectedSurface,
    canQueryProtectedData,
    hasFullAdminAccess,
    hasFinancialDetailsAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "cash_controls" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
  const { user } = useAuth();
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        sessionId?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const automaticSyncReviewAttemptRef = useRef<string | null>(null);

  const registerSessionSnapshotArgs =
    canQueryProtectedData && params?.sessionId
      ? {
          registerSessionId: params.sessionId as Id<"registerSession">,
          storeId: activeStore!._id,
        }
      : "skip";
  const registerSessionSnapshot = useQuery(
    api.cashControls.deposits.getRegisterSessionSnapshot,
    registerSessionSnapshotArgs,
  );
  const activeStaffProfiles = useQuery(
    api.operations.staffProfiles.listStaffProfiles,
    canQueryProtectedData && activeStore && user?._id
      ? {
          status: "active" as const,
          storeId: activeStore._id,
        }
      : "skip",
  );
  const actorStaffProfile = useMemo(
    () =>
      activeStaffProfiles?.find(
        (staffProfile) =>
          staffProfile.linkedUserId === user?._id &&
          staffProfile.storeId === activeStore?._id &&
          staffProfile.status === "active",
      ),
    [activeStaffProfiles, activeStore?._id, user?._id],
  );
  const actorStaffProfileId = actorStaffProfile?._id;
  const recordRegisterSessionDeposit = useMutation(
    api.cashControls.deposits.recordRegisterSessionDeposit,
  );
  const resolveRegisterSessionSyncReview = useMutation(
    api.cashControls.deposits.resolveRegisterSessionSyncReview,
  );
  const submitRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.submitRegisterSessionCloseout,
  );
  const finalizeRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.finalizeRegisterSessionCloseout,
  );
  const reviewRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.reviewRegisterSessionCloseout,
  );
  const reopenRegisterSessionCloseout = useMutation(
    api.cashControls.closeouts.reopenRegisterSessionCloseout,
  );
  const authenticateStaffCredential = useMutation(
    api.operations.staffCredentials.authenticateStaffCredential,
  );
  const authenticateStaffCredentialForApproval = useMutation(
    api.operations.staffCredentials.authenticateStaffCredentialForApproval,
  );
  const correctOpeningFloatReference = (
    api as unknown as {
      cashControls?: {
        closeouts?: {
          correctRegisterSessionOpeningFloat?: unknown;
        };
      };
    }
  ).cashControls?.closeouts?.correctRegisterSessionOpeningFloat;
  const correctOpeningFloatMutation = useMutation(
    (correctOpeningFloatReference ??
      api.operations.staffCredentials.authenticateStaffCredential) as never,
  );
  const automaticSyncReviewSignature = useMemo(
    () =>
      getAutomaticStaffAccessSyncReviewSignature(
        registerSessionSnapshot?.registerSession,
      ),
    [registerSessionSnapshot?.registerSession],
  );

  useEffect(() => {
    const registerSessionId = registerSessionSnapshot?.registerSession?._id;
    if (
      !activeStore?._id ||
      !automaticSyncReviewSignature ||
      !registerSessionId
    ) {
      return;
    }

    if (
      automaticSyncReviewAttemptRef.current === automaticSyncReviewSignature
    ) {
      return;
    }
    automaticSyncReviewAttemptRef.current = automaticSyncReviewSignature;

    void runCommand(() =>
      resolveRegisterSessionSyncReview({
        decision: "approved",
        registerSessionId: registerSessionId as Id<"registerSession">,
        storeId: activeStore._id,
      }),
    ).then((result) => {
      if (result.kind !== "ok") {
        automaticSyncReviewAttemptRef.current = null;
        return;
      }
      if (result.data.action === "resolved") {
        toast.success("Synced register activity applied");
      }
    });
  }, [
    activeStore?._id,
    automaticSyncReviewSignature,
    registerSessionSnapshot?.registerSession?._id,
    resolveRegisterSessionSyncReview,
  ]);

  async function onRecordDeposit(args: RecordRegisterSessionDepositArgs) {
    const result = await runCommand(() =>
      recordRegisterSessionDeposit({
        actorStaffProfileId: args.actorStaffProfileId as
          Id<"staffProfile"> | undefined,
        actorUserId: args.actorUserId as Id<"athenaUser"> | undefined,
        amount: args.amount,
        notes: args.notes,
        reference: args.reference,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        storeId: args.storeId as Id<"store">,
        submissionKey: args.submissionKey,
      }),
    );

    if (result.kind === "ok") {
      toast.success(
        result.data?.action === "duplicate"
          ? "Deposit already recorded"
          : "Register deposit recorded",
      );
    }

    return result;
  }

  async function onResolveSyncReview(args: ResolveSyncReviewArgs) {
    if (!activeStore?._id) {
      return userError({
        code: "authentication_failed",
        message: "Select a store before resolving this register review",
      });
    }

    const result = await runCommand(() =>
      resolveRegisterSessionSyncReview({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        approvalProofId: args.approvalProofId as
          Id<"approvalProof"> | undefined,
        decision: args.decision,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        requestedByStaffProfileId: args.requestedByStaffProfileId as
          Id<"staffProfile"> | undefined,
        reviewConflictIds: args.reviewConflictIds,
        storeId: activeStore._id,
      }),
    );

    return result as ResolveSyncReviewResult;
  }

  async function onSubmitCloseout(args: RegisterCloseoutSubmitArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to submit a register closeout",
      });
    }

    const result = await runCommand(() =>
      submitRegisterSessionCloseout({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        actorUserId: user._id,
        approvalProofId: args.approvalProofId as
          Id<"approvalProof"> | undefined,
        closeoutModificationApprovalProofId:
          args.closeoutModificationApprovalProofId as
            Id<"approvalProof"> | undefined,
        countedCash: args.countedCash,
        notes: args.notes,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        requestedByStaffProfileId: args.requestedByStaffProfileId as
          Id<"staffProfile"> | undefined,
        staffPinHash: args.staffPinHash,
        staffUsername: args.staffUsername,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success(
        result.data?.action === "submitted"
          ? "Closeout submitted"
          : "Register session closed",
      );
    }

    return result;
  }

  async function onFinalizeCloseout(args: RegisterCloseoutFinalizeArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to finalize a register closeout",
      });
    }

    const result = await runCommand(() =>
      finalizeRegisterSessionCloseout({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        actorUserId: user._id,
        approvalProofId: args.approvalProofId as
          Id<"approvalProof"> | undefined,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        requestedByStaffProfileId: args.requestedByStaffProfileId as
          Id<"staffProfile"> | undefined,
        staffPinHash: args.staffPinHash,
        staffUsername: args.staffUsername,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success("Register session closed");
    }

    return result;
  }

  async function onAuthenticateStaff(args: {
    allowedRoles: StaffAuthenticationRole[];
    pinHash: string;
    username: string;
  }) {
    if (!activeStore?._id) {
      return userError({
        code: "authentication_failed",
        message: "Select a store before confirming staff credentials",
      });
    }

    return runCommand(() =>
      authenticateStaffCredential({
        allowedRoles: args.allowedRoles,
        pinHash: args.pinHash,
        storeId: activeStore._id,
        username: args.username,
      }),
    );
  }

  async function onAuthenticateCloseoutReviewApproval(args: {
    pinHash: string;
    reason?: string;
    registerSessionId: string;
    requesterBinding?: ApprovalRequesterBinding;
    requestedByStaffProfileId?: Id<"staffProfile">;
    username: string;
  }): Promise<CloseoutApprovalAuthenticationCommandResult> {
    if (!activeStore?._id) {
      return userError({
        code: "authentication_failed",
        message: "Select a store before confirming manager approval",
      });
    }

    const session = registerSessionSnapshot?.registerSession;
    const result = await runCommand(
      () =>
        authenticateStaffCredentialForApproval({
          actionKey: "cash_controls.register_session.review_variance",
          pinHash: args.pinHash,
          reason: args.reason,
          requiredRole: "manager",
          requesterBinding: toApprovalRequesterBindingArg(
            args.requesterBinding,
          ),
          requestedByStaffProfileId: args.requestedByStaffProfileId,
          storeId: activeStore._id,
          subject: {
            id: args.registerSessionId,
            label: session?.registerNumber ?? undefined,
            type: "register_session",
          },
          username: args.username,
        }) as Promise<CommandResult<CommandApprovalProofResult>>,
    );

    if (result.kind !== "ok") {
      return result;
    }

    return {
      kind: "ok",
      data: {
        approvalProofId: result.data.approvalProofId,
        staffProfile: {},
        staffProfileId: result.data.approvedByStaffProfileId,
      },
    };
  }

  async function onAuthenticateForApproval(
    args: Parameters<
      NonNullable<RegisterSessionViewContentProps["onAuthenticateForApproval"]>
    >[0],
  ) {
    if (!activeStore?._id) {
      return userError({
        code: "authentication_failed",
        message: "Select a store before confirming manager approval",
      });
    }

    return runCommand(
      () =>
        authenticateStaffCredentialForApproval({
          actionKey: args.actionKey,
          pinHash: args.pinHash,
          reason: args.reason,
          requiredRole: args.requiredRole,
          requesterBinding: toApprovalRequesterBindingArg(
            args.requesterBinding,
          ),
          requestedByStaffProfileId: args.requestedByStaffProfileId,
          storeId: activeStore._id,
          subject: args.subject,
          username: args.username,
        }) as Promise<CommandResult<CommandApprovalProofResult>>,
    );
  }

  async function onReviewCloseout(args: RegisterCloseoutReviewArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to review a register closeout",
      });
    }

    const result = await runCommand(() =>
      reviewRegisterSessionCloseout({
        approvalProofId: args.approvalProofId as Id<"approvalProof">,
        decision: args.decision,
        decisionNotes: args.decisionNotes,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        reviewedByUserId: user._id,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success(
        args.decision === "approved"
          ? "Register closeout approved"
          : "Register closeout rejected",
      );
    }

    return result;
  }

  async function onReopenCloseout(args: {
    actorStaffProfileId: string;
    approvalProofId: string;
    registerSessionId: string;
    requestedByStaffProfileId?: string;
  }) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to reopen a register closeout",
      });
    }

    const result = await runCommand(() =>
      reopenRegisterSessionCloseout({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        actorUserId: user._id,
        approvalProofId: args.approvalProofId as Id<"approvalProof">,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        requestedByStaffProfileId: args.requestedByStaffProfileId as
          Id<"staffProfile"> | undefined,
        storeId: activeStore._id,
      }),
    );

    if (result.kind === "ok") {
      toast.success("Register closeout reopened");
    }

    return result;
  }

  async function onCorrectOpeningFloat(args: CorrectOpeningFloatArgs) {
    if (!activeStore?._id || !user?._id) {
      return userError({
        code: "authentication_failed",
        message: "You must be logged in to correct opening float",
      });
    }

    if (!correctOpeningFloatReference) {
      return userError({
        code: "unavailable",
        message:
          "Opening float correction is not available yet. Try again after the register tools refresh.",
      });
    }

    const result = (await runCommand(() =>
      (
        correctOpeningFloatMutation as unknown as (
          args: Record<string, unknown>,
        ) => Promise<
          | CommandResult<{ action?: "corrected" | "duplicate" }>
          | { kind: "approval_required"; approval: ApprovalRequirement }
        >
      )({
        actorStaffProfileId: args.actorStaffProfileId as Id<"staffProfile">,
        actorUserId: user._id,
        approvalProofId: args.approvalProofId as
          Id<"approvalProof"> | undefined,
        correctedOpeningFloat: args.correctedOpeningFloat,
        reason: args.reason,
        registerSessionId: args.registerSessionId as Id<"registerSession">,
        storeId: activeStore._id,
      }),
    )) as CorrectOpeningFloatCommandResult;

    if (result.kind === "ok") {
      toast.success("Opening float corrected");
    }

    return result;
  }

  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before this register session can load protected cash-controls data" />
    );
  }

  if (!canAccessSurface) {
    return <NoPermissionView />;
  }

  if (!activeStore) {
    return null;
  }

  return (
    <RegisterSessionViewContent
      actorStaffProfileId={actorStaffProfileId}
      actorUserId={user?._id}
      canViewFinancialDetails={hasFinancialDetailsAccess}
      currency={activeStore.currency || "USD"}
      isLoading={
        registerSessionSnapshot === undefined ||
        (user?._id !== undefined && activeStaffProfiles === undefined)
      }
      onAuthenticateForApproval={onAuthenticateForApproval}
      onAuthenticateCloseoutReviewApproval={
        onAuthenticateCloseoutReviewApproval
      }
      onAuthenticateStaff={onAuthenticateStaff}
      onCorrectOpeningFloat={onCorrectOpeningFloat}
      onFinalizeCloseout={onFinalizeCloseout}
      onRecordDeposit={onRecordDeposit}
      onReopenCloseout={onReopenCloseout}
      onReviewCloseout={onReviewCloseout}
      onResolveSyncReview={onResolveSyncReview}
      onSubmitCloseout={onSubmitCloseout}
      orgUrlSlug={params?.orgUrlSlug}
      registerSessionSnapshot={registerSessionSnapshot ?? null}
      storeId={activeStore._id}
      storeUrlSlug={params?.storeUrlSlug}
    />
  );
}

export function RegisterSessionActivityView() {
  const navigate = useNavigate();
  const {
    activeStore,
    canAccessProtectedSurface,
    canQueryProtectedData,
    hasFullAdminAccess,
    isAuthenticated,
    isLoadingAccess,
  } = useProtectedAdminPageState({ surface: "cash_controls" });
  const canAccessSurface = canAccessProtectedSurface ?? hasFullAdminAccess;
  const params = useParams({ strict: false }) as
    | {
        orgUrlSlug?: string;
        sessionId?: string;
        storeUrlSlug?: string;
      }
    | undefined;
  const search = useSearch({ strict: false }) as {
    filter?: unknown;
    page?: unknown;
  };
  const filter = parseActivityFilterSearchValue(search.filter);
  const page = parseActivityPageSearchValue(search.page);
  const handlePageChange = useCallback(
    (nextPage: number) => {
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) => {
          const next = { ...current };
          if (nextPage > 1) {
            next.page = nextPage;
          } else {
            delete next.page;
          }
          return next;
        }) as never,
      });
    },
    [navigate],
  );
  const handleFilterChange = useCallback(
    (nextFilter: RegisterSessionActivityFilter) => {
      void navigate({
        replace: true,
        search: ((current: Record<string, unknown>) => {
          const next = { ...current };
          if (nextFilter === "all") {
            delete next.filter;
          } else {
            next.filter = nextFilter;
          }
          delete next.page;
          return next;
        }) as never,
      });
    },
    [navigate],
  );

  const registerSessionActivity = useQuery(
    registerSessionActivityQuery,
    canQueryProtectedData &&
      hasFullAdminAccess &&
      activeStore &&
      params?.sessionId
      ? {
          paginationOpts: { cursor: null, numItems: 100 },
          registerSessionId: params.sessionId as Id<"registerSession">,
          storeId: activeStore._id,
        }
      : "skip",
  );

  if (isLoadingAccess) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <ProtectedAdminSignInView description="Your Athena session needs to reconnect before this register session activity can load protected cash-controls data" />
    );
  }

  if (!canAccessSurface || !hasFullAdminAccess) {
    return <NoPermissionView />;
  }

  if (!activeStore) {
    return null;
  }

  return (
    <RegisterSessionActivityViewContent
      activity={registerSessionActivity ?? null}
      currency={activeStore.currency || "USD"}
      filter={filter}
      isLoading={registerSessionActivity === undefined}
      onFilterChange={handleFilterChange}
      onPageChange={handlePageChange}
      orgUrlSlug={params?.orgUrlSlug}
      page={page}
      sessionId={params?.sessionId}
      storeUrlSlug={params?.storeUrlSlug}
    />
  );
}
