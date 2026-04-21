import { useMutation, useQuery } from "convex/react";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

export function useConvexPosCustomerSearch(
  storeId: Id<"store"> | undefined,
  searchQuery: string,
) {
  return useQuery(
    api.pos.public.customers.searchCustomers,
    storeId && searchQuery.trim().length > 0 ? { storeId, searchQuery } : "skip",
  );
}

export function useConvexPosCustomerCreate() {
  const createCustomer = useMutation(api.pos.public.customers.createCustomer);

  return async (customerData: {
    storeId: Id<"store">;
    name: string;
    email?: string;
    phone?: string;
    address?: {
      street?: string;
      city?: string;
      state?: string;
      zipCode?: string;
      country?: string;
    };
    notes?: string;
  }) => {
    try {
      const customer = await createCustomer(customerData);
      return { success: true as const, customer };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : "Failed to create customer",
      };
    }
  };
}

export function useConvexPosCustomerUpdate() {
  const updateCustomer = useMutation(api.pos.public.customers.updateCustomer);

  return async (
    customerId: Id<"posCustomer">,
    updates: {
      name?: string;
      email?: string;
      phone?: string;
      address?: {
        street?: string;
        city?: string;
        state?: string;
        zipCode?: string;
        country?: string;
      };
      notes?: string;
    },
  ) => {
    try {
      await updateCustomer({ customerId, ...updates });
      return { success: true as const };
    } catch (error) {
      return {
        success: false as const,
        error:
          error instanceof Error ? error.message : "Failed to update customer",
      };
    }
  };
}
