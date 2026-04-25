import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";
import {
  ok,
  userError,
  type CommandResult,
} from "../../../../shared/commandResult";

import {
  createPosCustomer,
  ensureCustomerProfileFromSources,
  findCustomerByEmail,
  findCustomerByPhone,
  findPosCustomerByGuest,
  findPosCustomerByStoreFrontUser,
  getGuestById,
  getPosCustomerById,
  getStoreFrontUserById,
  patchPosCustomer,
  updateCustomerStats as updateCustomerStatsRecord,
} from "../../infrastructure/repositories/customerRepository";

type CustomerAttributionSummary =
  | {
      kind: "pos_customer";
      posCustomerId: Id<"posCustomer">;
      customerProfileId?: Id<"customerProfile">;
      reusable: true;
    }
  | {
      kind: "storefront_user";
      posCustomerId: Id<"posCustomer">;
      storeFrontUserId: Id<"storeFrontUser">;
      customerProfileId?: Id<"customerProfile">;
      reusable: true;
    }
  | {
      kind: "guest";
      posCustomerId: Id<"posCustomer">;
      guestId: Id<"guest">;
      customerProfileId?: Id<"customerProfile">;
      reusable: true;
    }
  | {
      kind: "sale_only";
      reusable: false;
    };

type CustomerAttributionResult = {
  _id?: Id<"posCustomer">;
  name: string;
  email?: string;
  phone?: string;
  customerProfileId?: Id<"customerProfile">;
  attribution: CustomerAttributionSummary;
};

function fullNameFromParts(args: {
  firstName?: string;
  lastName?: string;
  fallbackEmail?: string;
}) {
  const fullName = [args.firstName, args.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();

  return fullName || args.fallbackEmail || "Unknown customer";
}

function posCustomerResult(
  customer: Doc<"posCustomer">,
  customerProfileId?: Id<"customerProfile">,
): CustomerAttributionResult {
  return {
    _id: customer._id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    customerProfileId,
    attribution: {
      kind: "pos_customer",
      posCustomerId: customer._id,
      customerProfileId,
      reusable: true,
    },
  };
}

function storefrontResult(
  customer: Doc<"posCustomer">,
  storeFrontUserId: Id<"storeFrontUser">,
  customerProfileId?: Id<"customerProfile">,
): CustomerAttributionResult {
  return {
    _id: customer._id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    customerProfileId,
    attribution: {
      kind: "storefront_user",
      posCustomerId: customer._id,
      storeFrontUserId,
      customerProfileId,
      reusable: true,
    },
  };
}

function guestResult(
  customer: Doc<"posCustomer">,
  guestId: Id<"guest">,
  customerProfileId?: Id<"customerProfile">,
): CustomerAttributionResult {
  return {
    _id: customer._id,
    name: customer.name,
    email: customer.email,
    phone: customer.phone,
    customerProfileId,
    attribution: {
      kind: "guest",
      posCustomerId: customer._id,
      guestId,
      customerProfileId,
      reusable: true,
    },
  };
}

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
): Promise<CommandResult<CustomerAttributionResult>> {
  const normalizedEmail = args.email?.trim().toLowerCase() || undefined;
  const normalizedPhone = args.phone?.trim() || undefined;

  if (!normalizedEmail && !normalizedPhone) {
    return ok({
      name: args.name,
      attribution: {
        kind: "sale_only",
        reusable: false,
      },
    });
  }

  const existingByEmail = normalizedEmail
    ? await findCustomerByEmail(ctx, {
        storeId: args.storeId,
        email: normalizedEmail,
      })
    : null;

  const existingByPhone = normalizedPhone
    ? await findCustomerByPhone(ctx, {
        storeId: args.storeId,
        phone: normalizedPhone,
      })
    : null;

  if (
    existingByEmail &&
    existingByPhone &&
    existingByEmail._id !== existingByPhone._id
  ) {
    return userError({
      code: "conflict",
      message:
        "Email and phone match different POS customers. Select a customer before continuing.",
    });
  }

  const existingCustomer = existingByEmail ?? existingByPhone;

  if (existingCustomer) {
    const profile = await ensureCustomerProfileFromSources(ctx, {
      posCustomerId: existingCustomer._id,
      fallbackStoreId: args.storeId,
    });

    return ok(posCustomerResult(existingCustomer, profile?._id));
  }

  const customerId = await createPosCustomer(ctx, {
    storeId: args.storeId,
    name: args.name,
    email: normalizedEmail,
    phone: normalizedPhone,
    address: args.address,
    notes: args.notes,
    totalSpent: 0,
    transactionCount: 0,
    loyaltyPoints: 0,
    isActive: true,
  });
  const customer = await getPosCustomerById(ctx, customerId);
  if (!customer) {
    return userError({
      code: "not_found",
      message: "Customer could not be loaded after creation.",
    });
  }
  const profile = await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: customer._id,
    fallbackStoreId: args.storeId,
  });

  return ok(posCustomerResult(customer, profile?._id));
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
): Promise<CommandResult<null>> {
  const customer = await getPosCustomerById(ctx, args.customerId);
  if (!customer) {
    return userError({
      code: "not_found",
      message: "Customer not found.",
    });
  }

  const updates: Partial<Doc<"posCustomer">> = {};

  if (args.name) updates.name = args.name;
  if (args.email) updates.email = args.email;
  if (args.phone) updates.phone = args.phone;
  if (args.address) updates.address = args.address;
  if (args.notes) updates.notes = args.notes;

  await patchPosCustomer(ctx, args.customerId, updates);
  return ok(null);
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

export async function resolvePosCustomerSelection(
  ctx: MutationCtx,
  args: {
    customerId: Id<"posCustomer">;
  },
): Promise<CommandResult<CustomerAttributionResult>> {
  const customer = await getPosCustomerById(ctx, args.customerId);

  if (!customer) {
    return userError({
      code: "not_found",
      message: "Customer not found.",
    });
  }

  const profile = await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: customer._id,
    fallbackStoreId: customer.storeId,
  });

  return ok(posCustomerResult(customer, profile?._id));
}

export async function linkToStoreFrontUser(
  ctx: MutationCtx,
  args: {
    posCustomerId: Id<"posCustomer">;
    storeFrontUserId: Id<"storeFrontUser">;
  },
): Promise<CommandResult<CustomerAttributionResult>> {
  const posCustomer = await getPosCustomerById(ctx, args.posCustomerId);
  const storeFrontUser = await getStoreFrontUserById(
    ctx,
    args.storeFrontUserId,
  );

  if (!posCustomer || !storeFrontUser) {
    return userError({
      code: "not_found",
      message: "Customer or storefront user not found.",
    });
  }

  const existingLink = await findPosCustomerByStoreFrontUser(
    ctx,
    args.storeFrontUserId,
  );
  if (existingLink && existingLink._id !== args.posCustomerId) {
    return userError({
      code: "conflict",
      message:
        "This storefront user is already linked to another POS customer.",
    });
  }

  await patchPosCustomer(ctx, args.posCustomerId, {
    linkedStoreFrontUserId: args.storeFrontUserId,
    email: storeFrontUser.email,
    phone: storeFrontUser.phoneNumber || posCustomer.phone,
  });
  const updatedPosCustomer =
    (await getPosCustomerById(ctx, args.posCustomerId)) ?? posCustomer;

  const profile = await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: args.posCustomerId,
    storeFrontUserId: args.storeFrontUserId,
    fallbackStoreId: posCustomer.storeId,
  });

  return ok(
    storefrontResult(updatedPosCustomer, args.storeFrontUserId, profile?._id),
  );
}

export async function linkToGuest(
  ctx: MutationCtx,
  args: {
    posCustomerId: Id<"posCustomer">;
    guestId: Id<"guest">;
  },
): Promise<CommandResult<CustomerAttributionResult>> {
  const posCustomer = await getPosCustomerById(ctx, args.posCustomerId);
  const guest = await getGuestById(ctx, args.guestId);

  if (!posCustomer || !guest) {
    return userError({
      code: "not_found",
      message: "Customer or guest not found.",
    });
  }

  await patchPosCustomer(ctx, args.posCustomerId, {
    linkedGuestId: args.guestId,
    email: guest.email || posCustomer.email,
    phone: guest.phoneNumber || posCustomer.phone,
  });
  const updatedPosCustomer =
    (await getPosCustomerById(ctx, args.posCustomerId)) ?? posCustomer;

  const profile = await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: args.posCustomerId,
    guestId: args.guestId,
    fallbackStoreId: posCustomer.storeId,
  });

  return ok(guestResult(updatedPosCustomer, args.guestId, profile?._id));
}

export async function resolveStoreFrontUserMatch(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    storeFrontUserId: Id<"storeFrontUser">;
  },
): Promise<CommandResult<CustomerAttributionResult>> {
  const storeFrontUser = await getStoreFrontUserById(
    ctx,
    args.storeFrontUserId,
  );

  if (!storeFrontUser || storeFrontUser.storeId !== args.storeId) {
    return userError({
      code: "not_found",
      message: "Storefront user not found.",
    });
  }

  const linkedCustomer = await findPosCustomerByStoreFrontUser(
    ctx,
    args.storeFrontUserId,
  );
  const emailCustomer = storeFrontUser.email
    ? await findCustomerByEmail(ctx, {
        storeId: args.storeId,
        email: storeFrontUser.email.trim().toLowerCase(),
      })
    : null;
  const phoneCustomer = storeFrontUser.phoneNumber
    ? await findCustomerByPhone(ctx, {
        storeId: args.storeId,
        phone: storeFrontUser.phoneNumber,
      })
    : null;
  const reusableCustomer = linkedCustomer ?? emailCustomer ?? phoneCustomer;

  if (
    emailCustomer &&
    phoneCustomer &&
    emailCustomer._id !== phoneCustomer._id &&
    !linkedCustomer
  ) {
    return userError({
      code: "conflict",
      message:
        "Storefront customer email and phone match different POS customers. Select a POS customer before linking.",
    });
  }

  let posCustomer = reusableCustomer;
  if (posCustomer) {
    await patchPosCustomer(ctx, posCustomer._id, {
      linkedStoreFrontUserId: args.storeFrontUserId,
      email: storeFrontUser.email.trim().toLowerCase(),
      phone: storeFrontUser.phoneNumber || posCustomer.phone,
    });
    posCustomer =
      (await getPosCustomerById(ctx, posCustomer._id)) ?? posCustomer;
  } else {
    const posCustomerId = await createPosCustomer(ctx, {
      storeId: args.storeId,
      name: fullNameFromParts({
        firstName: storeFrontUser.firstName,
        lastName: storeFrontUser.lastName,
        fallbackEmail: storeFrontUser.email,
      }),
      email: storeFrontUser.email.trim().toLowerCase(),
      phone: storeFrontUser.phoneNumber,
      linkedStoreFrontUserId: args.storeFrontUserId,
      totalSpent: 0,
      transactionCount: 0,
      loyaltyPoints: 0,
      isActive: true,
    });
    posCustomer = await getPosCustomerById(ctx, posCustomerId);
  }

  if (!posCustomer) {
    return userError({
      code: "not_found",
      message: "POS customer could not be resolved for this storefront user.",
    });
  }

  const profile = await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: posCustomer._id,
    storeFrontUserId: args.storeFrontUserId,
    fallbackStoreId: args.storeId,
  });

  return ok(storefrontResult(posCustomer, args.storeFrontUserId, profile?._id));
}

export async function resolveGuestMatch(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    guestId: Id<"guest">;
  },
): Promise<CommandResult<CustomerAttributionResult>> {
  const guest = await getGuestById(ctx, args.guestId);

  if (!guest || guest.storeId !== args.storeId) {
    return userError({
      code: "not_found",
      message: "Guest not found.",
    });
  }

  const linkedCustomer = await findPosCustomerByGuest(ctx, args);
  const emailCustomer = guest.email
    ? await findCustomerByEmail(ctx, {
        storeId: args.storeId,
        email: guest.email.trim().toLowerCase(),
      })
    : null;
  const phoneCustomer = guest.phoneNumber
    ? await findCustomerByPhone(ctx, {
        storeId: args.storeId,
        phone: guest.phoneNumber,
      })
    : null;
  const reusableCustomer = linkedCustomer ?? emailCustomer ?? phoneCustomer;

  if (
    emailCustomer &&
    phoneCustomer &&
    emailCustomer._id !== phoneCustomer._id &&
    !linkedCustomer
  ) {
    return userError({
      code: "conflict",
      message:
        "Guest email and phone match different POS customers. Select a POS customer before linking.",
    });
  }

  let posCustomer = reusableCustomer;
  if (posCustomer) {
    await patchPosCustomer(ctx, posCustomer._id, {
      linkedGuestId: args.guestId,
      email: guest.email?.trim().toLowerCase() || posCustomer.email,
      phone: guest.phoneNumber || posCustomer.phone,
    });
    posCustomer =
      (await getPosCustomerById(ctx, posCustomer._id)) ?? posCustomer;
  } else {
    const posCustomerId = await createPosCustomer(ctx, {
      storeId: args.storeId,
      name: fullNameFromParts({
        firstName: guest.firstName,
        lastName: guest.lastName,
        fallbackEmail: guest.email,
      }),
      email: guest.email?.trim().toLowerCase(),
      phone: guest.phoneNumber,
      linkedGuestId: args.guestId,
      totalSpent: 0,
      transactionCount: 0,
      loyaltyPoints: 0,
      isActive: true,
    });
    posCustomer = await getPosCustomerById(ctx, posCustomerId);
  }

  if (!posCustomer) {
    return userError({
      code: "not_found",
      message: "POS customer could not be resolved for this guest.",
    });
  }

  const profile = await ensureCustomerProfileFromSources(ctx, {
    posCustomerId: posCustomer._id,
    guestId: args.guestId,
    fallbackStoreId: args.storeId,
  });

  return ok(guestResult(posCustomer, args.guestId, profile?._id));
}
