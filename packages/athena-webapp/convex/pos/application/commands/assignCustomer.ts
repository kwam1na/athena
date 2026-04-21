import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

import {
  createPosCustomer,
  ensureCustomerProfileFromSources,
  findCustomerByEmail,
  findCustomerByPhone,
  findPosCustomerByStoreFrontUser,
  getGuestById,
  getPosCustomerById,
  getStoreFrontUserById,
  patchPosCustomer,
  updateCustomerStats as updateCustomerStatsRecord,
} from "../../infrastructure/repositories/customerRepository";

export async function createCustomer(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    name: string;
    email?: string;
    phone?: string;
    address?: Doc<"posCustomer">["address"];
    notes?: string;
  },
) {
  if (args.email) {
    const existingByEmail = await findCustomerByEmail(ctx, {
      storeId: args.storeId,
      email: args.email,
    });

    if (existingByEmail) {
      throw new Error("Customer with this email already exists");
    }
  }

  if (args.phone) {
    const existingByPhone = await findCustomerByPhone(ctx, {
      storeId: args.storeId,
      phone: args.phone,
    });

    if (existingByPhone) {
      throw new Error("Customer with this phone number already exists");
    }
  }

  const customerId = await createPosCustomer(ctx, {
    storeId: args.storeId,
    name: args.name,
    email: args.email,
    phone: args.phone,
    address: args.address,
    notes: args.notes,
    totalSpent: 0,
    transactionCount: 0,
    loyaltyPoints: 0,
    isActive: true,
  });
  const customer = await getPosCustomerById(ctx, customerId);

  return {
    _id: customer!._id,
    name: customer!.name,
    email: customer!.email,
    phone: customer!.phone,
  };
}

export async function updateCustomer(
  ctx: MutationCtx,
  args: {
    customerId: Id<"posCustomer">;
    name?: string;
    email?: string;
    phone?: string;
    address?: Doc<"posCustomer">["address"];
    notes?: string;
  },
) {
  const updates: Partial<Doc<"posCustomer">> = {};

  if (args.name) updates.name = args.name;
  if (args.email) updates.email = args.email;
  if (args.phone) updates.phone = args.phone;
  if (args.address) updates.address = args.address;
  if (args.notes) updates.notes = args.notes;

  await patchPosCustomer(ctx, args.customerId, updates);
  return null;
}

export async function updateCustomerStats(
  ctx: MutationCtx,
  args: {
    customerId: Id<"posCustomer">;
    transactionAmount: number;
  },
) {
  await updateCustomerStatsRecord(ctx, {
    customerId: args.customerId,
    transactionAmount: args.transactionAmount,
    updatedAt: Date.now(),
  });

  return null;
}

export async function linkToStoreFrontUser(
  ctx: MutationCtx,
  args: {
    posCustomerId: Id<"posCustomer">;
    storeFrontUserId: Id<"storeFrontUser">;
  },
) {
  const posCustomer = await getPosCustomerById(ctx, args.posCustomerId);
  const storeFrontUser = await getStoreFrontUserById(ctx, args.storeFrontUserId);

  if (!posCustomer || !storeFrontUser) {
    throw new Error("Customer or storefront user not found");
  }

  const existingLink = await findPosCustomerByStoreFrontUser(
    ctx,
    args.storeFrontUserId,
  );
  if (existingLink && existingLink._id !== args.posCustomerId) {
    throw new Error(
      "This storefront user is already linked to another POS customer",
    );
  }

  await patchPosCustomer(ctx, args.posCustomerId, {
    linkedStoreFrontUserId: args.storeFrontUserId,
    email: storeFrontUser.email,
    phone: storeFrontUser.phoneNumber || posCustomer.phone,
  });

  await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: args.posCustomerId,
    storeFrontUserId: args.storeFrontUserId,
    fallbackStoreId: posCustomer.storeId,
  });

  return null;
}

export async function linkToGuest(
  ctx: MutationCtx,
  args: {
    posCustomerId: Id<"posCustomer">;
    guestId: Id<"guest">;
  },
) {
  const posCustomer = await getPosCustomerById(ctx, args.posCustomerId);
  const guest = await getGuestById(ctx, args.guestId);

  if (!posCustomer || !guest) {
    throw new Error("Customer or guest not found");
  }

  await patchPosCustomer(ctx, args.posCustomerId, {
    linkedGuestId: args.guestId,
    email: guest.email || posCustomer.email,
    phone: guest.phoneNumber || posCustomer.phone,
  });

  await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: args.posCustomerId,
    guestId: args.guestId,
    fallbackStoreId: posCustomer.storeId,
  });

  return null;
}
