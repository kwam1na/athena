import type { Id } from "../_generated/dataModel";
import type {
  LogicalOperationalWorkGroup,
  LogicalOperationalWorkProjection,
} from "../operations/logicalOperationalWork";

export type WeeklyInventoryCompleteness =
  "complete" | "incomplete" | "unavailable";

export type WeeklyInventoryClassification = "carried_forward" | "new_this_week";

type WeeklyInventoryAttentionGroup = {
  classification: WeeklyInventoryClassification;
  evidenceLimited: boolean;
  hasNewActivity: boolean;
  key: string;
  memberCount: number;
  productSkuId: Id<"productSku"> | null;
};

type WeeklyInventoryAttention = {
  carriedForwardCount: number;
  completeness: WeeklyInventoryCompleteness;
  groups: WeeklyInventoryAttentionGroup[];
  newCount: number;
  observedCount: number;
  overflow: boolean;
  route: {
    search: { workType: "synced_sale_inventory_review" };
    to: "/operations";
  };
};

export type FrozenWeeklyInventoryReviewGroup = {
  key: string;
  members: Array<{ createdAt: number; workItemId: string }>;
  productSkuId: Id<"productSku"> | null;
};

const OPEN_WORK_ROUTE = {
  search: { workType: "synced_sale_inventory_review" as const },
  to: "/operations" as const,
};

function classifyWeeklyInventoryGroup(args: {
  createdAts: number[];
  evidenceLimited: boolean;
  key: string;
  memberCount: number;
  productSkuId: Id<"productSku"> | null;
  frameStartAt: number;
}): WeeklyInventoryAttentionGroup {
  const classification = args.createdAts.some(
    (createdAt) => createdAt < args.frameStartAt,
  )
    ? "carried_forward"
    : "new_this_week";

  return {
    classification,
    evidenceLimited: args.evidenceLimited,
    hasNewActivity: args.createdAts.some(
      (createdAt) => createdAt >= args.frameStartAt,
    ),
    key: args.key,
    memberCount: args.memberCount,
    productSkuId: args.productSkuId,
  };
}

function summarizeWeeklyInventoryAttention(args: {
  completeness: WeeklyInventoryCompleteness;
  groups: WeeklyInventoryAttentionGroup[];
  overflow: boolean;
}): WeeklyInventoryAttention {
  return {
    carriedForwardCount: args.groups.filter(
      (group) => group.classification === "carried_forward",
    ).length,
    completeness: args.completeness,
    groups: args.groups,
    newCount: args.groups.filter(
      (group) => group.classification === "new_this_week",
    ).length,
    observedCount: args.groups.length,
    overflow: args.overflow,
    route: OPEN_WORK_ROUTE,
  };
}

function isSyncedSaleInventoryReviewGroup(group: LogicalOperationalWorkGroup) {
  return group.representative.type === "synced_sale_inventory_review";
}

/**
 * Shapes the bounded, current Open Work projection for a weekly report. It is
 * deliberately pure: callers own the bounded read and this function never
 * changes operational work or inventory.
 */
export function projectLiveWeeklyInventoryAttention(args: {
  frameStartAt: number;
  logicalWork: LogicalOperationalWorkProjection;
  overflow?: boolean;
}): WeeklyInventoryAttention {
  const groups = args.logicalWork.groups
    .filter(isSyncedSaleInventoryReviewGroup)
    .map((group) =>
      classifyWeeklyInventoryGroup({
        createdAts: group.items.map((item) => item.createdAt),
        evidenceLimited:
          group.completeness === "incomplete" || !group.productSkuId,
        frameStartAt: args.frameStartAt,
        key: group.key,
        memberCount: group.items.length,
        productSkuId: group.productSkuId,
      }),
    );

  const incomplete =
    args.logicalWork.completeness === "incomplete" || Boolean(args.overflow);

  return summarizeWeeklyInventoryAttention({
    completeness: incomplete ? "incomplete" : "complete",
    groups,
    overflow: incomplete,
  });
}

/**
 * Shapes final-close evidence after the close has frozen it. A legacy close
 * without complete logical membership is unavailable rather than rebuilt from
 * mutable Open Work, which keeps accepted weeks historically stable.
 */
export function projectFrozenWeeklyInventoryAttention(args: {
  frameStartAt: number;
  groups: FrozenWeeklyInventoryReviewGroup[];
  membershipCompleteness: "complete" | "incomplete";
}): WeeklyInventoryAttention {
  if (
    args.membershipCompleteness !== "complete" ||
    args.groups.some((group) => group.members.length === 0)
  ) {
    return summarizeWeeklyInventoryAttention({
      completeness: "unavailable",
      groups: [],
      overflow: false,
    });
  }

  return summarizeWeeklyInventoryAttention({
    completeness: "complete",
    groups: args.groups.map((group) =>
      classifyWeeklyInventoryGroup({
        createdAts: group.members.map((member) => member.createdAt),
        evidenceLimited: !group.productSkuId,
        frameStartAt: args.frameStartAt,
        key: group.key,
        memberCount: group.members.length,
        productSkuId: group.productSkuId,
      }),
    ),
    overflow: false,
  });
}
