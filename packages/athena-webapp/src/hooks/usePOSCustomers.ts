import { useQuery, useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Id } from "~/convex/_generated/dataModel";
import { POSCustomer, POSCustomerSummary } from "~/types";

// Hook to search customers
export function usePOSCustomerSearch(
  storeId: Id<"store"> | undefined,
  searchQuery: string
) {
  return useQuery(
    api.inventory.posCustomers.searchCustomers,
    storeId && searchQuery.trim().length > 0 ? { storeId, searchQuery } : "skip"
  );
}

// Hook to get customer by ID
export function usePOSCustomer(customerId: Id<"posCustomer"> | undefined) {
  return useQuery(
    api.inventory.posCustomers.getCustomerById,
    customerId ? { customerId } : "skip"
  );
}

// Hook to create a new customer
export function usePOSCustomerCreate() {
  const createCustomer = useMutation(api.inventory.posCustomers.createCustomer);

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
      return { success: true, customer };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to create customer",
      };
    }
  };
}

// Hook to update customer
export function usePOSCustomerUpdate() {
  const updateCustomer = useMutation(api.inventory.posCustomers.updateCustomer);

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
    }
  ) => {
    try {
      await updateCustomer({ customerId, ...updates });
      return { success: true };
    } catch (error) {
      return {
        success: false,
        error:
          error instanceof Error ? error.message : "Failed to update customer",
      };
    }
  };
}

// Hook to get customer transaction history
export function usePOSCustomerTransactions(
  customerId: Id<"posCustomer"> | undefined,
  limit?: number
) {
  return useQuery(
    api.inventory.posCustomers.getCustomerTransactions,
    customerId ? { customerId, limit } : "skip"
  );
}
