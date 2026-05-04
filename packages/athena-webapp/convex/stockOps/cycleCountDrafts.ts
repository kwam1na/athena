import { mutation, query, type MutationCtx, type QueryCtx } from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import { recordOperationalEventWithCtx } from "../operations/operationalEvents";
import { CYCLE_COUNT_REASON_CODE, submitStockAdjustmentBatchWithCtx } from "./adjustments";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";

type CycleCountDraftAccessCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

type CycleCountDraftWithLines = {
  draft: Doc<"cycleCountDraft">;
  lines: Doc<"cycleCountDraftLine">[];
};

type ActiveCycleCountDraftSummary = {
  changedLineCount: number;
  draftCount: number;
  largestAbsoluteDelta: number;
  lastSavedAt?: number;
  netQuantityDelta: number;
  scopeKeys: string[];
  scopeCount: number;
  staleLineCount: number;
};

type StaleCycleCountDraftLine = {
  productSkuId: Id<"productSku">;
  sku?: string | null;
  productName?: string | null;
  baselineInventoryCount: number;
  currentInventoryCount: number;
  baselineAvailableCount: number;
  currentAvailableCount: number;
};

async function requireCycleCountDraftAccess(
  ctx: CycleCountDraftAccessCtx,
  storeId: Id<"store">,
) {
  const store = await ctx.db.get("store", storeId);

  if (!store) {
    throw new Error("Store not found.");
  }

  const actorUser = await requireAuthenticatedAthenaUserWithCtx(ctx);

  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: "You do not have permission to adjust stock for this store.",
    organizationId: store.organizationId,
    userId: actorUser._id,
  });

  return { actorUser, store };
}

function trimRequiredScopeKey(scopeKey: string) {
  const nextScopeKey = scopeKey.trim();

  if (!nextScopeKey) {
    throw new Error("Select a count scope before saving a draft.");
  }

  return nextScopeKey;
}

function buildCycleCountDraftSubmissionKey(args: {
  ownerUserId: Id<"athenaUser">;
  scopeKey: string;
  storeId: Id<"store">;
  now: number;
}) {
  return [
    "cycle-count-draft",
    String(args.storeId),
    args.scopeKey,
    String(args.ownerUserId),
    args.now.toString(36),
  ].join(":");
}

function buildActiveCycleCountDraftsSubmissionKey(args: {
  draftIds: Id<"cycleCountDraft">[];
  ownerUserId: Id<"athenaUser">;
  storeId: Id<"store">;
}) {
  return [
    "cycle-count-drafts",
    String(args.storeId),
    String(args.ownerUserId),
    ...args.draftIds.map(String).sort(),
  ].join(":");
}

async function findOpenCycleCountDraftWithCtx(
  ctx: CycleCountDraftAccessCtx,
  args: {
    ownerUserId: Id<"athenaUser">;
    scopeKey: string;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("cycleCountDraft")
    .withIndex("by_storeId_status_scope_owner", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "open")
        .eq("scopeKey", args.scopeKey)
        .eq("ownerUserId", args.ownerUserId),
    )
    .first();
}

async function listOpenCycleCountDraftsWithCtx(
  ctx: CycleCountDraftAccessCtx,
  args: {
    ownerUserId: Id<"athenaUser">;
    storeId: Id<"store">;
  },
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- Operators need a small store-wide summary of their open count drafts across scopes.
  return ctx.db
    .query("cycleCountDraft")
    .withIndex("by_storeId_status_scope_owner", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("status", "open"),
    )
    .collect()
    .then((drafts) =>
      drafts.filter((draft) => draft.ownerUserId === args.ownerUserId),
    );
}

async function listCycleCountDraftLinesWithCtx(
  ctx: CycleCountDraftAccessCtx,
  draftId: Id<"cycleCountDraft">,
) {
  // eslint-disable-next-line @convex-dev/no-collect-in-query -- A draft workspace needs all edited lines for the selected scope.
  return ctx.db
    .query("cycleCountDraftLine")
    .withIndex("by_draftId", (q) => q.eq("draftId", draftId))
    .collect();
}

async function getCycleCountDraftLineWithCtx(
  ctx: CycleCountDraftAccessCtx,
  args: {
    draftId: Id<"cycleCountDraft">;
    productSkuId: Id<"productSku">;
  },
) {
  return ctx.db
    .query("cycleCountDraftLine")
    .withIndex("by_draftId_productSkuId", (q) =>
      q.eq("draftId", args.draftId).eq("productSkuId", args.productSkuId),
    )
    .first();
}

async function refreshCycleCountDraftSummaryWithCtx(
  ctx: MutationCtx,
  draftId: Id<"cycleCountDraft">,
  now = Date.now(),
) {
  const lines = await listCycleCountDraftLinesWithCtx(ctx, draftId);
  const changedLineCount = lines.filter((line) => line.isDirty).length;
  const staleLineCount = lines.filter(
    (line) => line.isDirty && line.staleStatus === "stale",
  ).length;

  await ctx.db.patch("cycleCountDraft", draftId, {
    changedLineCount,
    staleLineCount,
    updatedAt: now,
  });

  return { changedLineCount, staleLineCount };
}

async function createCycleCountDraftWithCtx(
  ctx: MutationCtx,
  args: {
    actorUser: Doc<"athenaUser">;
    scopeKey: string;
    store: Doc<"store">;
    storeId: Id<"store">;
  },
) {
  const now = Date.now();
  const draftId = await ctx.db.insert("cycleCountDraft", {
    changedLineCount: 0,
    createdAt: now,
    organizationId: args.store.organizationId,
    ownerUserId: args.actorUser._id,
    scopeKey: args.scopeKey,
    staleLineCount: 0,
    status: "open",
    storeId: args.storeId,
    submissionKey: buildCycleCountDraftSubmissionKey({
      now,
      ownerUserId: args.actorUser._id,
      scopeKey: args.scopeKey,
      storeId: args.storeId,
    }),
    updatedAt: now,
  });

  await recordOperationalEventWithCtx(ctx, {
    actorUserId: args.actorUser._id,
    eventType: "cycle_count_draft_created",
    message: "Cycle count draft started.",
    metadata: {
      scopeKey: args.scopeKey,
    },
    organizationId: args.store.organizationId,
    storeId: args.storeId,
    subjectId: String(draftId),
    subjectLabel: "Cycle count draft",
    subjectType: "cycle_count_draft",
  });

  return ctx.db.get("cycleCountDraft", draftId);
}

async function ensureCycleCountDraftWithCtx(
  ctx: MutationCtx,
  args: {
    scopeKey: string;
    storeId: Id<"store">;
  },
) {
  const scopeKey = trimRequiredScopeKey(args.scopeKey);
  const { actorUser, store } = await requireCycleCountDraftAccess(
    ctx,
    args.storeId,
  );
  const existingDraft = await findOpenCycleCountDraftWithCtx(ctx, {
    ownerUserId: actorUser._id,
    scopeKey,
    storeId: args.storeId,
  });

  return (
    existingDraft ??
    (await createCycleCountDraftWithCtx(ctx, {
      actorUser,
      scopeKey,
      store,
      storeId: args.storeId,
    }))
  );
}

export async function getActiveCycleCountDraftWithCtx(
  ctx: QueryCtx,
  args: {
    scopeKey: string;
    storeId: Id<"store">;
  },
): Promise<CycleCountDraftWithLines | null> {
  const scopeKey = trimRequiredScopeKey(args.scopeKey);
  const { actorUser } = await requireCycleCountDraftAccess(ctx, args.storeId);
  const draft = await findOpenCycleCountDraftWithCtx(ctx, {
    ownerUserId: actorUser._id,
    scopeKey,
    storeId: args.storeId,
  });

  if (!draft) {
    return null;
  }

  return {
    draft,
    lines: await listCycleCountDraftLinesWithCtx(ctx, draft._id),
  };
}

export async function getActiveCycleCountDraftSummaryWithCtx(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
  },
): Promise<ActiveCycleCountDraftSummary> {
  const { actorUser } = await requireCycleCountDraftAccess(ctx, args.storeId);
  const drafts = await listOpenCycleCountDraftsWithCtx(ctx, {
    ownerUserId: actorUser._id,
    storeId: args.storeId,
  });
  const changedDrafts = drafts.filter((draft) => draft.changedLineCount > 0);
  const scopeKeys = Array.from(
    new Set(changedDrafts.map((draft) => draft.scopeKey)),
  ).sort((left, right) => left.localeCompare(right));
  const changedDraftLines = (
    await Promise.all(
      changedDrafts.map((draft) => listCycleCountDraftLinesWithCtx(ctx, draft._id)),
    )
  )
    .flat()
    .filter((line) => line.isDirty);
  const lastSavedAt = changedDrafts.reduce<number | undefined>(
    (latestSavedAt, draft) =>
      latestSavedAt === undefined || draft.updatedAt > latestSavedAt
        ? draft.updatedAt
        : latestSavedAt,
    undefined,
  );

  return {
    changedLineCount: changedDrafts.reduce(
      (total, draft) => total + draft.changedLineCount,
      0,
    ),
    draftCount: drafts.length,
    largestAbsoluteDelta: changedDraftLines.reduce(
      (largestDelta, line) =>
        Math.max(
          largestDelta,
          Math.abs(line.countedQuantity - line.baselineInventoryCount),
        ),
      0,
    ),
    lastSavedAt,
    netQuantityDelta: changedDraftLines.reduce(
      (total, line) => total + line.countedQuantity - line.baselineInventoryCount,
      0,
    ),
    scopeKeys,
    scopeCount: scopeKeys.length,
    staleLineCount: changedDrafts.reduce(
      (total, draft) => total + draft.staleLineCount,
      0,
    ),
  };
}

export async function ensureCycleCountDraftCommandWithCtx(
  ctx: MutationCtx,
  args: {
    scopeKey: string;
    storeId: Id<"store">;
  },
): Promise<CommandResult<CycleCountDraftWithLines>> {
  try {
    const draft = await ensureCycleCountDraftWithCtx(ctx, args);

    if (!draft) {
      throw new Error("Cycle count draft could not be created.");
    }

    return ok({
      draft,
      lines: await listCycleCountDraftLinesWithCtx(ctx, draft._id),
    });
  } catch (error) {
    return mapCycleCountDraftError(error);
  }
}

export async function saveCycleCountDraftLineCommandWithCtx(
  ctx: MutationCtx,
  args: {
    countedQuantity: number;
    draftId: Id<"cycleCountDraft">;
    productSkuId: Id<"productSku">;
  },
): Promise<CommandResult<CycleCountDraftWithLines>> {
  try {
    if (!Number.isInteger(args.countedQuantity) || args.countedQuantity < 0) {
      throw new Error("Enter a whole-unit count of zero or more.");
    }

    const draft = await ctx.db.get("cycleCountDraft", args.draftId);

    if (!draft || draft.status !== "open") {
      throw new Error("Cycle count draft not found.");
    }

    const { actorUser, store } = await requireCycleCountDraftAccess(
      ctx,
      draft.storeId,
    );

    if (draft.ownerUserId !== actorUser._id) {
      throw new Error("Cycle count draft not found.");
    }

    const productSku = await ctx.db.get("productSku", args.productSkuId);

    if (!productSku || productSku.storeId !== draft.storeId) {
      throw new Error("Selected SKU could not be found for this store.");
    }

    const now = Date.now();
    const existingLine = await getCycleCountDraftLineWithCtx(ctx, {
      draftId: args.draftId,
      productSkuId: args.productSkuId,
    });
    const baselineInventoryCount =
      existingLine?.baselineInventoryCount ?? productSku.inventoryCount;
    const baselineAvailableCount =
      existingLine?.baselineAvailableCount ?? productSku.quantityAvailable;
    const staleStatus =
      productSku.inventoryCount === baselineInventoryCount &&
      productSku.quantityAvailable === baselineAvailableCount
        ? "current"
        : "stale";
    const isDirty = args.countedQuantity !== baselineInventoryCount;

    if (existingLine) {
      await ctx.db.patch("cycleCountDraftLine", existingLine._id, {
        countedQuantity: args.countedQuantity,
        currentAvailableCount: productSku.quantityAvailable,
        currentInventoryCount: productSku.inventoryCount,
        isDirty,
        staleStatus,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert("cycleCountDraftLine", {
        baselineAvailableCount,
        baselineInventoryCount,
        countedQuantity: args.countedQuantity,
        createdAt: now,
        currentAvailableCount: productSku.quantityAvailable,
        currentInventoryCount: productSku.inventoryCount,
        draftId: args.draftId,
        isDirty,
        organizationId: store.organizationId,
        productSkuId: args.productSkuId,
        staleStatus,
        storeId: draft.storeId,
        updatedAt: now,
      });
    }

    const summary = await refreshCycleCountDraftSummaryWithCtx(
      ctx,
      args.draftId,
      now,
    );
    await ctx.db.patch("cycleCountDraft", args.draftId, {
      lastSavedAt: now,
      ...summary,
    });
    await recordOperationalEventWithCtx(ctx, {
      actorUserId: actorUser._id,
      eventType: "cycle_count_draft_updated",
      message: "Cycle count draft saved.",
      metadata: {
        changedLineCount: summary.changedLineCount,
        productSkuId: String(args.productSkuId),
        scopeKey: draft.scopeKey,
      },
      organizationId: store.organizationId,
      storeId: draft.storeId,
      subjectId: String(args.draftId),
      subjectLabel: "Cycle count draft",
      subjectType: "cycle_count_draft",
    });

    return ok({
      draft: (await ctx.db.get("cycleCountDraft", args.draftId))!,
      lines: await listCycleCountDraftLinesWithCtx(ctx, args.draftId),
    });
  } catch (error) {
    return mapCycleCountDraftError(error);
  }
}

export async function discardCycleCountDraftCommandWithCtx(
  ctx: MutationCtx,
  args: {
    draftId: Id<"cycleCountDraft">;
  },
): Promise<CommandResult<{ draftId: Id<"cycleCountDraft">; status: "discarded" }>> {
  try {
    const draft = await ctx.db.get("cycleCountDraft", args.draftId);

    if (!draft || draft.status !== "open") {
      throw new Error("Cycle count draft not found.");
    }

    const { actorUser, store } = await requireCycleCountDraftAccess(
      ctx,
      draft.storeId,
    );

    if (draft.ownerUserId !== actorUser._id) {
      throw new Error("Cycle count draft not found.");
    }

    const now = Date.now();

    await ctx.db.patch("cycleCountDraft", args.draftId, {
      discardedAt: now,
      status: "discarded",
      updatedAt: now,
    });
    await recordOperationalEventWithCtx(ctx, {
      actorUserId: actorUser._id,
      eventType: "cycle_count_draft_discarded",
      message: "Cycle count draft discarded.",
      metadata: {
        scopeKey: draft.scopeKey,
      },
      organizationId: store.organizationId,
      storeId: draft.storeId,
      subjectId: String(args.draftId),
      subjectLabel: "Cycle count draft",
      subjectType: "cycle_count_draft",
    });

    return ok({ draftId: args.draftId, status: "discarded" });
  } catch (error) {
    return mapCycleCountDraftError(error);
  }
}

export async function refreshCycleCountDraftLineBaselineCommandWithCtx(
  ctx: MutationCtx,
  args: {
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
): Promise<CommandResult<any>> {
  try {
    const { actorUser, store } = await requireCycleCountDraftAccess(
      ctx,
      args.storeId,
    );
    const productSku = await ctx.db.get("productSku", args.productSkuId);

    if (!productSku || productSku.storeId !== args.storeId) {
      throw new Error("Selected SKU could not be found for this store.");
    }

    const drafts = await listOpenCycleCountDraftsWithCtx(ctx, {
      ownerUserId: actorUser._id,
      storeId: args.storeId,
    });
    const draftLineEntries = await Promise.all(
      drafts.map(async (draft) => ({
        draft,
        line: await getCycleCountDraftLineWithCtx(ctx, {
          draftId: draft._id,
          productSkuId: args.productSkuId,
        }),
      })),
    );
    const draftLineEntry = draftLineEntries.find((entry) => entry.line);

    if (!draftLineEntry?.line) {
      throw new Error("Cycle count draft line not found.");
    }

    const now = Date.now();

    await ctx.db.patch("cycleCountDraftLine", draftLineEntry.line._id, {
      baselineAvailableCount: productSku.quantityAvailable,
      baselineInventoryCount: productSku.inventoryCount,
      countedQuantity: productSku.inventoryCount,
      currentAvailableCount: productSku.quantityAvailable,
      currentInventoryCount: productSku.inventoryCount,
      isDirty: false,
      staleStatus: "current",
      updatedAt: now,
    });
    const summary = await refreshCycleCountDraftSummaryWithCtx(
      ctx,
      draftLineEntry.draft._id,
      now,
    );
    await ctx.db.patch("cycleCountDraft", draftLineEntry.draft._id, {
      lastSavedAt: now,
      ...summary,
    });
    await recordOperationalEventWithCtx(ctx, {
      actorUserId: actorUser._id,
      eventType: "cycle_count_draft_baseline_refreshed",
      message: "Cycle count draft baseline refreshed.",
      metadata: {
        productSkuId: String(args.productSkuId),
        scopeKey: draftLineEntry.draft.scopeKey,
      },
      organizationId: store.organizationId,
      storeId: args.storeId,
      subjectId: String(draftLineEntry.draft._id),
      subjectLabel: "Cycle count draft",
      subjectType: "cycle_count_draft",
    });

    return ok({
      draft: await ctx.db.get("cycleCountDraft", draftLineEntry.draft._id),
      line: await ctx.db.get("cycleCountDraftLine", draftLineEntry.line._id),
    });
  } catch (error) {
    return mapCycleCountDraftError(error);
  }
}

async function listStaleCycleCountDraftLines(
  ctx: MutationCtx,
  lines: Doc<"cycleCountDraftLine">[],
): Promise<StaleCycleCountDraftLine[]> {
  const staleLines: Array<StaleCycleCountDraftLine | null> = await Promise.all(
    lines.map(async (line) => {
      const productSku = await ctx.db.get("productSku", line.productSkuId);

      if (
        !productSku ||
        productSku.inventoryCount !== line.baselineInventoryCount ||
        productSku.quantityAvailable !== line.baselineAvailableCount
      ) {
        return {
          baselineAvailableCount: line.baselineAvailableCount,
          baselineInventoryCount: line.baselineInventoryCount,
          currentAvailableCount: productSku?.quantityAvailable ?? 0,
          currentInventoryCount: productSku?.inventoryCount ?? 0,
          productName: productSku?.productName ?? null,
          productSkuId: line.productSkuId,
          sku: productSku?.sku ?? null,
        };
      }

      return null;
    }),
  );

  return staleLines.filter(
    (line): line is StaleCycleCountDraftLine => line !== null,
  );
}

export async function submitCycleCountDraftCommandWithCtx(
  ctx: MutationCtx,
  args: {
    draftId: Id<"cycleCountDraft">;
    notes?: string;
  },
): Promise<CommandResult<any>> {
  try {
    const draft = await ctx.db.get("cycleCountDraft", args.draftId);

    if (!draft) {
      throw new Error("Cycle count draft not found.");
    }

    const { actorUser, store } = await requireCycleCountDraftAccess(
      ctx,
      draft.storeId,
    );

    if (draft.ownerUserId !== actorUser._id) {
      throw new Error("Cycle count draft not found.");
    }

    if (draft.status === "submitted" && draft.submittedStockAdjustmentBatchId) {
      return ok({
        batch: await ctx.db.get(
          "stockAdjustmentBatch",
          draft.submittedStockAdjustmentBatchId,
        ),
        draft,
        status: "submitted",
      });
    }

    if (draft.status !== "open") {
      throw new Error("Cycle count draft not found.");
    }

    const lines = (await listCycleCountDraftLinesWithCtx(ctx, args.draftId)).filter(
      (line) => line.isDirty,
    );

    if (lines.length === 0) {
      throw new Error("Change at least one count before submitting.");
    }

    const staleLines = await listStaleCycleCountDraftLines(ctx, lines);

    if (staleLines.length > 0) {
      const now = Date.now();

      await Promise.all(
        staleLines.map((line) =>
          ctx.db
            .query("cycleCountDraftLine")
            .withIndex("by_draftId_productSkuId", (q) =>
              q
                .eq("draftId", args.draftId)
                .eq("productSkuId", line.productSkuId),
            )
            .first()
            .then((draftLine) =>
              draftLine
                ? ctx.db.patch("cycleCountDraftLine", draftLine._id, {
                    currentAvailableCount: line.currentAvailableCount,
                    currentInventoryCount: line.currentInventoryCount,
                    staleStatus: "stale",
                    updatedAt: now,
                  })
                : null,
            ),
        ),
      );
      await refreshCycleCountDraftSummaryWithCtx(ctx, args.draftId, now);

      return userError({
        code: "precondition_failed",
        message: "Inventory changed since this count started. Review the affected SKUs before submitting.",
        metadata: {
          staleLines,
        },
        title: "Review changed inventory",
      });
    }

    const batch = await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "cycle_count",
      lineItems: lines.map((line) => ({
        countedQuantity: line.countedQuantity,
        productSkuId: line.productSkuId,
      })),
      notes: args.notes,
      reasonCode: CYCLE_COUNT_REASON_CODE,
      storeId: draft.storeId,
      submissionKey: draft.submissionKey,
    });
    const now = Date.now();

    await ctx.db.patch("cycleCountDraft", args.draftId, {
      notes: args.notes?.trim() || undefined,
      status: "submitted",
      submittedAt: now,
      submittedStockAdjustmentBatchId: batch?._id,
      updatedAt: now,
    });
    await recordOperationalEventWithCtx(ctx, {
      actorUserId: actorUser._id,
      eventType: "cycle_count_draft_submitted",
      message: "Cycle count draft submitted.",
      metadata: {
        lineItemCount: lines.length,
        scopeKey: draft.scopeKey,
        stockAdjustmentBatchId: batch?._id ? String(batch._id) : undefined,
      },
      organizationId: store.organizationId,
      storeId: draft.storeId,
      subjectId: String(args.draftId),
      subjectLabel: "Cycle count draft",
      subjectType: "cycle_count_draft",
    });

    return ok({
      batch,
      draft: await ctx.db.get("cycleCountDraft", args.draftId),
      status: "submitted",
    });
  } catch (error) {
    return mapCycleCountDraftError(error);
  }
}

export async function submitActiveCycleCountDraftsCommandWithCtx(
  ctx: MutationCtx,
  args: {
    notes?: string;
    storeId: Id<"store">;
  },
): Promise<CommandResult<any>> {
  try {
    const { actorUser, store } = await requireCycleCountDraftAccess(
      ctx,
      args.storeId,
    );
    const drafts = await listOpenCycleCountDraftsWithCtx(ctx, {
      ownerUserId: actorUser._id,
      storeId: args.storeId,
    });
    const changedDrafts = drafts.filter((draft) => draft.changedLineCount > 0);
    const draftLines = await Promise.all(
      changedDrafts.map(async (draft) => ({
        draft,
        lines: (await listCycleCountDraftLinesWithCtx(ctx, draft._id)).filter(
          (line) => line.isDirty,
        ),
      })),
    );
    const lines = draftLines.flatMap((entry) => entry.lines);

    if (lines.length === 0) {
      throw new Error("Change at least one count before submitting.");
    }

    const staleLines = await listStaleCycleCountDraftLines(ctx, lines);

    if (staleLines.length > 0) {
      const now = Date.now();

      await Promise.all(
        staleLines.map((line) => {
          const draftLine = lines.find(
            (candidateLine) => candidateLine.productSkuId === line.productSkuId,
          );

          return draftLine
            ? ctx.db.patch("cycleCountDraftLine", draftLine._id, {
                currentAvailableCount: line.currentAvailableCount,
                currentInventoryCount: line.currentInventoryCount,
                staleStatus: "stale",
                updatedAt: now,
              })
            : null;
        }),
      );
      await Promise.all(
        changedDrafts.map((draft) =>
          refreshCycleCountDraftSummaryWithCtx(ctx, draft._id, now),
        ),
      );

      return userError({
        code: "precondition_failed",
        message: "Inventory changed since this count started. Review the affected SKUs before submitting.",
        metadata: {
          staleLines,
        },
        title: "Review changed inventory",
      });
    }

    const batch = await submitStockAdjustmentBatchWithCtx(ctx, {
      adjustmentType: "cycle_count",
      lineItems: lines.map((line) => ({
        countedQuantity: line.countedQuantity,
        productSkuId: line.productSkuId,
      })),
      notes: args.notes,
      reasonCode: CYCLE_COUNT_REASON_CODE,
      storeId: args.storeId,
      submissionKey: buildActiveCycleCountDraftsSubmissionKey({
        draftIds: changedDrafts.map((draft) => draft._id),
        ownerUserId: actorUser._id,
        storeId: args.storeId,
      }),
    });
    const now = Date.now();

    await Promise.all(
      changedDrafts.map((draft) =>
        ctx.db.patch("cycleCountDraft", draft._id, {
          notes: args.notes?.trim() || undefined,
          status: "submitted",
          submittedAt: now,
          submittedStockAdjustmentBatchId: batch?._id,
          updatedAt: now,
        }),
      ),
    );
    await Promise.all(
      changedDrafts.map((draft) =>
        recordOperationalEventWithCtx(ctx, {
          actorUserId: actorUser._id,
          eventType: "cycle_count_draft_submitted",
          message: "Cycle count draft submitted.",
          metadata: {
            lineItemCount:
              draftLines.find((entry) => entry.draft._id === draft._id)?.lines
                .length ?? 0,
            scopeKey: draft.scopeKey,
            stockAdjustmentBatchId: batch?._id ? String(batch._id) : undefined,
          },
          organizationId: store.organizationId,
          storeId: draft.storeId,
          subjectId: String(draft._id),
          subjectLabel: "Cycle count draft",
          subjectType: "cycle_count_draft",
        }),
      ),
    );

    return ok({
      batch,
      draftCount: changedDrafts.length,
      status: "submitted",
    });
  } catch (error) {
    return mapCycleCountDraftError(error);
  }
}

function mapCycleCountDraftError(error: unknown): CommandResult<never> {
  const message = error instanceof Error ? error.message : "";

  if (message === "Sign in again to continue.") {
    return userError({ code: "authentication_failed", message });
  }

  if (message === "You do not have permission to adjust stock for this store.") {
    return userError({ code: "authorization_failed", message });
  }

  if (
    message === "Store not found." ||
    message === "Selected SKU could not be found for this store." ||
    message === "Cycle count draft not found." ||
    message === "Cycle count draft line not found."
  ) {
    return userError({ code: "not_found", message });
  }

  if (
    message === "Select a count scope before saving a draft." ||
    message === "Enter a whole-unit count of zero or more." ||
    message === "Change at least one count before submitting." ||
    message === "Cycle count draft could not be created."
  ) {
    return userError({ code: "validation_failed", message });
  }

  throw error;
}

export const getActiveCycleCountDraft = query({
  args: {
    scopeKey: v.string(),
    storeId: v.id("store"),
  },
  handler: getActiveCycleCountDraftWithCtx,
});

export const getActiveCycleCountDraftSummary = query({
  args: {
    storeId: v.id("store"),
  },
  handler: getActiveCycleCountDraftSummaryWithCtx,
});

export const ensureCycleCountDraft = mutation({
  args: {
    scopeKey: v.string(),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: ensureCycleCountDraftCommandWithCtx,
});

export const saveCycleCountDraftLine = mutation({
  args: {
    countedQuantity: v.number(),
    draftId: v.id("cycleCountDraft"),
    productSkuId: v.id("productSku"),
  },
  returns: commandResultValidator(v.any()),
  handler: saveCycleCountDraftLineCommandWithCtx,
});

export const discardCycleCountDraft = mutation({
  args: {
    draftId: v.id("cycleCountDraft"),
  },
  returns: commandResultValidator(v.any()),
  handler: discardCycleCountDraftCommandWithCtx,
});

export const refreshCycleCountDraftLineBaseline = mutation({
  args: {
    productSkuId: v.id("productSku"),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: refreshCycleCountDraftLineBaselineCommandWithCtx,
});

export const submitCycleCountDraft = mutation({
  args: {
    draftId: v.id("cycleCountDraft"),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(v.any()),
  handler: submitCycleCountDraftCommandWithCtx,
});

export const submitActiveCycleCountDrafts = mutation({
  args: {
    notes: v.optional(v.string()),
    storeId: v.id("store"),
  },
  returns: commandResultValidator(v.any()),
  handler: submitActiveCycleCountDraftsCommandWithCtx,
});
