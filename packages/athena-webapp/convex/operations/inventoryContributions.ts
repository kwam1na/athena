import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { enqueueReportWork } from "../reports/pipelineWork";
import { UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION } from "../reports/weeklyInventory";
import {
  canonicalSyncedSaleInventoryReviewSkuId,
  operationalWorkActionableTimestamp,
  stableOperationalWorkItemSourceIdentity,
} from "./logicalOperationalWork";

export const INVENTORY_CONTRIBUTION_LIMIT = 500;
export const INVENTORY_REPAIR_LIMIT = 100;
export const INVENTORY_REPAIR_MEMBER_LIMIT = 2_000;
export const INVENTORY_IDENTITY_MAX_BYTES = 1_024;
const boundedIdentity = (value: string) =>
  new TextEncoder().encode(value).byteLength <= INVENTORY_IDENTITY_MAX_BYTES;
type Contribution = Omit<
  Doc<"operationalInventoryContribution">,
  "_id" | "_creationTime"
>;
type WorkInput = Omit<Doc<"operationalWorkItem">, "_id" | "_creationTime">;
type WorkPatch = Partial<WorkInput>;

export function normalizeInventoryContribution(
  item: Doc<"operationalWorkItem">,
): Contribution | null {
  if (
    item.type !== "synced_sale_inventory_review" ||
    !["open", "in_progress"].includes(item.status)
  )
    return null;
  const sourceIdentity = stableOperationalWorkItemSourceIdentity(item);
  const complete = boundedIdentity(sourceIdentity);
  return {
    storeId: item.storeId,
    workItemId: item._id,
    sourceIdentity: complete
      ? sourceIdentity
      : JSON.stringify(["unavailable", item._id]),
    productSkuId: canonicalSyncedSaleInventoryReviewSkuId(item),
    approvalPriority:
      Boolean(item.approvalRequestId) || item.approvalState === "pending",
    inProgress: item.status === "in_progress",
    priority:
      item.priority === "high"
        ? "high"
        : item.priority === "normal"
          ? "normal"
          : "other",
    actionableAt: operationalWorkActionableTimestamp(item),
    createdAt: item.createdAt,
    complete,
  };
}

const compareString = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
const urgency = (value: Contribution["priority"]) =>
  value === "high" ? 0 : value === "normal" ? 1 : 2;
function compareContribution(a: Contribution, b: Contribution) {
  return (
    Number(b.approvalPriority) - Number(a.approvalPriority) ||
    Number(b.inProgress) - Number(a.inProgress) ||
    Number(!a.productSkuId) - Number(!b.productSkuId) ||
    a.actionableAt - b.actionableAt ||
    compareString(a.sourceIdentity, b.sourceIdentity) ||
    compareString(String(a.workItemId), String(b.workItemId))
  );
}

/** Same alias-first representative ordering as Operations, over normalized fields. */
export function projectCompactInventoryAttention(args: {
  contributions: Contribution[];
  repairs: ReadonlyMap<string, ReadonlySet<string>>;
  completeness: "complete" | "incomplete";
  frameStartAt: number;
}) {
  const incomplete =
    args.completeness === "incomplete" ||
    args.contributions.some((item) => !item.complete);
  const sources = new Map<string, Contribution[]>();
  for (const item of args.contributions
    .filter((item) => item.complete)
    .sort(compareContribution)) {
    const aliases = sources.get(item.sourceIdentity) ?? [];
    aliases.push(item);
    sources.set(item.sourceIdentity, aliases);
  }
  const grouped = new Map<
    string,
    { representative: Contribution; members: Contribution[] }
  >();
  for (const [sourceIdentity, members] of sources) {
    const representative = members[0];
    const baseKey = representative.productSkuId
      ? `synced_sale_inventory_review:${representative.storeId}:${representative.productSkuId}`
      : sourceIdentity;
    const membership = args.repairs.get(baseKey);
    const key =
      membership && !membership.has(sourceIdentity)
        ? `${baseKey}:post_repair`
        : baseKey;
    const group = grouped.get(key) ?? { representative, members: [] };
    group.members.push(...members);
    grouped.set(key, group);
  }
  const groups = [...grouped]
    .sort(
      ([ak, a], [bk, b]) =>
        Number(b.representative.approvalPriority) -
          Number(a.representative.approvalPriority) ||
        Number(!a.representative.productSkuId) -
          Number(!b.representative.productSkuId) ||
        Math.min(...a.members.map((m) => urgency(m.priority))) -
          Math.min(...b.members.map((m) => urgency(m.priority))) ||
        Number(b.members.some((m) => m.inProgress)) -
          Number(a.members.some((m) => m.inProgress)) ||
        Math.min(...a.members.map((m) => m.actionableAt)) -
          Math.min(...b.members.map((m) => m.actionableAt)) ||
        compareString(ak, bk),
    )
    .map(([key, group]) => ({
      classification: group.members.some((m) => m.createdAt < args.frameStartAt)
        ? ("carried_forward" as const)
        : ("new_this_week" as const),
      evidenceLimited: incomplete || !group.representative.productSkuId,
      hasNewActivity: group.members.some(
        (m) => m.createdAt >= args.frameStartAt,
      ),
      key,
      memberCount: group.members.length,
      productSkuId: group.representative.productSkuId,
    }));
  return {
    carriedForwardCount: groups.filter(
      (g) => g.classification === "carried_forward",
    ).length,
    completeness: incomplete ? ("incomplete" as const) : ("complete" as const),
    groups,
    newCount: groups.filter((g) => g.classification === "new_this_week").length,
    observedCount: groups.length,
    overflow: incomplete,
  };
}

export async function setInventoryCoverageWithCtx(
  ctx: MutationCtx,
  storeId: Id<"store">,
  complete: boolean,
  now: number,
) {
  const row = await ctx.db
    .query("operationalInventoryCoverage")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  const value = { storeId, complete, updatedAt: now };
  if (row) await ctx.db.patch("operationalInventoryCoverage", row._id, value);
  else await ctx.db.insert("operationalInventoryCoverage", value);
  await enqueueReportWork(ctx, { storeId, kind: "inventory" }, now);
}

/** Source callers already own the document; no source hydration in this projection hook. */
export async function syncInventoryContributionWithCtx(
  ctx: MutationCtx,
  item: Doc<"operationalWorkItem"> | null,
  identity: { storeId: Id<"store">; workItemId: Id<"operationalWorkItem"> },
  now: number,
) {
  if (
    item &&
    (item._id !== identity.workItemId || item.storeId !== identity.storeId)
  )
    throw new Error("inventory_contribution_owner_mismatch");
  const existing = await ctx.db
    .query("operationalInventoryContribution")
    .withIndex("by_workItemId", (q) => q.eq("workItemId", identity.workItemId))
    .unique();
  if (existing && existing.storeId !== identity.storeId)
    throw new Error("inventory_contribution_owner_mismatch");
  const value = item ? normalizeInventoryContribution(item) : null;
  if (
    existing &&
    value &&
    (Object.keys(value) as Array<keyof Contribution>).every(
      (key) => existing[key] === value[key],
    )
  )
    return;
  if (!existing && !value) return;
  if (value?.productSkuId) {
    const skuId = ctx.db.normalizeId("productSku", value.productSkuId);
    const sku = skuId ? await ctx.db.get("productSku", skuId) : null;
    if (sku && sku.storeId !== identity.storeId)
      throw new Error("inventory_contribution_sku_owner_mismatch");
    if (!sku) {
      value.productSkuId = null;
      value.complete = false;
    }
  }
  if (value) {
    if (existing)
      await ctx.db.replace(
        "operationalInventoryContribution",
        existing._id,
        value,
      );
    else await ctx.db.insert("operationalInventoryContribution", value);
  } else if (existing)
    await ctx.db.delete("operationalInventoryContribution", existing._id);
  await enqueueReportWork(
    ctx,
    { storeId: identity.storeId, kind: "inventory" },
    now,
  );
}

export async function insertOperationalWorkItemWithInventoryWithCtx(
  ctx: MutationCtx,
  input: WorkInput,
) {
  const id = await ctx.db.insert("operationalWorkItem", input);
  if (input.type === "synced_sale_inventory_review")
    await syncInventoryContributionWithCtx(
      ctx,
      { ...input, _id: id, _creationTime: 0 },
      { storeId: input.storeId, workItemId: id },
      Date.now(),
    );
  return id;
}

export async function patchOperationalWorkItemWithInventoryWithCtx(
  ctx: MutationCtx,
  id: Id<"operationalWorkItem">,
  fields: WorkPatch,
  current?: Doc<"operationalWorkItem">,
) {
  const item = current ?? (await ctx.db.get("operationalWorkItem", id));
  if (!item || item._id !== id) throw new Error("inventory_work_item_missing");
  if (fields.storeId && fields.storeId !== item.storeId)
    throw new Error("inventory_contribution_owner_mismatch");
  await ctx.db.patch("operationalWorkItem", id, fields);
  if (
    item.type === "synced_sale_inventory_review" ||
    fields.type === "synced_sale_inventory_review"
  )
    await syncInventoryContributionWithCtx(
      ctx,
      { ...item, ...fields },
      { storeId: item.storeId, workItemId: id },
      Date.now(),
    );
}

export async function deleteOperationalWorkItemWithInventoryWithCtx(
  ctx: MutationCtx,
  item: Doc<"operationalWorkItem">,
) {
  if (item.type === "synced_sale_inventory_review")
    await syncInventoryContributionWithCtx(
      ctx,
      null,
      { storeId: item.storeId, workItemId: item._id },
      Date.now(),
    );
  await ctx.db.delete("operationalWorkItem", item._id);
}

/** Rebuild/restore reconciles normalized membership; routine status patches need only the header. */
export async function syncInventoryRepairWithCtx(
  ctx: MutationCtx,
  repair: Doc<"oversizedOperationalWorkRepair"> | null,
  identity: {
    storeId: Id<"store">;
    repairId: Id<"oversizedOperationalWorkRepair">;
  },
  now: number,
  options: { membershipUnchanged?: boolean } = {},
) {
  if (
    repair &&
    (repair._id !== identity.repairId || repair.storeId !== identity.storeId)
  )
    throw new Error("inventory_repair_owner_mismatch");
  const existing = await ctx.db
    .query("operationalInventoryRepair")
    .withIndex("by_repairId", (q) => q.eq("repairId", identity.repairId))
    .unique();
  if (existing && existing.storeId !== identity.storeId)
    throw new Error("inventory_repair_owner_mismatch");
  if (!repair) {
    if (existing)
      await ctx.db.delete("operationalInventoryRepair", existing._id);
  } else {
    const allSources = new Set(repair.sourceIdentities);
    const sources = new Set([...allSources].filter(boundedIdentity));
    if (sources.size > INVENTORY_REPAIR_MEMBER_LIMIT)
      throw new Error("inventory_repair_capacity_exceeded");
    if (!existing || !options.membershipUnchanged) {
      const members = await ctx.db
        .query("operationalInventoryRepairMember")
        .withIndex("by_repairId_sourceIdentity", (q) =>
          q.eq("repairId", identity.repairId),
        )
        .take(INVENTORY_REPAIR_MEMBER_LIMIT + 1);
      if (members.length > INVENTORY_REPAIR_MEMBER_LIMIT)
        throw new Error("inventory_repair_capacity_exceeded");
      const prior = new Set(members.map((m) => m.sourceIdentity));
      for (const member of members) {
        if (member.storeId !== identity.storeId)
          throw new Error("inventory_repair_owner_mismatch");
        if (!sources.has(member.sourceIdentity))
          await ctx.db.delete("operationalInventoryRepairMember", member._id);
      }
      for (const sourceIdentity of sources)
        if (!prior.has(sourceIdentity))
          await ctx.db.insert("operationalInventoryRepairMember", {
            ...identity,
            sourceIdentity,
          });
    }
    const complete =
      boundedIdentity(repair.groupKey) && allSources.size === sources.size;
    const value = {
      ...identity,
      groupKey: boundedIdentity(repair.groupKey)
        ? repair.groupKey
        : JSON.stringify(["unavailable", repair._id]),
      status: repair.status,
      sourceCreatedAt: repair._creationTime,
      memberCount: sources.size,
      complete,
    };
    if (existing)
      await ctx.db.replace("operationalInventoryRepair", existing._id, value);
    else await ctx.db.insert("operationalInventoryRepair", value);
  }
  await enqueueReportWork(
    ctx,
    { storeId: identity.storeId, kind: "inventory" },
    now,
  );
}

export async function patchInventoryRepairWithCtx(
  ctx: MutationCtx,
  repair: Doc<"oversizedOperationalWorkRepair">,
  fields: Partial<
    Omit<Doc<"oversizedOperationalWorkRepair">, "_id" | "_creationTime">
  >,
) {
  if (fields.storeId && fields.storeId !== repair.storeId)
    throw new Error("inventory_repair_owner_mismatch");
  await ctx.db.patch("oversizedOperationalWorkRepair", repair._id, fields);
  await syncInventoryRepairWithCtx(
    ctx,
    { ...repair, ...fields },
    { storeId: repair.storeId, repairId: repair._id },
    fields.updatedAt ?? Date.now(),
    { membershipUnchanged: fields.sourceIdentities === undefined },
  );
}

/** Bounded compact reads only; source coverage is required before absence means zero. */
export async function readCompactInventoryAttention(
  ctx: QueryCtx,
  storeId: Id<"store">,
  frameStartAt: number,
) {
  const coverage = await ctx.db
    .query("operationalInventoryCoverage")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .unique();
  if (!coverage?.complete) return UNAVAILABLE_WEEKLY_INVENTORY_ATTENTION;
  const items = await ctx.db
    .query("operationalInventoryContribution")
    .withIndex("by_storeId", (q) => q.eq("storeId", storeId))
    .take(INVENTORY_CONTRIBUTION_LIMIT + 1);
  const contributions = items
    .slice(0, INVENTORY_CONTRIBUTION_LIMIT)
    .filter((item) => item.complete);
  const repairs = new Map<string, Doc<"operationalInventoryRepair">>();
  let remaining = INVENTORY_REPAIR_LIMIT;
  let incomplete =
    items.length > INVENTORY_CONTRIBUTION_LIMIT ||
    items.some((item) => !item.complete);
  for (const status of ["pending", "running", "paused"] as const) {
    const rows = await ctx.db
      .query("operationalInventoryRepair")
      .withIndex("by_storeId_status_sourceCreatedAt", (q) =>
        q.eq("storeId", storeId).eq("status", status),
      )
      .take(remaining + 1);
    incomplete ||= rows.length > remaining;
    for (const row of rows.slice(0, remaining)) {
      incomplete ||= !row.complete;
      if (row.complete) repairs.set(row.groupKey, row);
    }
    remaining -= Math.min(rows.length, remaining);
  }
  const membership = new Map<string, Set<string>>(
    [...repairs.keys()].map((key) => [key, new Set()]),
  );
  const representatives = new Map<string, Contribution>();
  for (const item of [...contributions].sort(compareContribution)) {
    if (item.storeId !== storeId)
      throw new Error("inventory_contribution_owner_mismatch");
    if (!representatives.has(item.sourceIdentity))
      representatives.set(item.sourceIdentity, item);
  }
  for (const item of representatives.values()) {
    const key = item.productSkuId
      ? `synced_sale_inventory_review:${storeId}:${item.productSkuId}`
      : item.sourceIdentity;
    const repair = repairs.get(key);
    if (!repair) continue;
    if (repair.storeId !== storeId)
      throw new Error("inventory_repair_owner_mismatch");
    const member = await ctx.db
      .query("operationalInventoryRepairMember")
      .withIndex("by_repairId_sourceIdentity", (q) =>
        q
          .eq("repairId", repair.repairId)
          .eq("sourceIdentity", item.sourceIdentity),
      )
      .unique();
    if (member && member.storeId !== storeId)
      throw new Error("inventory_repair_owner_mismatch");
    if (member) membership.get(key)!.add(item.sourceIdentity);
  }
  return projectCompactInventoryAttention({
    contributions,
    repairs: membership,
    frameStartAt,
    completeness: incomplete ? "incomplete" : "complete",
  });
}
