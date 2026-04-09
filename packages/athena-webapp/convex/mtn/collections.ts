import { v } from "convex/values";
import {
  ActionCtx,
  internalAction,
  internalMutation,
  internalQuery,
  MutationCtx,
  QueryCtx,
} from "../_generated/server";
import { Doc, Id } from "../_generated/dataModel";
import { internal } from "../_generated/api";
import {
  buildMtnCollectionsCallbackUrl,
  resolveMtnCollectionsConfigFromEnv,
} from "./config";
import {
  createCollectionsAccessToken,
  getRequestToPayStatus,
  requestToPay,
} from "./client";
import { normalizeCollectionsTransaction } from "./normalize";
import { MtnCollectionsConfig } from "./types";

const TOKEN_REFRESH_BUFFER_MS = 60_000;

const getCachedTokenRecord = async (
  ctx: ActionCtx,
  storeId: Id<"store">,
): Promise<Doc<"mtnCollectionsToken"> | null> => {
  return await ctx.runQuery(internal.mtn.collections.getCachedToken, { storeId });
};

const resolveConfigForStore = async (
  ctx: ActionCtx,
  storeId: Id<"store">,
): Promise<
  | {
      success: true;
      store: Doc<"store">;
      config: MtnCollectionsConfig;
    }
  | {
      success: false;
      reason: "store_not_found" | "not_configured";
      missing?: string[];
    }
> => {
  const store = await ctx.runQuery(internal.inventory.stores.findById, {
    id: storeId,
  });

  if (!store) {
    return {
      success: false,
      reason: "store_not_found",
    };
  }

  const configResult = resolveMtnCollectionsConfigFromEnv({
    storeId,
    storeSlug: store.slug,
  });

  if (configResult.kind === "not_configured") {
    return {
      success: false,
      reason: "not_configured",
      missing: configResult.missing,
    };
  }

  return {
    success: true,
    store,
    config: configResult.config,
  };
};

const resolveAccessTokenForStore = async (
  ctx: ActionCtx,
  storeId: Id<"store">,
): Promise<
  | {
      success: true;
      store: Doc<"store">;
      config: MtnCollectionsConfig;
      accessToken: string;
      expiresAt: number;
      cached: boolean;
    }
  | {
      success: false;
      reason: "store_not_found" | "not_configured";
      missing?: string[];
    }
> => {
  const configResult = await resolveConfigForStore(ctx, storeId);

  if (!configResult.success) {
    return configResult;
  }

  const cachedToken = await getCachedTokenRecord(ctx, storeId);
  const now = Date.now();

  if (cachedToken && cachedToken.expiresAt > now + TOKEN_REFRESH_BUFFER_MS) {
    return {
      success: true as const,
      store: configResult.store,
      config: configResult.config,
      accessToken: cachedToken.accessToken,
      expiresAt: cachedToken.expiresAt,
      cached: true,
    };
  }

  const token = await createCollectionsAccessToken(configResult.config);
  const expiresAt = now + token.expiresInSeconds * 1000;

  await ctx.runMutation(internal.mtn.collections.upsertCachedToken, {
    storeId,
    accessToken: token.accessToken,
    expiresAt,
  });

  return {
    success: true as const,
    store: configResult.store,
    config: configResult.config,
    accessToken: token.accessToken,
    expiresAt,
    cached: false,
  };
};

export const getCachedToken = internalQuery({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mtnCollectionsToken")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();
  },
});

export const upsertCachedToken = internalMutation({
  args: {
    storeId: v.id("store"),
    accessToken: v.string(),
    expiresAt: v.number(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mtnCollectionsToken")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .first();

    const patch = {
      accessToken: args.accessToken,
      expiresAt: args.expiresAt,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch("mtnCollectionsToken", existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("mtnCollectionsToken", {
      storeId: args.storeId,
      ...patch,
    });
  },
});

export const getAccessToken = internalAction({
  args: {
    storeId: v.id("store"),
  },
  handler: async (
    ctx,
    args,
  ): Promise<
    | {
        success: true;
        accessToken: string;
        expiresAt: number;
        cached: boolean;
        config: MtnCollectionsConfig;
      }
    | {
        success: false;
        reason: "store_not_found" | "not_configured";
        missing?: string[];
      }
  > => {
    const tokenResult = await resolveAccessTokenForStore(ctx, args.storeId);

    if (!tokenResult.success) {
      return tokenResult;
    }

    return {
      success: true,
      accessToken: tokenResult.accessToken,
      expiresAt: tokenResult.expiresAt,
      cached: tokenResult.cached,
      config: tokenResult.config,
    };
  },
});

export const getTransactionByProviderReference = internalQuery({
  args: {
    providerReference: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mtnCollectionTransaction")
      .withIndex("by_providerReference", (q) =>
        q.eq("providerReference", args.providerReference),
      )
      .first();
  },
});

export const listTransactions = internalQuery({
  args: {
    storeId: v.id("store"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("mtnCollectionTransaction")
      .withIndex("by_storeId_requestedAt", (q) =>
        q.eq("storeId", args.storeId),
      )
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const upsertPendingTransaction = internalMutation({
  args: {
    storeId: v.id("store"),
    providerReference: v.string(),
    externalId: v.string(),
    amount: v.number(),
    currency: v.string(),
    requestedAt: v.number(),
    payerPartyIdType: v.string(),
    payerIdentifierMasked: v.string(),
    payerMessage: v.string(),
    payeeNote: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mtnCollectionTransaction")
      .withIndex("by_providerReference", (q) =>
        q.eq("providerReference", args.providerReference),
      )
      .first();

    const patch = {
      storeId: args.storeId,
      providerReference: args.providerReference,
      externalId: args.externalId,
      status: existing?.status ?? "PENDING",
      amount: args.amount,
      currency: args.currency,
      requestedAt: existing?.requestedAt ?? args.requestedAt,
      payerPartyIdType: args.payerPartyIdType,
      payerIdentifierMasked: args.payerIdentifierMasked,
      payerMessage: args.payerMessage,
      payeeNote: args.payeeNote,
      callbackCount: existing?.callbackCount,
      updatedAt: Date.now(),
    };

    if (existing) {
      await ctx.db.patch("mtnCollectionTransaction", existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("mtnCollectionTransaction", patch as any);
  },
});

export const ingestNotification = internalMutation({
  args: {
    storeId: v.id("store"),
    providerReference: v.string(),
    statusPayload: v.record(v.string(), v.any()),
    observedAt: v.number(),
    callbackMetadata: v.optional(v.record(v.string(), v.any())),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("mtnCollectionTransaction")
      .withIndex("by_providerReference", (q) =>
        q.eq("providerReference", args.providerReference),
      )
      .first();

    const normalized = normalizeCollectionsTransaction({
      storeId: args.storeId,
      providerReference: args.providerReference,
      requestedAt: existing?.requestedAt ?? args.observedAt,
      statusPayload: args.statusPayload as any,
      observedAt: args.observedAt,
      callbackMetadata: args.callbackMetadata,
    });

    const patch: Record<string, any> = {
      ...normalized,
      amount: normalized.amount ?? existing?.amount ?? 0,
      callbackCount: (existing?.callbackCount ?? 0) + 1,
      providerPayload: args.statusPayload,
      updatedAt: args.observedAt,
    };

    if (existing) {
      await ctx.db.patch("mtnCollectionTransaction", existing._id, patch);
      return existing._id;
    }

    return await ctx.db.insert("mtnCollectionTransaction", patch as any);
  },
});

export const requestCollection = internalAction({
  args: {
    storeId: v.id("store"),
    amount: v.number(),
    currency: v.string(),
    externalId: v.string(),
    payer: v.object({
      partyIdType: v.string(),
      partyId: v.string(),
    }),
    payerMessage: v.string(),
    payeeNote: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenResult = await resolveAccessTokenForStore(ctx, args.storeId);

    if (!tokenResult.success) {
      return tokenResult;
    }

    const providerReference = crypto.randomUUID();
    const requestedAt = Date.now();
    const callbackUrl = buildMtnCollectionsCallbackUrl(tokenResult.config, {
      storeId: args.storeId,
      providerReference,
    });

    await ctx.runMutation(internal.mtn.collections.upsertPendingTransaction, {
      storeId: args.storeId,
      providerReference,
      externalId: args.externalId,
      amount: args.amount,
      currency: args.currency,
      requestedAt,
      payerPartyIdType: args.payer.partyIdType,
      payerIdentifierMasked: normalizeCollectionsTransaction({
        storeId: args.storeId,
        providerReference,
        requestedAt,
        statusPayload: {
          amount: String(args.amount),
          currency: args.currency,
          externalId: args.externalId,
          payer: args.payer,
          payerMessage: args.payerMessage,
          payeeNote: args.payeeNote,
          status: "PENDING",
        },
        observedAt: requestedAt,
      }).payerIdentifierMasked,
      payerMessage: args.payerMessage,
      payeeNote: args.payeeNote,
    });

    const response = await requestToPay(tokenResult.config, tokenResult.accessToken, {
      providerReference,
      callbackUrl,
      amount: String(args.amount),
      currency: args.currency,
      externalId: args.externalId,
      payer: args.payer,
      payerMessage: args.payerMessage,
      payeeNote: args.payeeNote,
    });

    return {
      success: true,
      providerReference: response.providerReference,
      accepted: response.accepted,
      callbackUrl,
    };
  },
});

export const getCollectionStatus = internalAction({
  args: {
    storeId: v.id("store"),
    providerReference: v.string(),
  },
  handler: async (ctx, args) => {
    const tokenResult = await resolveAccessTokenForStore(ctx, args.storeId);

    if (!tokenResult.success) {
      return tokenResult;
    }

    const payload = await getRequestToPayStatus(
      tokenResult.config,
      tokenResult.accessToken,
      args.providerReference,
    );
    const observedAt = Date.now();

    await ctx.runMutation(internal.mtn.collections.ingestNotification, {
      storeId: args.storeId,
      providerReference: args.providerReference,
      statusPayload: payload as any,
      observedAt,
      callbackMetadata: {
        source: "status_poll",
        receivedAt: observedAt,
      },
    });

    return {
      success: true,
      providerReference: args.providerReference,
      payload,
    };
  },
});
