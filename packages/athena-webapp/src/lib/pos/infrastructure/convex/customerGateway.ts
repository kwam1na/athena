import { useMutation, useQuery } from "convex/react";
import {
  type NormalizedCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";

import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";

export function useConvexPosCustomerSearch(
  storeId: Id<"store"> | undefined,
  searchQuery: string,
) {
  return useQuery(
    api.pos.public.customers.searchCustomers,
    storeId && searchQuery.trim().length > 0
      ? { storeId, searchQuery }
      : "skip",
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
  }): Promise<
    NormalizedCommandResult<{
      _id?: Id<"posCustomer">;
      name: string;
      email?: string;
      phone?: string;
      customerProfileId?: Id<"customerProfile">;
      attribution: {
        kind: "pos_customer" | "storefront_user" | "guest" | "sale_only";
        posCustomerId?: Id<"posCustomer">;
        storeFrontUserId?: Id<"storeFrontUser">;
        guestId?: Id<"guest">;
        customerProfileId?: Id<"customerProfile">;
        reusable: boolean;
      };
    }>
  > => runCommand(() => createCustomer(customerData));
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
  ): Promise<NormalizedCommandResult<null>> =>
    runCommand(() => updateCustomer({ customerId, ...updates }));
}
