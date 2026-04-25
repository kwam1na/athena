import type { Id } from "../../../_generated/dataModel";
import type { QueryCtx } from "../../../_generated/server";

import {
  findGuestByEmail,
  findGuestByPhone,
  findPosCustomerByStoreFrontUser,
  findStoreFrontUserByEmail,
  findStoreFrontUserByPhone,
  getPosCustomerById,
  listActiveCustomersForStore,
  listCompletedTransactionsForCustomer,
} from "../../infrastructure/repositories/customerRepository";

async function getCustomerProfileIdForPosCustomer(
  ctx: QueryCtx,
  customerId: Id<"posCustomer">,
) {
  const customerProfile = await ctx.db
    .query("customerProfile")
    .withIndex("by_posCustomerId", (q) => q.eq("posCustomerId", customerId))
    .first();

  return customerProfile?._id;
}

export async function searchCustomers(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    searchQuery: string;
  },
) {
  if (!args.searchQuery.trim()) {
    return [];
  }

  const searchTerm = args.searchQuery.toLowerCase().trim();
  const customers = await listActiveCustomersForStore(ctx, args.storeId);
  const filteredCustomers = customers.filter((customer) => {
    const nameMatch = customer.name.toLowerCase().includes(searchTerm);
    const emailMatch = customer.email?.toLowerCase().includes(searchTerm) || false;
    const phoneMatch = customer.phone?.includes(searchTerm) || false;

    return nameMatch || emailMatch || phoneMatch;
  });

  return Promise.all(
    filteredCustomers.slice(0, 10).map(async (customer) => ({
      _id: customer._id,
      _creationTime: customer._creationTime,
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      totalSpent: customer.totalSpent || 0,
      transactionCount: customer.transactionCount || 0,
      lastTransactionAt: customer.lastTransactionAt,
      customerProfileId: await getCustomerProfileIdForPosCustomer(
        ctx,
        customer._id,
      ),
    })),
  );
}

export async function getCustomerById(
  ctx: QueryCtx,
  args: {
    customerId: Id<"posCustomer">;
  },
) {
  return getPosCustomerById(ctx, args.customerId);
}

export async function getCustomerTransactions(
  ctx: QueryCtx,
  args: {
    customerId: Id<"posCustomer">;
    limit?: number;
  },
) {
  const transactions = await listCompletedTransactionsForCustomer(ctx, args);

  return transactions.map((transaction) => ({
    _id: transaction._id,
    _creationTime: transaction._creationTime,
    transactionNumber: transaction.transactionNumber,
    total: transaction.total,
    paymentMethod: transaction.paymentMethod,
    status: transaction.status,
    completedAt: transaction.completedAt,
  }));
}

export async function findByStoreFrontUser(
  ctx: QueryCtx,
  args: {
    storeFrontUserId: Id<"storeFrontUser">;
  },
) {
  const posCustomer = await findPosCustomerByStoreFrontUser(
    ctx,
    args.storeFrontUserId,
  );

  if (!posCustomer) {
    return null;
  }

  return {
    _id: posCustomer._id,
    _creationTime: posCustomer._creationTime,
    name: posCustomer.name,
    email: posCustomer.email,
    phone: posCustomer.phone,
    totalSpent: posCustomer.totalSpent,
    transactionCount: posCustomer.transactionCount,
    linkedStoreFrontUserId: posCustomer.linkedStoreFrontUserId,
  };
}

export async function findPotentialMatches(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    email?: string;
    phone?: string;
  },
) {
  const results = {
    storeFrontUsers: [] as Array<{
      _id: Id<"storeFrontUser">;
      email: string;
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
    }>,
    guests: [] as Array<{
      _id: Id<"guest">;
      email?: string;
      firstName?: string;
      lastName?: string;
      phoneNumber?: string;
    }>,
  };

  if (args.email) {
    const storeFrontUser = await findStoreFrontUserByEmail(ctx, {
      storeId: args.storeId,
      email: args.email,
    });
    if (storeFrontUser) {
      results.storeFrontUsers.push({
        _id: storeFrontUser._id,
        email: storeFrontUser.email,
        firstName: storeFrontUser.firstName,
        lastName: storeFrontUser.lastName,
        phoneNumber: storeFrontUser.phoneNumber,
      });
    }

    const guest = await findGuestByEmail(ctx, {
      storeId: args.storeId,
      email: args.email,
    });
    if (guest) {
      results.guests.push({
        _id: guest._id,
        email: guest.email,
        firstName: guest.firstName,
        lastName: guest.lastName,
        phoneNumber: guest.phoneNumber,
      });
    }
  }

  if (
    args.phone &&
    results.storeFrontUsers.length === 0 &&
    results.guests.length === 0
  ) {
    const storeFrontUser = await findStoreFrontUserByPhone(ctx, {
      storeId: args.storeId,
      phone: args.phone,
    });
    if (storeFrontUser) {
      results.storeFrontUsers.push({
        _id: storeFrontUser._id,
        email: storeFrontUser.email,
        firstName: storeFrontUser.firstName,
        lastName: storeFrontUser.lastName,
        phoneNumber: storeFrontUser.phoneNumber,
      });
    }

    const guest = await findGuestByPhone(ctx, {
      storeId: args.storeId,
      phone: args.phone,
    });
    if (guest) {
      results.guests.push({
        _id: guest._id,
        email: guest.email,
        firstName: guest.firstName,
        lastName: guest.lastName,
        phoneNumber: guest.phoneNumber,
      });
    }
  }

  return results;
}
