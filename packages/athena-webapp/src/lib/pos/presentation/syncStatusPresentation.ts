export type PosSyncStatusKind =
  | "synced"
  | "syncing"
  | "pending_sync"
  | "locally_closed_pending_sync"
  | "needs_review";

export type PosSyncStatusTone = "success" | "neutral" | "warning" | "danger";

export type PosReconciliationItem = {
  actionPolicy?: "apply_or_reject" | "override_or_reject" | "reject_only";
  createdAt?: number | null;
  expectedCash?: number | null;
  id?: string;
  localEventId?: string | null;
  countedCash?: number | null;
  notes?: string | null;
  reviewKind?:
    | "duplicate_register_closeout"
    | "duplicate_register_open"
    | "duplicate_pos_session_sale"
    | "register_closeout_variance"
    | "register_not_open_sale"
    | "missing_register_session_mapping"
    | "server_rejected"
    | "service_customer_attribution"
    | "inventory_review"
    | "staff_access"
    | "unknown";
  sequence?: number | null;
  status?: string | null;
  summary?: string | null;
  sale?: {
    cashAmount?: number | null;
    itemCount?: number | null;
    items?: Array<{
      name: string;
      productSkuId?: string | null;
      quantity?: number | null;
      sku?: string | null;
      total?: number | null;
    }>;
    localReceiptNumber?: string | null;
    localTransactionId?: string | null;
    occurredAt?: number | null;
    paymentMethods?: string[];
    receiptNumber?: string | null;
    staffName?: string | null;
    staffProfileId?: string | null;
    total?: number | null;
    totalPaid?: number | null;
    transactionId?: string | null;
  } | null;
  inventoryReview?: {
    activeHeldQuantity?: number | null;
    availableInventoryCount?: number | null;
    heldForSession?: number | null;
    inventoryImportProvisionalSkuId?: string | null;
    pendingCheckoutItemId?: string | null;
    productSkuId?: string | null;
    quantityAvailable?: number | null;
    quantityAvailableAfterHolds?: number | null;
    reason?: string | null;
    requestedQuantity?: number | null;
  } | null;
  type?: string | null;
  variance?: number | null;
};

export type PosSyncStatusPresentation = {
  description: string;
  label: string;
  pendingEventCount?: number;
  reconciliationItems: PosReconciliationItem[];
  status: PosSyncStatusKind;
  tone: PosSyncStatusTone;
};

type SyncStatusSource = {
  description?: string | null;
  label?: string | null;
  pendingEventCount?: number | null;
  reconciliationItems?: PosReconciliationItem[] | null;
  status?: string | null;
};

const STATUS_COPY: Record<
  PosSyncStatusKind,
  Omit<PosSyncStatusPresentation, "pendingEventCount" | "reconciliationItems">
> = {
  synced: {
    description: "Register activity is up to date in Athena.",
    label: "Synced",
    status: "synced",
    tone: "success",
  },
  syncing: {
    description: "Athena is uploading local register activity.",
    label: "Syncing",
    status: "syncing",
    tone: "neutral",
  },
  pending_sync: {
    description: "Register activity is saved locally and will sync when ready.",
    label: "Pending sync",
    status: "pending_sync",
    tone: "warning",
  },
  locally_closed_pending_sync: {
    description:
      "This register was closed locally. Athena will reconcile the closeout after sync.",
    label: "Locally closed",
    status: "locally_closed_pending_sync",
    tone: "warning",
  },
  needs_review: {
    description: "Synced register activity needs manager review.",
    label: "Needs review",
    status: "needs_review",
    tone: "danger",
  },
};

function normalizeStatus(status?: string | null): PosSyncStatusKind {
  switch (status) {
    case "synced":
    case "syncing":
    case "pending_sync":
    case "locally_closed_pending_sync":
    case "needs_review":
      return status;
    case "pending":
    case "offline":
    case "stale":
    case "terminal_stale":
    case "pending_check_in":
      return "pending_sync";
    case "local_closed":
    case "closed_pending_sync":
      return "locally_closed_pending_sync";
    case "conflict":
    case "conflicted":
    case "review":
      return "needs_review";
    default:
      return status ? "needs_review" : "synced";
  }
}

export function isRegisterCloseoutReviewItem(item: PosReconciliationItem) {
  if (
    item.reviewKind === "duplicate_register_closeout" ||
    item.reviewKind === "register_closeout_variance"
  ) {
    return true;
  }

  const localEventId = item.localEventId?.toLowerCase() ?? "";
  const summary = item.summary?.toLowerCase() ?? "";

  return (
    item.type === "register_closeout" ||
    localEventId.includes("register-closed") ||
    localEventId.includes("register-closeout") ||
    summary.includes("register closeout")
  );
}

export function isDuplicateLocalIdReviewItem(item: PosReconciliationItem) {
  if (isDuplicatePosSessionSaleReviewItem(item)) {
    return false;
  }

  const summary = item.summary?.trim().toLowerCase() ?? "";

  return (
    item.reviewKind === "duplicate_register_open" ||
    item.type === "duplicate_local_id" ||
    summary.includes("already open for this terminal") ||
    summary.includes("already open for this register number") ||
    summary.includes("session id was reused") ||
    summary.includes("duplicate")
  );
}

export function isDuplicatePosSessionSaleReviewItem(
  item: PosReconciliationItem,
) {
  const summary = item.summary?.trim().toLowerCase() ?? "";

  return (
    item.reviewKind === "duplicate_pos_session_sale" ||
    summary === "local pos session id was reused by a different synced sale." ||
    (item.type === "duplicate_local_id" &&
      summary.includes("local pos session id was reused"))
  );
}

export function buildPosSyncStatusPresentation(
  source?: SyncStatusSource | null,
): PosSyncStatusPresentation {
  const status = normalizeStatus(source?.status);
  const base = STATUS_COPY[status];
  const reconciliationItems = source?.reconciliationItems ?? [];
  const hasCloseoutReview =
    status === "needs_review" &&
    reconciliationItems.some(isRegisterCloseoutReviewItem);
  const pendingEventCount =
    typeof source?.pendingEventCount === "number" &&
    Number.isFinite(source.pendingEventCount) &&
    source.pendingEventCount > 0
      ? source.pendingEventCount
      : undefined;

  return {
    ...base,
    description:
      source?.description?.trim() ||
      (hasCloseoutReview
        ? "Synced register closeout has a variance. Review it before this closeout can be applied."
        : base.description),
    label:
      source?.label?.trim() ||
      (hasCloseoutReview ? "Closeout review" : base.label),
    pendingEventCount,
    reconciliationItems,
  };
}

export function formatPosReconciliationType(
  type?: string | null,
  item?: PosReconciliationItem,
): string {
  if (item && isRegisterCloseoutReviewItem(item)) {
    return "Closeout variance review";
  }

  if (item && isDuplicatePosSessionSaleReviewItem(item)) {
    return "Synced sale preservation";
  }

  if (item && isDuplicateLocalIdReviewItem(item)) {
    return "Duplicate register opening";
  }

  switch (type) {
    case "inventory":
    case "inventory_conflict":
      return "Inventory review";
    case "payment":
    case "payment_record":
    case "payment_conflict":
      return "Payment review";
    case "permission":
    case "permission_drift":
      return "Permission review";
    case "register_closeout":
      return "Closeout variance review";
    default:
      return "Reconciliation review";
  }
}
