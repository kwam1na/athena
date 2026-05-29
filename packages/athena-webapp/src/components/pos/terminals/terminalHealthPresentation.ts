import type {
  TerminalRecord,
  TerminalSyncEvent,
  TerminalSyncEvidence,
  TerminalRuntimeStatus,
  TerminalHealthAttentionReason,
} from "./terminalHealthTypes";

export type TerminalHealthClassification = {
  description: string;
  label: string;
  toneClassName: string;
};

type TerminalHealthClassificationInput = {
  attentionReasons?: TerminalHealthAttentionReason[];
  health?: "needs_attention" | "offline" | "online" | "stale" | "unknown" | string;
  runtimeStatus:
    | (Omit<Partial<TerminalRuntimeStatus>, "localStore" | "sync"> & {
        localStore?: Partial<TerminalRuntimeStatus["localStore"]>;
        sync?: Partial<TerminalRuntimeStatus["sync"]>;
      })
    | null;
  syncEvidence: Partial<TerminalSyncEvidence>;
  terminal: Pick<TerminalRecord, "status"> & Partial<TerminalRecord>;
};

const STALE_CHECK_IN_MS = 30 * 60_000;

export function formatTerminalTimestamp(timestamp?: number | null) {
  if (!timestamp) {
    return "Not recorded";
  }

  const delta = timestamp - Date.now();
  const absoluteDelta = Math.abs(delta);
  const units = [
    { divisor: 24 * 60 * 60_000, unit: "day" },
    { divisor: 60 * 60_000, unit: "hour" },
    { divisor: 60_000, unit: "minute" },
    { divisor: 1_000, unit: "second" },
  ] as const;
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  const selected = units.find((unit) => absoluteDelta >= unit.divisor) ?? units[3];

  return formatter.format(Math.round(delta / selected.divisor), selected.unit);
}

export function formatAge(ageMs?: number | null) {
  if (typeof ageMs !== "number" || !Number.isFinite(ageMs)) {
    return "Not reported";
  }

  const minutes = Math.max(1, Math.round(ageMs / 60_000));
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"} old`;
  }

  const hours = Math.round(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"} old`;
}

export function formatRegisterNumber(registerNumber?: string | null) {
  const trimmed = registerNumber?.trim();
  if (!trimmed) {
    return "No register number";
  }

  return /^register\b/i.test(trimmed) ? trimmed : `Register ${trimmed}`;
}

export function formatStatusLabel(status?: string | null) {
  if (!status) {
    return "Unknown";
  }

  return status
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .split(" ")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export function getSnapshotAgeSummary(
  snapshots?: TerminalRuntimeStatus["snapshots"] | null,
) {
  if (!snapshots) {
    return "Snapshots not reported";
  }

  const parts = [
    snapshots.availabilityAgeMs !== undefined
      ? `Availability ${formatAge(snapshots.availabilityAgeMs)}`
      : null,
    snapshots.catalogAgeMs !== undefined
      ? `Catalog ${formatAge(snapshots.catalogAgeMs)}`
      : null,
    snapshots.registerReadModelAgeMs !== undefined
      ? `Register read model ${formatAge(snapshots.registerReadModelAgeMs)}`
      : null,
  ].filter(Boolean);

  return parts.length > 0 ? parts.join(" / ") : "Snapshots not reported";
}

export function getStaffAuthorityLabel(
  status?: TerminalRuntimeStatus["staffAuthority"] | null,
) {
  switch (status?.status) {
    case "ready":
      return "Staff authority ready";
    case "expired":
      return "Staff authority expired";
    case "missing":
      return "Staff authority missing";
    default:
      return "Staff authority unknown";
  }
}

export function getReviewEvidenceCount(
  syncEvidence?: Partial<TerminalSyncEvidence> | null,
) {
  if (!syncEvidence) {
    return 0;
  }

  const cloudReviewCount =
    (syncEvidence.conflictedCount ?? 0) +
    (syncEvidence.heldCount ?? 0) +
    (syncEvidence.rejectedCount ?? 0);

  return Math.max(syncEvidence.unresolvedConflictCount ?? 0, cloudReviewCount);
}

export function getRecentSyncEvents(
  syncEvidence?: Partial<TerminalSyncEvidence> | null,
): TerminalSyncEvent[] {
  if (!syncEvidence) {
    return [];
  }

  return syncEvidence.latestEvent ? [syncEvidence.latestEvent] : [];
}

export function getTerminalAttentionReasons(
  summary: TerminalHealthClassificationInput,
): TerminalHealthAttentionReason[] {
  return summary.attentionReasons ?? [];
}

export function getPrimaryTerminalAttentionReason(
  summary: TerminalHealthClassificationInput,
) {
  return getTerminalAttentionReasons(summary)[0] ?? null;
}

export function classifyTerminalHealth(
  summary: TerminalHealthClassificationInput,
): TerminalHealthClassification {
  if (summary.terminal.status !== "active") {
    return {
      description: "This terminal is not active for checkout.",
      label: formatStatusLabel(summary.terminal.status),
      toneClassName: "border-muted bg-muted/40 text-muted-foreground",
    };
  }

  const runtimeStatus = summary.runtimeStatus;
  const primaryReason = getPrimaryTerminalAttentionReason(summary);
  if (summary.health === "needs_attention" && primaryReason) {
    switch (primaryReason.type) {
      case "local_review":
      case "cloud_conflict":
      case "cloud_held":
      case "cloud_rejected":
        return {
          description: primaryReason.summary,
          label: "Needs review",
          toneClassName: "border-warning/30 bg-warning/15 text-warning",
        };
      case "sync_failed":
        return {
          description: primaryReason.summary,
          label: "Sync failed",
          toneClassName: "border-danger/30 bg-danger/10 text-danger",
        };
      case "sync_unavailable":
        return {
          description: primaryReason.summary,
          label: "Sync unavailable",
          toneClassName: "border-danger/30 bg-danger/10 text-danger",
        };
      case "local_store_unavailable":
        return {
          description: primaryReason.summary,
          label: "Local store issue",
          toneClassName: "border-danger/30 bg-danger/10 text-danger",
        };
      case "terminal_seed_missing":
      case "terminal_authorization_failed":
        return {
          description: primaryReason.summary,
          label: "Setup needed",
          toneClassName: "border-warning/30 bg-warning/15 text-warning",
        };
      case "drawer_authority_blocked":
        return {
          description: primaryReason.summary,
          label: "Drawer repair needed",
          toneClassName: "border-warning/30 bg-warning/15 text-warning",
        };
    }
  }

  if (!runtimeStatus) {
    return {
      description: "This terminal has not reported runtime health yet.",
      label: "No check-in",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  const sync = runtimeStatus.sync;
  if (
    sync?.status === "needs_review" ||
    (sync?.reviewEventCount ?? 0) > 0 ||
    getReviewEvidenceCount(summary.syncEvidence) > 0
  ) {
    return {
      description:
        primaryReason?.summary ?? "Local activity needs manager or support review.",
      label: "Needs review",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  if (sync?.status === "failed" || (sync?.failedEventCount ?? 0) > 0) {
    return {
      description: primaryReason?.summary ?? "The last sync attempt failed.",
      label: "Sync failed",
      toneClassName: "border-danger/30 bg-danger/10 text-danger",
    };
  }

  if (runtimeStatus.localStore?.available === false) {
    return {
      description:
        primaryReason?.summary ?? "Local terminal storage is not available.",
      label: "Local store issue",
      toneClassName: "border-danger/30 bg-danger/10 text-danger",
    };
  }

  if (summary.health === "offline") {
    return {
      description: "This terminal is offline.",
      label: "Offline",
      toneClassName: "border-danger/30 bg-danger/10 text-danger",
    };
  }

  if (summary.health === "stale") {
    return {
      description: "This terminal has not checked in recently.",
      label: "Stale",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  if (
    typeof runtimeStatus.receivedAt === "number" &&
    Date.now() - runtimeStatus.receivedAt > STALE_CHECK_IN_MS
  ) {
    return {
      description: "This terminal has not checked in recently.",
      label: "Stale",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  if (
    sync?.status === "pending" ||
    sync?.status === "syncing" ||
    (sync?.pendingEventCount ?? 0) > 0 ||
    (sync?.uploadableEventCount ?? 0) > 0
  ) {
    return {
      description: "Local events are waiting for cloud sync.",
      label: sync?.status === "syncing" ? "Syncing" : "Pending sync",
      toneClassName: "border-warning/30 bg-warning/15 text-warning",
    };
  }

  return {
    description: "The latest terminal check-in is clear.",
    label: "Healthy",
    toneClassName: "border-success/30 bg-success/10 text-success",
  };
}
