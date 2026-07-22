import { paginationOptsValidator } from "convex/server";
import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import { query, type QueryCtx } from "../_generated/server";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { admitSharedDemoPublicQuery } from "../operationAdmission/publicQuery";
import { listRegisterSessionActivityReadDefinition } from "../operationAdmission/readDefinitions";
import type { OperationQueryCtx } from "../operationAdmission/types";
import { formatStaffDisplayName } from "../../shared/staffDisplayName";

const DEFAULT_ACTIVITY_PAGE_SIZE = 25;
const MAX_ACTIVITY_PAGE_SIZE = 50;
const LOCAL_SESSION_MAPPING_LIMIT = 20;
const EVENT_LINK_LIMIT = 50;

const ACTIVITY_CATEGORIES = [
  "register",
  "session",
  "cart",
  "payment",
  "service",
  "cash",
  "expense",
  "sale",
  "closeout",
  "reopen",
  "sync",
  "review",
] as const;

const ATTENTION_STATUSES = [
  "mapping_pending",
  "held",
  "conflicted",
  "rejected",
  "manager_applied",
  "manager_rejected",
  "activity_patch_failed",
] as const;

type ActivityCategory = (typeof ACTIVITY_CATEGORIES)[number];
type AttentionStatus = (typeof ATTENTION_STATUSES)[number];
type CoverageState =
  "reported" | "partially_reported" | "unreported" | "unknown_terminal_state";

type SyncEvidenceEvent = Doc<"posLocalSyncEvent">;
type SyncEvidenceConflict = Doc<"posLocalSyncConflict">;
type SyncEvidenceMapping = Doc<"posLocalSyncMapping">;
type SyncEvidenceCursor = Doc<"posLocalSyncCursor">;
type ActivityReadModelRow = Doc<"posRegisterSessionActivity">;
type ActivityReadModelStatus = ActivityReadModelRow["status"];
type ActivityCheckpointRow = Doc<"posRegisterSessionActivityCheckpoint">;

export type RegisterSessionActivityRow = {
  _id: string;
  actorStaffName: string | null;
  category: ActivityCategory;
  evidenceLinks: Array<{
    id: string;
    label: string;
    type: "closeout" | "expense" | "review" | "sync" | "transaction";
  }>;
  item: {
    label: string;
    quantity: number | null;
    unitPrice: number | null;
  } | null;
  label: string;
  localEventId: string | null;
  localRegisterSessionId: string | null;
  openingFloat: number | null;
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
};

export type RegisterSessionActivityPage = {
  continueCursor: string;
  integration: {
    activityReadModelAvailable: boolean;
    source: "activity_read_model" | "pos_sync_evidence";
  };
  isDone: boolean;
  registerSession?: {
    _id: Id<"registerSession">;
    registerNumber: string | null;
    terminalName: string | null;
  };
  page: RegisterSessionActivityRow[];
  summary: {
    attentionCounts: Record<AttentionStatus, number>;
    categoryCounts: Record<ActivityCategory, number>;
    coverageState: CoverageState;
    latestCloudStatusAt: number | null;
    lastActivityReportedAt: number | null;
    reportedThroughSequence: number | null;
    rowCount: number;
  };
};

function emptyCategoryCounts() {
  return Object.fromEntries(
    ACTIVITY_CATEGORIES.map((category) => [category, 0]),
  ) as Record<ActivityCategory, number>;
}

function emptyAttentionCounts() {
  return Object.fromEntries(
    ATTENTION_STATUSES.map((status) => [status, 0]),
  ) as Record<AttentionStatus, number>;
}

function clampPageSize(numItems: number) {
  if (!Number.isFinite(numItems) || numItems <= 0) {
    return DEFAULT_ACTIVITY_PAGE_SIZE;
  }

  return Math.min(Math.floor(numItems), MAX_ACTIVITY_PAGE_SIZE);
}

function parseSequenceCursor(cursor: string | null) {
  if (!cursor) return null;
  const parsed = Number(cursor);
  return Number.isFinite(parsed) ? parsed : null;
}

function buildContinueCursor(rows: RegisterSessionActivityRow[]) {
  const lastRow = rows.at(-1);
  return lastRow?.sequence === null || lastRow?.sequence === undefined
    ? ""
    : String(lastRow.sequence);
}

function stringDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function numberDetail(
  details: Record<string, unknown> | undefined,
  key: string,
) {
  const value = details?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function arrayDetail(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function countLabel(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function eventCategory(
  eventType: SyncEvidenceEvent["eventType"],
): ActivityCategory {
  switch (eventType) {
    case "register_opened":
      return "register";
    case "store_day_started":
      return "session";
    case "pending_checkout_item_defined":
    case "sale_cleared":
      return "cart";
    case "sale_completed":
      return "sale";
    case "register_closed":
      return "closeout";
    case "register_reopened":
      return "reopen";
    case "expense_recorded":
      return "expense";
  }
}

function eventLabel(
  eventType: SyncEvidenceEvent["eventType"],
  payload?: Record<string, unknown>,
) {
  switch (eventType) {
    case "register_opened":
      return "Register opened";
    case "store_day_started":
      return "Store day started";
    case "pending_checkout_item_defined":
      return numberDetail(payload, "quantity") === 0 ||
        numberDetail(payload, "quantitySold") === 0
        ? "Cart item removed"
        : "Cart item added";
    case "sale_completed":
      return "Sale completed";
    case "register_closed":
      return "Closeout started";
    case "register_reopened":
      return "Register reopened";
    case "sale_cleared":
      return "Cart cleared";
    case "expense_recorded":
      return "Expense recorded";
  }
}

function statusPresentation(
  status: SyncEvidenceEvent["status"] | ActivityReadModelStatus,
) {
  switch (status) {
    case "terminal_reported":
      return {
        kind: status,
        label: "Reported by terminal",
        tone: "default",
      } as const;
    case "mapping_pending":
      return {
        kind: status,
        label: "Waiting for session mapping",
        tone: "warning",
      } as const;
    case "accepted":
      return {
        kind: status,
        label: "Cloud received",
        tone: "default",
      } as const;
    case "projected":
      return {
        kind: status,
        label: "Projected",
        tone: "success",
      } as const;
    case "conflicted":
      return {
        kind: status,
        label: "Needs manager review",
        tone: "warning",
      } as const;
    case "held":
      return {
        kind: status,
        label: "Waiting for earlier POS history",
        tone: "warning",
      } as const;
    case "rejected":
      return {
        kind: status,
        label: "Rejected",
        tone: "destructive",
      } as const;
    case "manager_applied":
      return {
        kind: status,
        label: "Manager review applied",
        tone: "success",
      } as const;
    case "manager_rejected":
      return {
        kind: status,
        label: "Manager review rejected",
        tone: "destructive",
      } as const;
    case "repaired":
      return {
        kind: status,
        label: "Repaired",
        tone: "success",
      } as const;
    case "activity_patch_failed":
      return {
        kind: status,
        label: "Activity update needs review",
        tone: "warning",
      } as const;
  }
}

function buildEventSummary(event: SyncEvidenceEvent) {
  const payload = event.payload;

  switch (event.eventType) {
    case "register_opened": {
      const registerNumber = stringDetail(payload, "registerNumber");
      const openingFloat =
        numberDetail(payload, "openingFloat") ??
        numberDetail(payload, "expectedCash");
      return [
        registerNumber ? `Register ${registerNumber}` : null,
        openingFloat === null ? null : "Opening float recorded",
      ]
        .filter(Boolean)
        .join(" - ");
    }
    case "pending_checkout_item_defined": {
      const name = stringDetail(payload, "name");
      const quantity = numberDetail(payload, "quantitySold");
      return [name, quantity === null ? null : countLabel(quantity, "item")]
        .filter(Boolean)
        .join(" - ");
    }
    case "sale_completed": {
      const receiptNumber = stringDetail(payload, "receiptNumber");
      const totals =
        payload.totals &&
        typeof payload.totals === "object" &&
        !Array.isArray(payload.totals)
          ? (payload.totals as Record<string, unknown>)
          : undefined;
      const total = numberDetail(totals, "total");
      const itemCount = arrayDetail(payload.items).length;
      const serviceCount = arrayDetail(payload.serviceLines).length;
      return [
        receiptNumber ? `Receipt ${receiptNumber}` : null,
        total === null ? null : "Total recorded",
        itemCount ? countLabel(itemCount, "sale line") : null,
        serviceCount ? countLabel(serviceCount, "service") : null,
      ]
        .filter(Boolean)
        .join(" - ");
    }
    case "register_closed": {
      return numberDetail(payload, "countedCash") === null
        ? "Closeout submitted"
        : "Counted cash submitted";
    }
    case "register_reopened":
      return "Closeout was reopened for follow-up";
    case "sale_cleared":
      return "Sale draft cleared on the register";
    case "expense_recorded": {
      const totals =
        payload.totals &&
        typeof payload.totals === "object" &&
        !Array.isArray(payload.totals)
          ? (payload.totals as Record<string, unknown>)
          : undefined;
      const total = numberDetail(totals, "total");
      return total === null ? "Expense saved" : "Expense total recorded";
    }
  }
}

function fallbackActivityLabel(activity: ActivityReadModelRow) {
  const normalizedEventType = activity.eventType.replaceAll("_", ".");
  switch (normalizedEventType) {
    case "register.opened":
      return "Register opened";
    case "session.started":
      return "POS session started";
    case "session.payments.updated":
      return "Payment updated";
    case "cart.cleared":
      return "Cart cleared";
    case "cart.item.added":
      return activity.metadata.quantity === 0
        ? "Cart item removed"
        : "Cart item added";
    case "pending.checkout.item.defined":
      return "Checkout item defined";
    case "cart.service.added":
      return "Service added";
    case "cart.service.removed":
      return "Service removed";
    case "transaction.completed":
      return "Sale completed";
    case "expense.completed":
      return "Expense recorded";
    case "register.closeout.started":
      return "Closeout started";
    case "register.reopened":
      return "Register reopened";
    case "cash.movement.recorded":
      return "Cash movement recorded";
  }

  switch (activity.category) {
    case "register":
      return "Register activity";
    case "session":
      return "POS session activity";
    case "cart":
      return "Cart activity";
    case "payment":
      return "Payment activity";
    case "service":
      return "Service activity";
    case "cash":
      return "Cash activity";
    case "expense":
      return "Expense activity";
    case "sale":
      return "Sale activity";
    case "closeout":
      return "Closeout activity";
    case "reopen":
      return "Register reopen activity";
    case "sync":
      return "Sync activity";
    case "review":
      return "Review activity";
  }
}

function buildActivitySummary(activity: ActivityReadModelRow) {
  const metadata = activity.metadata;
  const paymentMethod =
    typeof metadata.paymentMethods === "string"
      ? metadata.paymentMethods
      : typeof metadata.paymentMethodLabel === "string"
        ? metadata.paymentMethodLabel
        : typeof metadata.paymentMethod === "string"
          ? metadata.paymentMethod
          : null;
  const parts = [
    typeof metadata.itemLabel === "string" ? metadata.itemLabel : null,
    typeof metadata.productSku === "string"
      ? `SKU ${metadata.productSku}`
      : null,
    typeof metadata.quantity === "number" ? `Qty ${metadata.quantity}` : null,
    typeof metadata.receiptNumber === "string"
      ? `Receipt ${metadata.receiptNumber}`
      : null,
    typeof metadata.itemCount === "number"
      ? activity.category === "sale"
        ? countLabel(metadata.itemCount, "sale line")
        : countLabel(metadata.itemCount, "item")
      : null,
    typeof metadata.serviceCount === "number"
      ? countLabel(metadata.serviceCount, "service")
      : null,
    typeof metadata.paymentCount === "number"
      ? countLabel(metadata.paymentCount, "payment")
      : null,
    paymentMethod,
    typeof metadata.reasonCode === "string" ? metadata.reasonCode : null,
  ].filter(Boolean);

  return parts.join(" - ") || null;
}

function buildItemDetails(metadata: {
  itemLabel?: unknown;
  quantity?: unknown;
  unitPrice?: unknown;
}) {
  const label =
    typeof metadata.itemLabel === "string" && metadata.itemLabel.trim()
      ? metadata.itemLabel.trim()
      : null;

  if (!label) return null;

  return {
    label,
    quantity:
      typeof metadata.quantity === "number" &&
      Number.isFinite(metadata.quantity)
        ? metadata.quantity
        : null,
    unitPrice:
      typeof metadata.unitPrice === "number" &&
      Number.isFinite(metadata.unitPrice)
        ? metadata.unitPrice
        : null,
  };
}

function latestEventStatusTime(event: SyncEvidenceEvent) {
  return event.projectedAt ?? event.acceptedAt ?? event.submittedAt ?? null;
}

function latestActivityStatusTime(activity: ActivityReadModelRow) {
  return (
    activity.reviewedAt ??
    activity.projectedAt ??
    activity.acceptedAt ??
    activity.receivedAt ??
    activity.reportedAt ??
    activity.updatedAt ??
    null
  );
}

function toLink(
  mapping: SyncEvidenceMapping,
): RegisterSessionActivityRow["evidenceLinks"][number] | null {
  if (mapping.cloudTable === "posTransaction") {
    return {
      id: mapping.cloudId,
      label: "Transaction",
      type: "transaction",
    };
  }

  if (
    mapping.localIdKind === "closeout" ||
    mapping.cloudTable === "registerSession"
  ) {
    return {
      id: mapping.cloudId,
      label: "Closeout evidence",
      type: "closeout",
    };
  }

  if (mapping.cloudTable === "expenseTransaction") {
    return {
      id: mapping.cloudId,
      label: "Expense",
      type: "expense",
    };
  }

  return null;
}

function addConflictLink(
  links: RegisterSessionActivityRow["evidenceLinks"],
  conflict: SyncEvidenceConflict | null,
) {
  if (!conflict) return dedupeEvidenceLinks(links);
  return dedupeEvidenceLinks([
    ...links,
    {
      id: conflict._id,
      label:
        conflict.status === "resolved"
          ? "Manager review resolved"
          : "Manager review",
      type: "review" as const,
    },
  ]);
}

function dedupeEvidenceLinks(
  links: RegisterSessionActivityRow["evidenceLinks"],
) {
  const seen = new Set<string>();
  return links.filter((link) => {
    const key = `${link.type}:${link.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function addDirectActivityLinks(activity: ActivityReadModelRow) {
  const links: RegisterSessionActivityRow["evidenceLinks"] = [];
  if (activity.relatedTransactionId) {
    links.push({
      id: activity.relatedTransactionId,
      label: "Transaction",
      type: "transaction",
    });
  }
  if (activity.relatedCloseoutRecordId) {
    links.push({
      id: activity.relatedCloseoutRecordId,
      label: "Closeout evidence",
      type: "closeout",
    });
  }
  if (activity.relatedConflictId) {
    links.push({
      id: activity.relatedConflictId,
      label: "Manager review",
      type: "review",
    });
  }
  return links;
}

function buildActivityReadModelPage(args: {
  activities: ActivityReadModelRow[];
  checkpoints: ActivityCheckpointRow[];
  conflictsByLocalEventId: Map<string, SyncEvidenceConflict>;
  isDone: boolean;
  mappingsByLocalEventId: Map<string, SyncEvidenceMapping[]>;
  staffNamesById: Map<Id<"staffProfile">, string>;
  terminalName: string | null;
}) {
  const categoryCounts = emptyCategoryCounts();
  const attentionCounts = emptyAttentionCounts();
  let latestCloudStatusAt: number | null = null;

  const page = args.activities.map((activity) => {
    categoryCounts[activity.category] += 1;

    if (activity.status in attentionCounts) {
      attentionCounts[activity.status as AttentionStatus] += 1;
    }

    const cloudStatusAt = latestActivityStatusTime(activity);
    if (cloudStatusAt !== null) {
      latestCloudStatusAt = Math.max(latestCloudStatusAt ?? 0, cloudStatusAt);
    }

    const mappings =
      args.mappingsByLocalEventId.get(activity.localEventId) ?? [];
    const mappingLinks = mappings
      .map(toLink)
      .filter(
        (link): link is RegisterSessionActivityRow["evidenceLinks"][number] =>
          link !== null,
      );
    const conflict =
      args.conflictsByLocalEventId.get(activity.localEventId) ?? null;
    const openingFloat =
      activity.eventType === "register.opened"
        ? (activity.metadata.openingFloat ?? activity.metadata.expectedCash)
        : null;

    return {
      _id: activity._id,
      actorStaffName: activity.staffProfileId
        ? (args.staffNamesById.get(activity.staffProfileId) ?? null)
        : null,
      category: activity.category,
      evidenceLinks: addConflictLink(
        [...addDirectActivityLinks(activity), ...mappingLinks],
        conflict,
      ),
      item: buildItemDetails(activity.metadata),
      label: fallbackActivityLabel(activity),
      localEventId: activity.localEventId,
      localRegisterSessionId: activity.localRegisterSessionId,
      openingFloat: typeof openingFloat === "number" ? openingFloat : null,
      occurredAt: activity.occurredAt,
      reportedAt: activity.reportedAt,
      sequence: activity.localSequence,
      source: "activity_read_model",
      status: statusPresentation(activity.status),
      summary: buildActivitySummary(activity),
      terminalName: args.terminalName,
    } satisfies RegisterSessionActivityRow;
  });

  for (const checkpoint of args.checkpoints) {
    latestCloudStatusAt = Math.max(
      latestCloudStatusAt ?? 0,
      checkpoint.updatedAt,
    );
  }

  const reportedThroughSequence = args.checkpoints.reduce<number | null>(
    (maxSequence, checkpoint) =>
      Math.max(maxSequence ?? 0, checkpoint.reportedThroughSequence),
    null,
  );
  const lastActivityReportedAt = args.checkpoints.reduce<number | null>(
    (maxReportedAt, checkpoint) =>
      Math.max(
        maxReportedAt ?? 0,
        checkpoint.lastActivityReportedAt ?? checkpoint.lastAcceptedBatchAt,
      ),
    null,
  );
  const maxRowSequence = page.reduce<number | null>(
    (maxSequence, row) =>
      row.sequence === null
        ? maxSequence
        : Math.max(maxSequence ?? 0, row.sequence),
    null,
  );
  const coverageState: CoverageState =
    page.length === 0 && reportedThroughSequence === null
      ? "unknown_terminal_state"
      : page.length === 0
        ? "unreported"
        : reportedThroughSequence !== null &&
            maxRowSequence !== null &&
            reportedThroughSequence >= maxRowSequence
          ? "reported"
          : "partially_reported";

  return {
    continueCursor: args.isDone ? "" : buildContinueCursor(page),
    integration: {
      activityReadModelAvailable: true,
      source: "activity_read_model",
    },
    isDone: args.isDone,
    page,
    summary: {
      attentionCounts,
      categoryCounts,
      coverageState,
      latestCloudStatusAt,
      lastActivityReportedAt,
      reportedThroughSequence,
      rowCount: page.length,
    },
  } satisfies RegisterSessionActivityPage;
}

export function buildRegisterSessionActivityPage(args: {
  conflictsByLocalEventId: Map<string, SyncEvidenceConflict>;
  cursors: SyncEvidenceCursor[];
  events: SyncEvidenceEvent[];
  isDone: boolean;
  mappingsByLocalEventId: Map<string, SyncEvidenceMapping[]>;
  terminalName: string | null;
  staffNamesById: Map<Id<"staffProfile">, string>;
}) {
  const categoryCounts = emptyCategoryCounts();
  const attentionCounts = emptyAttentionCounts();
  let latestCloudStatusAt: number | null = null;

  const page = args.events.map((event) => {
    const category = eventCategory(event.eventType);
    categoryCounts[category] += 1;

    if (event.status === "held") attentionCounts.held += 1;
    if (event.status === "conflicted") attentionCounts.conflicted += 1;
    if (event.status === "rejected") attentionCounts.rejected += 1;

    const cloudStatusAt = latestEventStatusTime(event);
    if (cloudStatusAt !== null) {
      latestCloudStatusAt = Math.max(latestCloudStatusAt ?? 0, cloudStatusAt);
    }

    const mappings = args.mappingsByLocalEventId.get(event.localEventId) ?? [];
    const links = mappings
      .map(toLink)
      .filter(
        (link): link is RegisterSessionActivityRow["evidenceLinks"][number] =>
          link !== null,
      );
    const conflict =
      args.conflictsByLocalEventId.get(event.localEventId) ?? null;

    return {
      _id: event._id,
      actorStaffName: args.staffNamesById.get(event.staffProfileId) ?? null,
      category,
      evidenceLinks: addConflictLink(links, conflict),
      item: buildItemDetails({
        itemLabel:
          stringDetail(event.payload, "productName") ??
          stringDetail(event.payload, "name"),
        quantity:
          numberDetail(event.payload, "quantity") ??
          numberDetail(event.payload, "quantitySold"),
        unitPrice:
          numberDetail(event.payload, "unitPrice") ??
          numberDetail(event.payload, "price"),
      }),
      label: eventLabel(event.eventType, event.payload),
      localEventId: event.localEventId,
      localRegisterSessionId: event.localRegisterSessionId,
      openingFloat:
        event.eventType === "register_opened"
          ? (numberDetail(event.payload, "openingFloat") ??
            numberDetail(event.payload, "expectedCash"))
          : null,
      occurredAt: event.occurredAt,
      reportedAt: event.acceptedAt ?? event.submittedAt ?? null,
      sequence: event.sequence,
      source: "pos_sync_evidence",
      status: statusPresentation(event.status),
      summary: buildEventSummary(event) || null,
      terminalName: args.terminalName,
    } satisfies RegisterSessionActivityRow;
  });

  for (const conflict of args.conflictsByLocalEventId.values()) {
    if (conflict.resolvedAt) {
      latestCloudStatusAt = Math.max(
        latestCloudStatusAt ?? 0,
        conflict.resolvedAt,
      );
    }
  }

  for (const cursor of args.cursors) {
    latestCloudStatusAt = Math.max(latestCloudStatusAt ?? 0, cursor.updatedAt);
  }

  const reportedThroughSequence = args.cursors.reduce<number | null>(
    (maxSequence, cursor) =>
      Math.max(maxSequence ?? 0, cursor.acceptedThroughSequence),
    null,
  );
  const lastActivityReportedAt = args.cursors.reduce<number | null>(
    (maxUpdatedAt, cursor) => Math.max(maxUpdatedAt ?? 0, cursor.updatedAt),
    null,
  );
  const maxRowSequence = page.reduce<number | null>(
    (maxSequence, row) =>
      row.sequence === null
        ? maxSequence
        : Math.max(maxSequence ?? 0, row.sequence),
    null,
  );
  const coverageState: CoverageState =
    page.length === 0 && reportedThroughSequence === null
      ? "unknown_terminal_state"
      : page.length === 0
        ? "unreported"
        : reportedThroughSequence !== null &&
            maxRowSequence !== null &&
            reportedThroughSequence >= maxRowSequence
          ? "partially_reported"
          : "unknown_terminal_state";

  return {
    continueCursor: args.isDone ? "" : buildContinueCursor(page),
    integration: {
      activityReadModelAvailable: false,
      source: "pos_sync_evidence",
    },
    isDone: args.isDone,
    page,
    summary: {
      attentionCounts,
      categoryCounts,
      coverageState,
      latestCloudStatusAt,
      lastActivityReportedAt,
      reportedThroughSequence,
      rowCount: page.length,
    },
  } satisfies RegisterSessionActivityPage;
}

async function requireFullAdminRegisterSessionAccess(
  ctx: QueryCtx,
  args: { registerSessionId: Id<"registerSession">; storeId: Id<"store"> },
) {
  const [store, registerSession] = await Promise.all([
    ctx.db.get("store", args.storeId),
    ctx.db.get("registerSession", args.registerSessionId),
  ]);

  if (!store) {
    throw new Error("Store not found.");
  }

  const admittedActor = (ctx as Partial<OperationQueryCtx>).operationAdmission
    ?.actor;
  const athenaUser =
    admittedActor?.kind === "shared_demo"
      ? await ctx.db.get("athenaUser", admittedActor.athenaUserId)
      : await requireAuthenticatedAthenaUserWithCtx(ctx);
  if (!athenaUser) {
    throw new Error("Sign in again to continue.");
  }
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "You do not have access to POS activity.",
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  if (!registerSession || registerSession.storeId !== args.storeId) {
    throw new Error("Register session not found for this store.");
  }

  return { registerSession, store };
}

async function listLocalSessionMappings(
  ctx: QueryCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  return ctx.db
    .query("posLocalSyncMapping")
    .withIndex("by_store_terminal_cloud", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("cloudTable", "registerSession")
        .eq("cloudId", args.registerSessionId),
    )
    .take(LOCAL_SESSION_MAPPING_LIMIT);
}

async function listReadModelActivity(
  ctx: QueryCtx,
  args: {
    cursorSequence: number | null;
    pageSize: number;
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  const query = ctx.db
    .query("posRegisterSessionActivity")
    .withIndex("by_store_registerSession_sequence", (q) => {
      const scoped = q
        .eq("storeId", args.storeId)
        .eq("registerSessionId", args.registerSessionId);

      return args.cursorSequence === null
        ? scoped
        : scoped.lt("localSequence", args.cursorSequence);
    })
    .order("desc");

  return query.take(args.pageSize + 1);
}

async function listReadModelCheckpoints(
  ctx: QueryCtx,
  args: {
    registerSessionId: Id<"registerSession">;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("posRegisterSessionActivityCheckpoint")
    .withIndex("by_store_registerSession", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("registerSessionId", args.registerSessionId),
    )
    .take(20);
}

async function listEventsForLocalSessions(
  ctx: QueryCtx,
  args: {
    cursorSequence: number | null;
    localRegisterSessionIds: string[];
    pageSize: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const eventsById = new Map<Id<"posLocalSyncEvent">, SyncEvidenceEvent>();

  for (const localRegisterSessionId of args.localRegisterSessionIds) {
    const query = ctx.db
      .query("posLocalSyncEvent")
      .withIndex("by_store_terminal_register_sequence", (q) => {
        const scoped = q
          .eq("storeId", args.storeId)
          .eq("terminalId", args.terminalId)
          .eq("localRegisterSessionId", localRegisterSessionId);

        return args.cursorSequence === null
          ? scoped
          : scoped.lt("sequence", args.cursorSequence);
      })
      .order("desc");
    const events = await query.take(args.pageSize + 1);
    for (const event of events) eventsById.set(event._id, event);
  }

  return [...eventsById.values()]
    .sort(
      (left, right) =>
        right.sequence - left.sequence ||
        right.occurredAt - left.occurredAt ||
        left.localEventId.localeCompare(right.localEventId),
    )
    .slice(0, args.pageSize + 1);
}

async function listCursorsForLocalSessions(
  ctx: QueryCtx,
  args: {
    localRegisterSessionIds: string[];
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const cursors: SyncEvidenceCursor[] = [];

  for (const localRegisterSessionId of args.localRegisterSessionIds) {
    const scopedCursors = await ctx.db
      .query("posLocalSyncCursor")
      .withIndex("by_store_terminal_register", (q) =>
        q
          .eq("storeId", args.storeId)
          .eq("terminalId", args.terminalId)
          .eq("localRegisterSessionId", localRegisterSessionId),
      )
      .take(10);
    cursors.push(...scopedCursors);
  }

  return cursors;
}

async function listEventMappings(ctx: QueryCtx, events: SyncEvidenceEvent[]) {
  const entries = await Promise.all(
    events.map(async (event) => {
      const mappings = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", event.storeId)
            .eq("terminalId", event.terminalId)
            .eq("localEventId", event.localEventId),
        )
        .take(EVENT_LINK_LIMIT);
      return [event.localEventId, mappings] as const;
    }),
  );

  return new Map(entries);
}

async function listActivityMappings(
  ctx: QueryCtx,
  activities: ActivityReadModelRow[],
) {
  const entries = await Promise.all(
    activities.map(async (activity) => {
      const mappings = await ctx.db
        .query("posLocalSyncMapping")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", activity.storeId)
            .eq("terminalId", activity.terminalId)
            .eq("localEventId", activity.localEventId),
        )
        .take(EVENT_LINK_LIMIT);
      return [activity.localEventId, mappings] as const;
    }),
  );

  return new Map(entries);
}

async function listEventConflicts(ctx: QueryCtx, events: SyncEvidenceEvent[]) {
  const entries = await Promise.all(
    events.map(async (event) => {
      const conflicts = await ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", event.storeId)
            .eq("terminalId", event.terminalId)
            .eq("localEventId", event.localEventId),
        )
        .take(20);
      return [
        event.localEventId,
        conflicts.find((conflict) => conflict.status === "needs_review") ??
          conflicts[0] ??
          null,
      ] as const;
    }),
  );

  return new Map(
    entries.filter(
      (entry): entry is readonly [string, SyncEvidenceConflict] =>
        entry[1] !== null,
    ),
  );
}

async function listActivityConflicts(
  ctx: QueryCtx,
  activities: ActivityReadModelRow[],
) {
  const entries = await Promise.all(
    activities.map(async (activity) => {
      const conflicts = await ctx.db
        .query("posLocalSyncConflict")
        .withIndex("by_store_terminal_localEvent", (q) =>
          q
            .eq("storeId", activity.storeId)
            .eq("terminalId", activity.terminalId)
            .eq("localEventId", activity.localEventId),
        )
        .take(20);
      return [
        activity.localEventId,
        conflicts.find((conflict) => conflict.status === "needs_review") ??
          conflicts[0] ??
          null,
      ] as const;
    }),
  );

  return new Map(
    entries.filter(
      (entry): entry is readonly [string, SyncEvidenceConflict] =>
        entry[1] !== null,
    ),
  );
}

async function listStaffNames(ctx: QueryCtx, events: SyncEvidenceEvent[]) {
  const storeIdByStaffId = new Map(
    events.map((event) => [event.staffProfileId, event.storeId]),
  );
  const staffIds = Array.from(storeIdByStaffId.keys());
  const entries = await Promise.all(
    staffIds.map(async (staffProfileId) => {
      const staffProfile = await ctx.db.get("staffProfile", staffProfileId);
      if (staffProfile?.storeId !== storeIdByStaffId.get(staffProfileId)) {
        return null;
      }
      const staffName = formatStaffDisplayName(staffProfile);
      return staffName ? [staffProfileId, staffName] : null;
    }),
  );

  return new Map(
    entries.filter(Boolean) as Array<[Id<"staffProfile">, string]>,
  );
}

async function listActivityStaffNames(
  ctx: QueryCtx,
  activities: ActivityReadModelRow[],
) {
  const storeIdByStaffId = new Map<Id<"staffProfile">, Id<"store">>();
  for (const activity of activities) {
    if (activity.staffProfileId) {
      storeIdByStaffId.set(activity.staffProfileId, activity.storeId);
    }
  }
  const staffIds = Array.from(storeIdByStaffId.keys());
  const entries = await Promise.all(
    staffIds.map(async (staffProfileId) => {
      const staffProfile = await ctx.db.get("staffProfile", staffProfileId);
      if (staffProfile?.storeId !== storeIdByStaffId.get(staffProfileId)) {
        return null;
      }
      const staffName = formatStaffDisplayName(staffProfile);
      return staffName ? [staffProfileId, staffName] : null;
    }),
  );

  return new Map(
    entries.filter(Boolean) as Array<[Id<"staffProfile">, string]>,
  );
}

async function getTerminalName(
  ctx: QueryCtx,
  terminalId: Id<"posTerminal"> | undefined,
  storeId: Id<"store">,
) {
  if (!terminalId) return null;
  const terminal = await ctx.db.get("posTerminal", terminalId);
  if (terminal?.storeId !== storeId) return null;
  return terminal?.displayName?.trim() || null;
}

function attachRegisterSessionHeader(
  page: RegisterSessionActivityPage,
  registerSession: Doc<"registerSession">,
  terminalName: string | null,
) {
  return {
    ...page,
    registerSession: {
      _id: registerSession._id,
      registerNumber: registerSession.registerNumber ?? null,
      terminalName,
    },
  } satisfies RegisterSessionActivityPage;
}

export const listRegisterSessionActivity = query({
  args: {
    paginationOpts: paginationOptsValidator,
    registerSessionId: v.id("registerSession"),
    storeId: v.id("store"),
  },
  handler: admitSharedDemoPublicQuery(
    listRegisterSessionActivityReadDefinition,
    async (
      ctx,
      args: {
        paginationOpts: { numItems: number; cursor: string | null };
        registerSessionId: Id<"registerSession">;
        storeId: Id<"store">;
      },
    ) => {
      const { registerSession } = await requireFullAdminRegisterSessionAccess(
        ctx,
        args,
      );

      const terminalName = await getTerminalName(
        ctx,
        registerSession.terminalId,
        registerSession.storeId,
      );

      if (!registerSession.terminalId) {
        return attachRegisterSessionHeader(
          buildRegisterSessionActivityPage({
            conflictsByLocalEventId: new Map(),
            cursors: [],
            events: [],
            isDone: true,
            mappingsByLocalEventId: new Map(),
            staffNamesById: new Map(),
            terminalName: null,
          }),
          registerSession,
          null,
        );
      }

      const pageSize = clampPageSize(args.paginationOpts.numItems);
      const cursorSequence = parseSequenceCursor(args.paginationOpts.cursor);
      const [activityRowsWithExtra, activityCheckpoints] = await Promise.all([
        listReadModelActivity(ctx, {
          cursorSequence,
          pageSize,
          registerSessionId: args.registerSessionId,
          storeId: args.storeId,
        }),
        listReadModelCheckpoints(ctx, {
          registerSessionId: args.registerSessionId,
          storeId: args.storeId,
        }),
      ]);
      const activityRows = activityRowsWithExtra.slice(0, pageSize);

      if (activityRows.length > 0 || activityCheckpoints.length > 0) {
        const [
          mappingsByLocalEventId,
          conflictsByLocalEventId,
          staffNamesById,
        ] = await Promise.all([
          listActivityMappings(ctx, activityRows),
          listActivityConflicts(ctx, activityRows),
          listActivityStaffNames(ctx, activityRows),
        ]);

        return attachRegisterSessionHeader(
          buildActivityReadModelPage({
            activities: activityRows,
            checkpoints: activityCheckpoints,
            conflictsByLocalEventId,
            isDone: activityRowsWithExtra.length <= pageSize,
            mappingsByLocalEventId,
            staffNamesById,
            terminalName,
          }),
          registerSession,
          terminalName,
        );
      }

      const registerSessionMappings = await listLocalSessionMappings(ctx, {
        registerSessionId: args.registerSessionId,
        storeId: args.storeId,
        terminalId: registerSession.terminalId,
      });
      const localRegisterSessionIds = Array.from(
        new Set(
          registerSessionMappings.length
            ? registerSessionMappings.map(
                (mapping) => mapping.localRegisterSessionId,
              )
            : [args.registerSessionId],
        ),
      );

      const [eventsWithExtra, cursors] = await Promise.all([
        listEventsForLocalSessions(ctx, {
          cursorSequence,
          localRegisterSessionIds,
          pageSize,
          storeId: args.storeId,
          terminalId: registerSession.terminalId,
        }),
        listCursorsForLocalSessions(ctx, {
          localRegisterSessionIds,
          storeId: args.storeId,
          terminalId: registerSession.terminalId,
        }),
      ]);
      const events = eventsWithExtra.slice(0, pageSize);
      const [mappingsByLocalEventId, conflictsByLocalEventId, staffNamesById] =
        await Promise.all([
          listEventMappings(ctx, events),
          listEventConflicts(ctx, events),
          listStaffNames(ctx, events),
        ]);

      return attachRegisterSessionHeader(
        buildRegisterSessionActivityPage({
          conflictsByLocalEventId,
          cursors,
          events,
          isDone: eventsWithExtra.length <= pageSize,
          mappingsByLocalEventId,
          staffNamesById,
          terminalName,
        }),
        registerSession,
        terminalName,
      );
    },
  ),
});
