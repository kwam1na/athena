import type { Infer } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type {
  closeEvidenceItem,
  closeEvidenceLanes,
} from "../schemas/reports/closeEvidence";
import { stableStringHash } from "./fingerprint";
import { enqueueReportWork } from "./pipelineWork";

export const CLOSE_EVIDENCE_SCHEMA_VERSION = 1;
export const CLOSE_EVIDENCE_CHUNK_ITEMS = 128;
export const CLOSE_EVIDENCE_CHUNK_BYTES = 32 * 1024;
export const CLOSE_EVIDENCE_MAX_CHUNKS = 256;
export const CLOSE_EVIDENCE_MAX_NORMALIZED_BYTES = 2 * 1024 * 1024;

type Item = Infer<typeof closeEvidenceItem>;
type Lanes = Infer<typeof closeEvidenceLanes>;
type Header = Doc<"reportCloseEvidence">;
type BlockedReason = NonNullable<Header["blockedReason"]>;
type ReadCtx = Pick<QueryCtx, "db">;
const UNHYDRATED_SIGNATURE = "unhydrated_lifecycle";

const unavailableLanes = (): Lanes => ({
  cash: "unavailable",
  transactions: "unavailable",
  payments: "unavailable",
  expenses: "unavailable",
  inventory: "unavailable",
});
const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
const nonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0;
const bytes = (value: unknown) =>
  new TextEncoder().encode(JSON.stringify(value)).byteLength;

function nextGeneration(current = 0): number {
  if (
    !Number.isSafeInteger(current) ||
    current < 0 ||
    current >= Number.MAX_SAFE_INTEGER
  )
    throw new Error("close_evidence_generation_exhausted");
  return current + 1;
}

function safeSum(values: readonly number[]): number | null {
  let total = 0;
  for (const value of values) {
    if (!Number.isSafeInteger(value) || !Number.isSafeInteger(total + value))
      return null;
    total += value;
  }
  return total;
}

/** Same eligibility in source-backed and compact selectors; absent legacy lifecycle is active. */
export function isActiveAcceptedClose(close: {
  status: string;
  lifecycleStatus?: string;
}): boolean {
  return (
    close.status === "completed" &&
    close.lifecycleStatus !== "reopened" &&
    close.lifecycleStatus !== "superseded"
  );
}

function lifecycle(source: Doc<"dailyClose">) {
  const summary = object(source.summary);
  const sales = summary?.adjustedSalesTotal ?? summary?.salesTotal;
  return {
    storeId: source.storeId,
    closeId: source._id,
    operatingDate: source.operatingDate,
    closeVersion: source.reportingCloseVersion ?? 1,
    status: source.status,
    lifecycleStatus: source.lifecycleStatus,
    completedAt: source.completedAt,
    reopenedAt: source.reopenedAt,
    supersedesCloseId: source.supersedesDailyCloseId,
    supersededByCloseId: source.supersededByDailyCloseId,
    closeNetSalesMinor: Number.isSafeInteger(sales)
      ? (sales as number)
      : undefined,
    closeTransactionCount: nonnegativeInteger(summary?.transactionCount)
      ? summary.transactionCount
      : undefined,
  };
}

function scalarSignature(fields: ReturnType<typeof lifecycle>): string {
  return JSON.stringify([
    CLOSE_EVIDENCE_SCHEMA_VERSION,
    fields.storeId,
    fields.closeId,
    fields.operatingDate,
    fields.closeVersion,
    fields.status,
    fields.lifecycleStatus,
    fields.completedAt,
    fields.reopenedAt,
    fields.supersedesCloseId,
    fields.supersededByCloseId,
    fields.closeNetSalesMinor,
    fields.closeTransactionCount,
  ]);
}

export function lifecycleSignature(source: Doc<"dailyClose">): string {
  // updatedAt also changes for non-financial carry-forward administration.
  // Frozen snapshot contents change only at a source lifecycle transition.
  return scalarSignature(lifecycle(source));
}

function itemsDigest(items: readonly Item[]) {
  return stableStringHash(
    JSON.stringify(
      items.map((item) => {
        switch (item.kind) {
          case "payment":
            return [item.kind, item.method, item.amount, item.transactionCount];
          case "expense":
            return [
              item.kind,
              item.productSkuId,
              item.productName,
              item.productSku,
              item.quantity,
              item.spend,
            ];
          case "inventory":
            return [
              item.kind,
              item.key,
              item.productSkuId,
              item.memberCount,
              item.firstCreatedAt,
              item.lastCreatedAt,
            ];
        }
      }),
    ),
  );
}

/**
 * Mandatory source-transaction handoff. No child writes or source hydration.
 * An exhausted handoff throws: source state and its invalidation must commit
 * together. Materialization errors occur later, in an independent transaction.
 */
export async function publishCloseLifecycleWithCtx(
  ctx: MutationCtx,
  source: Doc<"dailyClose">,
  now: number,
  options?: { forceRepair?: boolean },
): Promise<Header> {
  const existing = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_closeId", (q) => q.eq("closeId", source._id))
    .unique();
  if (existing && existing.storeId !== source.storeId)
    throw new Error("Close evidence ownership mismatch");
  const sourceSignature = lifecycleSignature(source);
  if (existing?.sourceSignature === sourceSignature && !options?.forceRepair) {
    if (existing.publishedGeneration !== existing.expectedGeneration) {
      await enqueueReportWork(
        ctx,
        {
          storeId: source.storeId,
          kind: "close-evidence",
          closeId: source._id,
        },
        now,
      );
    }
    return existing;
  }
  const fields = {
    ...lifecycle(source),
    sourceUpdatedAt: source.updatedAt,
    sourceSignature,
    schemaVersion: CLOSE_EVIDENCE_SCHEMA_VERSION,
    expectedGeneration: nextGeneration(existing?.expectedGeneration),
    publishedGeneration: undefined,
    publishedAt: undefined,
    lanes: unavailableLanes(),
    cashVarianceMinor: undefined,
    transactionCount: undefined,
    expenseTotal: undefined,
    chunkCount: undefined,
    itemCount: undefined,
    digest: undefined,
    blockedReason: undefined,
  };
  const headerId =
    existing?._id ?? (await ctx.db.insert("reportCloseEvidence", fields));
  if (existing) await ctx.db.patch("reportCloseEvidence", headerId, fields);
  await enqueueReportWork(
    ctx,
    { storeId: source.storeId, kind: "close-evidence", closeId: source._id },
    now,
  );
  return {
    ...fields,
    _id: headerId,
    _creationTime: existing?._creationTime ?? now,
  };
}

/** Supersession already knows predecessor identity, never needs its full snapshot. */
export async function supersedeCloseEvidenceWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    closeId: Id<"dailyClose">;
    operatingDate: string;
    supersededByCloseId: Id<"dailyClose">;
  },
  now: number,
): Promise<Header> {
  const existing = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_closeId", (q) => q.eq("closeId", args.closeId))
    .unique();
  if (
    existing &&
    (existing.storeId !== args.storeId ||
      existing.operatingDate !== args.operatingDate)
  )
    throw new Error("Close evidence ownership mismatch");
  const scalars = {
    ...args,
    status: "completed" as const,
    lifecycleStatus: "superseded" as const,
    completedAt: existing?.completedAt,
    reopenedAt: existing?.reopenedAt,
    supersedesCloseId: existing?.supersedesCloseId,
    closeVersion: existing?.closeVersion,
    closeNetSalesMinor: existing?.closeNetSalesMinor,
    closeTransactionCount: existing?.closeTransactionCount,
  };
  const sourceSignature =
    existing?.closeVersion === undefined
      ? UNHYDRATED_SIGNATURE
      : scalarSignature({ ...scalars, closeVersion: existing.closeVersion });
  if (
    existing?.sourceSignature === sourceSignature &&
    existing.lifecycleStatus === "superseded" &&
    existing.supersededByCloseId === args.supersededByCloseId
  )
    return existing;
  const fields = {
    ...scalars,
    sourceUpdatedAt: now,
    sourceSignature,
    schemaVersion: CLOSE_EVIDENCE_SCHEMA_VERSION,
    expectedGeneration: nextGeneration(existing?.expectedGeneration),
    publishedGeneration: undefined,
    publishedAt: undefined,
    lanes: unavailableLanes(),
    cashVarianceMinor: undefined,
    transactionCount: undefined,
    expenseTotal: undefined,
    chunkCount: undefined,
    itemCount: undefined,
    digest: undefined,
    blockedReason: undefined,
  };
  const headerId =
    existing?._id ?? (await ctx.db.insert("reportCloseEvidence", fields));
  if (existing) await ctx.db.patch("reportCloseEvidence", headerId, fields);
  await enqueueReportWork(
    ctx,
    { storeId: args.storeId, kind: "close-evidence", closeId: args.closeId },
    now,
  );
  return {
    ...fields,
    _id: headerId,
    _creationTime: existing?._creationTime ?? now,
  };
}

export function normalizeCloseEvidence(source: { reportSnapshot?: unknown }) {
  const snapshot = object(source.reportSnapshot);
  const summary = object(snapshot?.summary);
  const lanes = unavailableLanes();
  const items: Item[] = [];
  const cashVarianceMinor = Number.isSafeInteger(summary?.netCashVariance)
    ? (summary?.netCashVariance as number)
    : undefined;
  const transactionCount = nonnegativeInteger(summary?.transactionCount)
    ? summary.transactionCount
    : undefined;
  if (cashVarianceMinor !== undefined) lanes.cash = "complete";
  if (transactionCount !== undefined) lanes.transactions = "complete";

  if (Array.isArray(summary?.paymentTotals)) {
    const payments: Extract<Item, { kind: "payment" }>[] = [];
    const seen = new Set<string>();
    let valid = true;
    for (const raw of summary.paymentTotals) {
      const row = object(raw);
      const method = typeof row?.method === "string" ? row.method.trim() : "";
      if (
        !method ||
        seen.has(method.toLowerCase()) ||
        !nonnegativeInteger(row?.amount) ||
        !nonnegativeInteger(row?.transactionCount)
      ) {
        valid = false;
        break;
      }
      seen.add(method.toLowerCase());
      payments.push({
        kind: "payment",
        method,
        amount: row.amount,
        transactionCount: row.transactionCount,
      });
    }
    valid &&=
      safeSum(payments.map((row) => row.amount)) !== null &&
      safeSum(payments.map((row) => row.transactionCount)) !== null;
    lanes.payments = valid ? "complete" : "invalid";
    if (valid) items.push(...payments);
  }

  let expenseTotal: number | undefined;
  const expense = object(snapshot?.expenseProductEvidence);
  if (
    expense?.contractVersion === 1 &&
    expense.status === "complete" &&
    nonnegativeInteger(expense.expenseTotal) &&
    nonnegativeInteger(expense.sourceItemCount) &&
    nonnegativeInteger(expense.sourceTransactionCount) &&
    Array.isArray(expense.products)
  ) {
    const products: Extract<Item, { kind: "expense" }>[] = [];
    const seen = new Set<string>();
    let valid = true;
    for (const raw of expense.products) {
      const row = object(raw);
      const productSkuId =
        typeof row?.productSkuId === "string" ? row.productSkuId.trim() : "";
      if (
        !productSkuId ||
        seen.has(productSkuId) ||
        typeof row?.productName !== "string" ||
        !row.productName.trim() ||
        typeof row.productSku !== "string" ||
        !nonnegativeInteger(row.quantity) ||
        !nonnegativeInteger(row.spend)
      ) {
        valid = false;
        break;
      }
      seen.add(productSkuId);
      products.push({
        kind: "expense",
        productSkuId: productSkuId as Id<"productSku">,
        productName: row.productName,
        productSku: row.productSku,
        quantity: row.quantity,
        spend: row.spend,
      });
    }
    valid &&=
      safeSum(products.map((row) => row.spend)) === expense.expenseTotal;
    if (valid) {
      expenseTotal = expense.expenseTotal;
      lanes.expenses = "complete";
      items.push(...products);
    }
  }

  const groups = snapshot?.frozenSyncedSaleInventoryReviewGroups;
  if (
    object(snapshot?.openWorkMembership)?.completeness === "complete" &&
    Array.isArray(groups)
  ) {
    const inventory: Extract<Item, { kind: "inventory" }>[] = [];
    let valid = true;
    for (const raw of groups) {
      const group = object(raw);
      if (
        !group ||
        group.membershipCompleteness !== "complete" ||
        typeof group.key !== "string" ||
        !group.key ||
        !Array.isArray(group.members) ||
        group.members.length === 0 ||
        (group.productSkuId !== null && typeof group.productSkuId !== "string")
      ) {
        valid = false;
        break;
      }
      let firstCreatedAt = Infinity;
      let lastCreatedAt = -Infinity;
      for (const rawMember of group.members) {
        const createdAt = object(rawMember)?.createdAt;
        if (typeof createdAt !== "number" || !Number.isFinite(createdAt)) {
          valid = false;
          break;
        }
        firstCreatedAt = Math.min(firstCreatedAt, createdAt);
        lastCreatedAt = Math.max(lastCreatedAt, createdAt);
      }
      if (!valid) break;
      inventory.push({
        kind: "inventory",
        key: group.key,
        productSkuId: group.productSkuId as Id<"productSku"> | null,
        memberCount: group.members.length,
        firstCreatedAt,
        lastCreatedAt,
      });
    }
    if (valid) {
      lanes.inventory = "complete";
      items.push(...inventory);
    }
  }

  const chunks: Item[][] = [];
  let chunk: Item[] = [];
  let chunkBytes = 2;
  let oversizedItem = false;
  for (const item of items) {
    const itemBytes = bytes(item) + 1;
    if (itemBytes + 2 > CLOSE_EVIDENCE_CHUNK_BYTES) oversizedItem = true;
    if (
      chunk.length &&
      (chunk.length >= CLOSE_EVIDENCE_CHUNK_ITEMS ||
        chunkBytes + itemBytes > CLOSE_EVIDENCE_CHUNK_BYTES)
    ) {
      chunks.push(chunk);
      chunk = [];
      chunkBytes = 2;
    }
    chunk.push(item);
    chunkBytes += itemBytes;
  }
  if (chunk.length) chunks.push(chunk);
  const byteLength = bytes(items);
  return {
    lanes,
    cashVarianceMinor,
    transactionCount,
    expenseTotal,
    items,
    chunks,
    byteLength,
    digest: itemsDigest(items),
    capacityExceeded:
      oversizedItem ||
      byteLength > CLOSE_EVIDENCE_MAX_NORMALIZED_BYTES ||
      chunks.length > CLOSE_EVIDENCE_MAX_CHUNKS,
  };
}

export type CloseMaterializationResult =
  | { status: "published" | "already-published" | "stale" }
  | { status: "blocked"; reason: BlockedReason };

/** One frozen-source read, bounded child publication, all-or-nothing commit. */
export async function materializeCloseEvidenceWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    closeId: Id<"dailyClose">;
    expectedGeneration: number;
  },
): Promise<CloseMaterializationResult> {
  const header = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_closeId", (q) => q.eq("closeId", args.closeId))
    .unique();
  if (!header) return { status: "blocked", reason: "source_missing" };
  if (header.storeId !== args.storeId)
    return { status: "blocked", reason: "ownership_mismatch" };
  if (header.expectedGeneration !== args.expectedGeneration)
    return { status: "stale" };
  if (header.publishedGeneration === args.expectedGeneration)
    return { status: "already-published" };
  const block = async (
    reason: BlockedReason,
  ): Promise<CloseMaterializationResult> => {
    await ctx.db.patch("reportCloseEvidence", header._id, {
      blockedReason: reason,
    });
    return { status: "blocked", reason };
  };
  const source = await ctx.db.get("dailyClose", args.closeId);
  if (!source) return block("source_missing");
  if (source.storeId !== args.storeId) return block("ownership_mismatch");
  if (header.sourceSignature === UNHYDRATED_SIGNATURE) {
    if (
      source.operatingDate !== header.operatingDate ||
      source.status !== header.status ||
      source.lifecycleStatus !== header.lifecycleStatus ||
      source.supersededByDailyCloseId !== header.supersededByCloseId
    )
      return block("source_changed");
  } else if (lifecycleSignature(source) !== header.sourceSignature)
    return block("source_changed");
  const sourceMetadata = object(object(source.reportSnapshot)?.closeMetadata);
  if (
    sourceMetadata &&
    (sourceMetadata.storeId !== args.storeId ||
      sourceMetadata.organizationId !== source.organizationId)
  )
    return block("ownership_mismatch");
  const normalized = normalizeCloseEvidence(source);
  if (normalized.capacityExceeded) return block("capacity_exceeded");
  // An unpublished generation must contain no partial leftovers: production
  // writes below are in this same transaction and never catch a write error.
  const existing = await ctx.db
    .query("reportCloseEvidenceChunk")
    .withIndex("by_headerId_generation_ordinal", (q) =>
      q.eq("headerId", header._id).eq("generation", args.expectedGeneration),
    )
    .take(1);
  if (existing.length) return block("chunk_integrity");
  for (const [ordinal, items] of normalized.chunks.entries()) {
    await ctx.db.insert("reportCloseEvidenceChunk", {
      storeId: args.storeId,
      headerId: header._id,
      generation: args.expectedGeneration,
      ordinal,
      items,
    });
  }
  await ctx.db.patch("reportCloseEvidence", header._id, {
    ...lifecycle(source),
    sourceSignature: lifecycleSignature(source),
    publishedGeneration: args.expectedGeneration,
    publishedAt: Date.now(),
    lanes: normalized.lanes,
    cashVarianceMinor: normalized.cashVarianceMinor,
    transactionCount: normalized.transactionCount,
    expenseTotal: normalized.expenseTotal,
    chunkCount: normalized.chunks.length,
    itemCount: normalized.items.length,
    digest: normalized.digest,
    blockedReason: undefined,
  });
  return { status: "published" };
}

export type CloseEvidenceRead =
  | { status: "ready"; header: Header; items: Item[] }
  | { status: "missing" | "pending" }
  | { status: "blocked"; reason: BlockedReason };

/** Read-only: callers own any durable repair handoff. No full-source fallback. */
export async function readCloseEvidenceWithCtx(
  ctx: ReadCtx,
  storeId: Id<"store">,
  closeId: Id<"dailyClose">,
): Promise<CloseEvidenceRead> {
  const header = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_closeId", (q) => q.eq("closeId", closeId))
    .unique();
  if (!header) return { status: "missing" };
  if (header.storeId !== storeId)
    return { status: "blocked", reason: "ownership_mismatch" };
  if (header.blockedReason)
    return { status: "blocked", reason: header.blockedReason };
  if (
    header.schemaVersion !== CLOSE_EVIDENCE_SCHEMA_VERSION ||
    header.publishedGeneration !== header.expectedGeneration
  )
    return { status: "pending" };
  if (
    header.chunkCount === undefined ||
    header.chunkCount > CLOSE_EVIDENCE_MAX_CHUNKS ||
    header.itemCount === undefined ||
    !header.digest
  )
    return { status: "blocked", reason: "chunk_integrity" };
  const chunks = await ctx.db
    .query("reportCloseEvidenceChunk")
    .withIndex("by_headerId_generation_ordinal", (q) =>
      q.eq("headerId", header._id).eq("generation", header.expectedGeneration),
    )
    .take(CLOSE_EVIDENCE_MAX_CHUNKS + 1);
  if (
    chunks.some(
      (row) =>
        row.storeId !== storeId ||
        row.headerId !== header._id ||
        row.generation !== header.expectedGeneration,
    )
  )
    return { status: "blocked", reason: "ownership_mismatch" };
  if (
    chunks.length !== header.chunkCount ||
    chunks.some(
      (row, ordinal) =>
        row.ordinal !== ordinal ||
        row.items.length > CLOSE_EVIDENCE_CHUNK_ITEMS ||
        bytes(row.items) > CLOSE_EVIDENCE_CHUNK_BYTES,
    )
  )
    return { status: "blocked", reason: "chunk_integrity" };
  const items = chunks.flatMap((row) => row.items);
  if (
    items.length !== header.itemCount ||
    bytes(items) > CLOSE_EVIDENCE_MAX_NORMALIZED_BYTES ||
    itemsDigest(items) !== header.digest
  )
    return { status: "blocked", reason: "chunk_integrity" };
  return { status: "ready", header, items };
}

export class CloseEvidenceReadError extends Error {
  constructor(
    public readonly code:
      | "close_evidence_pending"
      | "close_evidence_capacity"
      | "close_evidence_invalid",
  ) {
    super(code);
    this.name = "CloseEvidenceReadError";
  }
}

/** Scalar-only admission for the day fold. Child evidence is weekly-owned. */
export async function loadAcceptedCompactCloseWithCtx(
  ctx: ReadCtx,
  storeId: Id<"store">,
  operatingDate: string,
) {
  const headers = await ctx.db
    .query("reportCloseEvidence")
    .withIndex("by_storeId_operatingDate", (q) =>
      q.eq("storeId", storeId).eq("operatingDate", operatingDate),
    )
    .take(9);
  if (headers.length > 8)
    throw new CloseEvidenceReadError("close_evidence_capacity");
  const accepted = headers
    .filter(isActiveAcceptedClose)
    .sort(
      (left, right) =>
        (right.completedAt ?? right.sourceUpdatedAt) -
        (left.completedAt ?? left.sourceUpdatedAt),
    )[0];
  if (!accepted) return null;
  if (accepted.blockedReason)
    throw new CloseEvidenceReadError(
      accepted.blockedReason === "capacity_exceeded"
        ? "close_evidence_capacity"
        : "close_evidence_invalid",
    );
  if (
    accepted.schemaVersion !== CLOSE_EVIDENCE_SCHEMA_VERSION ||
    accepted.publishedGeneration !== accepted.expectedGeneration
  )
    throw new CloseEvidenceReadError("close_evidence_pending");
  if (accepted.closeNetSalesMinor === undefined)
    throw new CloseEvidenceReadError("close_evidence_invalid");
  return {
    _id: accepted.closeId,
    status: accepted.status,
    lifecycleStatus: accepted.lifecycleStatus,
    completedAt: accepted.completedAt,
    updatedAt: accepted.sourceUpdatedAt,
    summary: {
      adjustedSalesTotal: accepted.closeNetSalesMinor,
      transactionCount: accepted.closeTransactionCount,
    },
  };
}

/** Old generations are unreachable after invalidation; delete children first. */
export async function cleanupCloseEvidenceGenerationsWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  headerId: Id<"reportCloseEvidence">,
) {
  const header = await ctx.db.get("reportCloseEvidence", headerId);
  if (!header || header.storeId !== storeId)
    return { deleted: 0, hasMore: false };
  const rows = await ctx.db
    .query("reportCloseEvidenceChunk")
    .withIndex("by_headerId_generation_ordinal", (q) =>
      q.eq("headerId", headerId).lt("generation", header.expectedGeneration),
    )
    .take(101);
  if (rows.some((row) => row.storeId !== storeId)) {
    await ctx.db.patch("reportCloseEvidence", headerId, { cleanupBlocked: true });
    return { deleted: 0, hasMore: false, blocked: true };
  }
  if (header.cleanupBlocked)
    await ctx.db.patch("reportCloseEvidence", headerId, { cleanupBlocked: undefined });
  for (const row of rows.slice(0, 100))
    await ctx.db.delete("reportCloseEvidenceChunk", row._id);
  return { deleted: Math.min(rows.length, 100), hasMore: rows.length > 100 };
}

/** Reuses the existing pure weekly aggregator without recreating snapshot detail. */
export function closeEvidenceAsSnapshot(
  value: Extract<CloseEvidenceRead, { status: "ready" }>,
) {
  const { header, items } = value;
  return {
    _id: header.closeId,
    operatingDate: header.operatingDate,
    status: header.status,
    lifecycleStatus: header.lifecycleStatus,
    reportSnapshot: {
      summary: {
        netCashVariance:
          header.lanes.cash === "complete"
            ? header.cashVarianceMinor
            : undefined,
        transactionCount:
          header.lanes.transactions === "complete"
            ? header.transactionCount
            : undefined,
        // Malformed tender evidence poisons the lane in the existing contract;
        // missing evidence merely contributes no covered day. Preserve both.
        paymentTotals:
          header.lanes.payments === "complete"
            ? items
                .filter((item) => item.kind === "payment")
                .map(({ kind: _kind, ...row }) => row)
            : header.lanes.payments === "invalid"
              ? [null]
              : undefined,
      },
      expenseProductEvidence:
        header.lanes.expenses === "complete"
          ? {
              contractVersion: 1,
              status: "complete",
              expenseTotal: header.expenseTotal,
              sourceItemCount: 0,
              sourceTransactionCount: 0,
              products: items
                .filter((item) => item.kind === "expense")
                .map(({ kind: _kind, ...row }) => ({
                  ...row,
                  productSkuId: row.productSkuId as Id<"productSku">,
                })),
            }
          : undefined,
    },
  };
}

/** Same group semantics as projectFrozenWeeklyInventoryAttention, without member IDs. */
export function compactFrozenInventoryAttention(
  value: Extract<CloseEvidenceRead, { status: "ready" }>,
  frameStartAt: number,
) {
  if (value.header.lanes.inventory !== "complete")
    return {
      carriedForwardCount: 0,
      completeness: "unavailable" as const,
      groups: [],
      newCount: 0,
      observedCount: 0,
      overflow: false,
    };
  const groups = value.items
    .filter((item) => item.kind === "inventory")
    .map((item) => ({
      key: item.key,
      productSkuId: item.productSkuId as Id<"productSku"> | null,
      memberCount: item.memberCount,
      classification:
        item.firstCreatedAt < frameStartAt
          ? ("carried_forward" as const)
          : ("new_this_week" as const),
      hasNewActivity: item.lastCreatedAt >= frameStartAt,
      evidenceLimited: !item.productSkuId,
    }));
  return {
    carriedForwardCount: groups.filter(
      (group) => group.classification === "carried_forward",
    ).length,
    completeness: "complete" as const,
    groups,
    newCount: groups.filter((group) => group.classification === "new_this_week")
      .length,
    observedCount: groups.length,
    overflow: false,
  };
}
