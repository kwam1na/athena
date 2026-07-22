import { v } from "convex/values";

import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import type { Doc, Id } from "../../_generated/dataModel";
import { commandResultValidator } from "../../lib/commandResultValidators";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { requireStoreMemberAccessWithCtx } from "../../lib/storeMemberAccess";
import { userError } from "../../../shared/commandResult";
import {
  createCustomer as createCustomerCommand,
  linkToGuest as linkToGuestCommand,
  linkToStoreFrontUser as linkToStoreFrontUserCommand,
  resolveGuestMatch as resolveGuestMatchCommand,
  resolvePosCustomerSelection as resolvePosCustomerSelectionCommand,
  resolveStoreFrontUserMatch as resolveStoreFrontUserMatchCommand,
  updateCustomer as updateCustomerCommand,
  updateCustomerStats as updateCustomerStatsCommand,
} from "../application/commands/assignCustomer";
import {
  findByStoreFrontUser as findByStoreFrontUserQuery,
  findPotentialMatches as findPotentialMatchesQuery,
  getCustomerById as getCustomerByIdQuery,
  getCustomerTransactions as getCustomerTransactionsQuery,
  searchCustomers as searchCustomersQuery,
} from "../application/queries/searchCustomers";
import { admitSharedDemoPublicQuery } from "../../operationAdmission/publicQuery";
import {
  findPotentialPosCustomerMatchesReadDefinition,
  findPosCustomerByStoreFrontUserReadDefinition,
  getPosCustomerByIdReadDefinition,
  getPosCustomerTransactionsReadDefinition,
  searchPosCustomersReadDefinition,
} from "../../operationAdmission/readDefinitions";
import type { OperationQueryCtx } from "../../operationAdmission/types";

type PosCustomerStoreAccess =
  | {
      ok: true;
      store: Doc<"store">;
      athenaUser: Doc<"athenaUser">;
      membership: Doc<"organizationMember">;
    }
  | { ok: false };

async function requirePosCustomerStoreAccess(
  ctx: MutationCtx | QueryCtx,
  args: {
    storeId: Id<"store">;
    failureMessage: string;
  },
): Promise<PosCustomerStoreAccess> {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    return { ok: false };
  }

  const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  const membership = await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin", "pos_only"],
    failureMessage: args.failureMessage,
    organizationId: store.organizationId,
    userId: athenaUser._id,
  });

  return { ok: true, store, athenaUser, membership };
}

async function requirePosCustomerAccessById(
  ctx: MutationCtx | QueryCtx,
  args: {
    customerId: Id<"posCustomer">;
    failureMessage: string;
  },
): Promise<PosCustomerStoreAccess & { customer?: Doc<"posCustomer"> }> {
  const customer = await ctx.db.get("posCustomer", args.customerId);
  if (!customer) {
    return { ok: false };
  }

  const access = await requirePosCustomerStoreAccess(ctx, {
    storeId: customer.storeId,
    failureMessage: args.failureMessage,
  });
  if (!access.ok) {
    return { ok: false };
  }

  return { ...access, customer };
}

async function requirePosCustomerStoreReadAccess(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    failureMessage: string;
  },
): Promise<PosCustomerStoreAccess> {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    return { ok: false };
  }

  const { athenaUser, membership } = await requireStoreMemberAccessWithCtx(
    ctx,
    {
      allowedRoles: ["full_admin", "pos_only"],
      demoAccess: { kind: "read" },
      failureMessage: args.failureMessage,
      storeId: args.storeId,
    },
  );
  return { ok: true, store, athenaUser, membership };
}

async function requirePosCustomerReadAccessById(
  ctx: QueryCtx,
  args: {
    customerId: Id<"posCustomer">;
    failureMessage: string;
  },
): Promise<PosCustomerStoreAccess & { customer?: Doc<"posCustomer"> }> {
  const customer = await ctx.db.get("posCustomer", args.customerId);
  if (!customer) {
    return { ok: false };
  }

  const access = await requirePosCustomerStoreReadAccess(ctx, {
    storeId: customer.storeId,
    failureMessage: args.failureMessage,
  });
  return access.ok ? { ...access, customer } : { ok: false };
}

const customerAddressValidator = v.object({
  street: v.optional(v.string()),
  city: v.optional(v.string()),
  state: v.optional(v.string()),
  zipCode: v.optional(v.string()),
  country: v.optional(v.string()),
});

const customerSummaryValidator = v.object({
  _id: v.id("posCustomer"),
  _creationTime: v.number(),
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  totalSpent: v.optional(v.number()),
  transactionCount: v.optional(v.number()),
  lastTransactionAt: v.optional(v.number()),
  customerProfileId: v.optional(v.id("customerProfile")),
});

const attributionSummaryValidator = v.union(
  v.object({
    kind: v.literal("pos_customer"),
    posCustomerId: v.id("posCustomer"),
    customerProfileId: v.optional(v.id("customerProfile")),
    reusable: v.literal(true),
  }),
  v.object({
    kind: v.literal("storefront_user"),
    posCustomerId: v.id("posCustomer"),
    storeFrontUserId: v.id("storeFrontUser"),
    customerProfileId: v.optional(v.id("customerProfile")),
    reusable: v.literal(true),
  }),
  v.object({
    kind: v.literal("guest"),
    posCustomerId: v.id("posCustomer"),
    guestId: v.id("guest"),
    customerProfileId: v.optional(v.id("customerProfile")),
    reusable: v.literal(true),
  }),
  v.object({
    kind: v.literal("sale_only"),
    reusable: v.literal(false),
  }),
);

const customerAttributionResultValidator = v.object({
  _id: v.optional(v.id("posCustomer")),
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  customerProfileId: v.optional(v.id("customerProfile")),
  attribution: attributionSummaryValidator,
});

export const searchCustomers = query({
  args: {
    storeId: v.id("store"),
    searchQuery: v.string(),
  },
  returns: v.array(customerSummaryValidator),
  handler: admitSharedDemoPublicQuery(
    searchPosCustomersReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { searchQuery: string; storeId: Id<"store"> },
    ) => {
    const access = await requirePosCustomerStoreReadAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot search customers for this store.",
    });
    if (!access.ok) {
      return [];
    }

    return searchCustomersQuery(ctx, args);
    },
  ),
});

export const getCustomerById = query({
  args: {
    customerId: v.id("posCustomer"),
  },
  returns: v.union(
    v.object({
      _id: v.id("posCustomer"),
      _creationTime: v.number(),
      storeId: v.id("store"),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      address: v.optional(customerAddressValidator),
      notes: v.optional(v.string()),
      totalSpent: v.optional(v.number()),
      transactionCount: v.optional(v.number()),
      lastTransactionAt: v.optional(v.number()),
      loyaltyPoints: v.optional(v.number()),
      preferredPaymentMethod: v.optional(v.string()),
      tags: v.optional(v.array(v.string())),
      isActive: v.optional(v.boolean()),
    }),
    v.null(),
  ),
  handler: admitSharedDemoPublicQuery(
    getPosCustomerByIdReadDefinition,
    async (ctx: OperationQueryCtx, args: { customerId: Id<"posCustomer"> }) => {
    const access = await requirePosCustomerReadAccessById(ctx, {
      customerId: args.customerId,
      failureMessage: "You cannot view this customer.",
    });
    if (!access.ok) {
      return null;
    }

    return getCustomerByIdQuery(ctx, args);
    },
  ),
});

export const createCustomer = mutation({
  args: {
    storeId: v.id("store"),
    name: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(customerAddressValidator),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(customerAttributionResultValidator),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerStoreAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot create customers for this store.",
    });
    if (!access.ok) {
      return userError({ code: "not_found", message: "Store not found." });
    }

    return createCustomerCommand(ctx, args);
  },
});

export const updateCustomer = mutation({
  args: {
    customerId: v.id("posCustomer"),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    address: v.optional(customerAddressValidator),
    notes: v.optional(v.string()),
  },
  returns: commandResultValidator(v.null()),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerAccessById(ctx, {
      customerId: args.customerId,
      failureMessage: "You cannot update this customer.",
    });
    if (!access.ok) {
      return userError({ code: "not_found", message: "Customer not found." });
    }

    return updateCustomerCommand(ctx, args);
  },
});

export const updateCustomerStats = mutation({
  args: {
    customerId: v.id("posCustomer"),
    transactionAmount: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerAccessById(ctx, {
      customerId: args.customerId,
      failureMessage: "You cannot update this customer.",
    });
    if (!access.ok) {
      return null;
    }

    return updateCustomerStatsCommand(ctx, args);
  },
});

export const resolvePosCustomerSelection = mutation({
  args: {
    customerId: v.id("posCustomer"),
  },
  returns: commandResultValidator(customerAttributionResultValidator),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerAccessById(ctx, {
      customerId: args.customerId,
      failureMessage: "You cannot resolve this customer.",
    });
    if (!access.ok) {
      return userError({ code: "not_found", message: "Customer not found." });
    }

    return resolvePosCustomerSelectionCommand(ctx, args);
  },
});

export const getCustomerTransactions = query({
  args: {
    customerId: v.id("posCustomer"),
    limit: v.optional(v.number()),
  },
  returns: v.array(
    v.object({
      _id: v.id("posTransaction"),
      _creationTime: v.number(),
      transactionNumber: v.string(),
      total: v.number(),
      paymentMethod: v.optional(v.string()),
      status: v.string(),
      completedAt: v.number(),
    }),
  ),
  handler: admitSharedDemoPublicQuery(
    getPosCustomerTransactionsReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { customerId: Id<"posCustomer">; limit?: number },
    ) => {
    const access = await requirePosCustomerReadAccessById(ctx, {
      customerId: args.customerId,
      failureMessage: "You cannot view this customer.",
    });
    if (!access.ok) {
      return [];
    }

    return getCustomerTransactionsQuery(ctx, args);
    },
  ),
});

export const linkToStoreFrontUser = mutation({
  args: {
    posCustomerId: v.id("posCustomer"),
    storeFrontUserId: v.id("storeFrontUser"),
  },
  returns: commandResultValidator(customerAttributionResultValidator),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerAccessById(ctx, {
      customerId: args.posCustomerId,
      failureMessage: "You cannot update this customer.",
    });
    if (!access.ok) {
      return userError({ code: "not_found", message: "Customer not found." });
    }

    return linkToStoreFrontUserCommand(ctx, args);
  },
});

export const linkToGuest = mutation({
  args: {
    posCustomerId: v.id("posCustomer"),
    guestId: v.id("guest"),
  },
  returns: commandResultValidator(customerAttributionResultValidator),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerAccessById(ctx, {
      customerId: args.posCustomerId,
      failureMessage: "You cannot update this customer.",
    });
    if (!access.ok) {
      return userError({ code: "not_found", message: "Customer not found." });
    }

    return linkToGuestCommand(ctx, args);
  },
});

export const resolveStoreFrontUserMatch = mutation({
  args: {
    storeId: v.id("store"),
    storeFrontUserId: v.id("storeFrontUser"),
  },
  returns: commandResultValidator(customerAttributionResultValidator),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerStoreAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot resolve customers for this store.",
    });
    if (!access.ok) {
      return userError({ code: "not_found", message: "Store not found." });
    }

    return resolveStoreFrontUserMatchCommand(ctx, args);
  },
});

export const resolveGuestMatch = mutation({
  args: {
    storeId: v.id("store"),
    guestId: v.id("guest"),
  },
  returns: commandResultValidator(customerAttributionResultValidator),
  handler: async (ctx, args) => {
    const access = await requirePosCustomerStoreAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot resolve customers for this store.",
    });
    if (!access.ok) {
      return userError({ code: "not_found", message: "Store not found." });
    }

    return resolveGuestMatchCommand(ctx, args);
  },
});

export const findByStoreFrontUser = query({
  args: {
    storeFrontUserId: v.id("storeFrontUser"),
  },
  returns: v.union(
    v.object({
      _id: v.id("posCustomer"),
      _creationTime: v.number(),
      name: v.string(),
      email: v.optional(v.string()),
      phone: v.optional(v.string()),
      totalSpent: v.optional(v.number()),
      transactionCount: v.optional(v.number()),
      linkedStoreFrontUserId: v.optional(v.id("storeFrontUser")),
    }),
    v.null(),
  ),
  handler: admitSharedDemoPublicQuery(
    findPosCustomerByStoreFrontUserReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { storeFrontUserId: Id<"storeFrontUser"> },
    ) => {
    const storeFrontUser = await ctx.db.get(
      "storeFrontUser",
      args.storeFrontUserId,
    );
    if (!storeFrontUser) {
      return null;
    }

    const access = await requirePosCustomerStoreReadAccess(ctx, {
      storeId: storeFrontUser.storeId,
      failureMessage: "You cannot view this customer.",
    });
    if (!access.ok) {
      return null;
    }

    return findByStoreFrontUserQuery(ctx, args);
    },
  ),
});

export const findPotentialMatches = query({
  args: {
    storeId: v.id("store"),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
  },
  returns: v.object({
    storeFrontUsers: v.array(
      v.object({
        _id: v.id("storeFrontUser"),
        email: v.string(),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
      }),
    ),
    guests: v.array(
      v.object({
        _id: v.id("guest"),
        email: v.optional(v.string()),
        firstName: v.optional(v.string()),
        lastName: v.optional(v.string()),
        phoneNumber: v.optional(v.string()),
      }),
    ),
  }),
  handler: admitSharedDemoPublicQuery(
    findPotentialPosCustomerMatchesReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { email?: string; phone?: string; storeId: Id<"store"> },
    ) => {
    const access = await requirePosCustomerStoreReadAccess(ctx, {
      storeId: args.storeId,
      failureMessage: "You cannot view potential matches for this store.",
    });
    if (!access.ok) {
      return { storeFrontUsers: [], guests: [] };
    }

    return findPotentialMatchesQuery(ctx, args);
    },
  ),
});
