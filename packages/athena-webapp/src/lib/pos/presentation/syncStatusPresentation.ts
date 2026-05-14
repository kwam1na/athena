export type PosSyncStatusKind =
  | "synced"
  | "syncing"
  | "pending_sync"
  | "locally_closed_pending_sync"
  | "needs_review";

export type PosSyncStatusTone = "success" | "neutral" | "warning" | "danger";

export type PosReconciliationItem = {
  id?: string;
  status?: string | null;
  summary?: string | null;
  type?: string | null;
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

export function buildPosSyncStatusPresentation(
  source?: SyncStatusSource | null,
): PosSyncStatusPresentation {
  const status = normalizeStatus(source?.status);
  const base = STATUS_COPY[status];
  const pendingEventCount =
    typeof source?.pendingEventCount === "number" &&
    Number.isFinite(source.pendingEventCount) &&
    source.pendingEventCount > 0
      ? source.pendingEventCount
      : undefined;

  return {
    ...base,
    description: source?.description?.trim() || base.description,
    label: source?.label?.trim() || base.label,
    pendingEventCount,
    reconciliationItems: source?.reconciliationItems ?? [],
  };
}

export function formatPosReconciliationType(type?: string | null): string {
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
      return "Closeout review";
    default:
      return "Reconciliation review";
  }
}
