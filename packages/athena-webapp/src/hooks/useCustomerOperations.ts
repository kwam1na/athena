import { useCallback, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePOSStore } from "../stores/posStore";
import { CustomerInfo } from "../components/pos/types";
import { usePOSCustomerUpdate, usePOSCustomerSearch } from "./usePOSCustomers";
import { validateCustomer } from "../lib/pos/validation";
import { logger } from "../lib/logger";
import {
  handlePOSOperation,
  POS_MESSAGES,
  showValidationError,
} from "../lib/pos/toastService";

/**
 * Hook for POS Customer Operations
 *
 * Handles customer search, selection, creation, and updates.
 * Focused on customer management only.
 */
export const useCustomerOperations = () => {
  const store = usePOSStore();

  // Convex mutations
  const createCustomerMutation = useMutation(
    api.inventory.posCustomers.createCustomer
  );

  // Customer update hook
  const updateCustomerHook = usePOSCustomerUpdate();

  // Customer search query hook
  const searchResults = usePOSCustomerSearch(
    store.storeId || undefined,
    store.customer.searchQuery
  );

  // Update store when search results change
  useEffect(() => {
    if (searchResults !== undefined) {
      logger.debug("[POS] Customer search results received", {
        resultCount: searchResults.length,
        query: store.customer.searchQuery,
      });
      const mappedResults = searchResults.map((customer) => ({
        customerId: customer._id,
        name: customer.name,
        email: customer.email || "",
        phone: customer.phone || "",
      }));
      store.setCustomerSearchResults(mappedResults);
      store.setCustomerSearching(false);
    } else if (store.customer.searchQuery.trim()) {
      store.setCustomerSearching(true);
    }
  }, [searchResults, store]);

  /**
   * Searches for customers using real-time Convex query
   */
  const searchCustomers = useCallback(
    async (query: string) => {
      logger.info("[POS] Customer search initiated", { query });

      try {
        if (!query.trim()) {
          logger.debug("[POS] Empty search query, clearing results");
          store.setCustomerSearchResults([]);
          store.setCustomerSearching(false);
          store.setCustomerSearchQuery("");
          return;
        }

        store.setCustomerSearching(true);
        store.setCustomerSearchQuery(query);
        // Results will be updated automatically via the useEffect above
        logger.debug("[POS] Customer search query set, waiting for results");
      } catch (error) {
        logger.error("[POS] Customer search failed", error as Error);
        store.setCustomerSearchResults([]);
        showValidationError([POS_MESSAGES.customer.searchFailed]);
        store.setCustomerSearching(false);
      }
    },
    [store]
  );

  /**
   * Selects a customer for the current transaction
   */
  const selectCustomer = useCallback(
    (customer: CustomerInfo) => {
      logger.info("[POS] Customer selected for transaction", {
        customerId: customer.customerId,
        customerName: customer.name,
        hasEmail: !!customer.email,
        hasPhone: !!customer.phone,
      });

      store.setCustomer(customer);
      store.setCustomerSearchQuery("");
      store.setCustomerSearchResults([]);
      store.setShowCustomerPanel(false);
    },
    [store]
  );

  /**
   * Updates customer information without closing the panel
   */
  const updateCustomerInfo = useCallback(
    (customer: CustomerInfo) => {
      logger.debug("[POS] Customer info updated (form)", {
        customerId: customer.customerId,
        customerName: customer.name,
      });
      store.setCustomer(customer);
    },
    [store]
  );

  /**
   * Creates a new customer
   */
  const createCustomer = useCallback(
    async (customerData: Omit<CustomerInfo, "customerId">) => {
      logger.info("[POS] Creating new customer", {
        name: customerData.name,
        hasEmail: !!customerData.email,
        hasPhone: !!customerData.phone,
      });

      // Validate customer data
      const validation = validateCustomer({
        ...customerData,
        customerId: undefined,
      });

      if (!validation.isValid) {
        logger.warn("[POS] Customer validation failed", {
          errors: validation.errors,
        });
        showValidationError(validation.errors);
        return {
          success: false,
          error: validation.errors[0],
        };
      }

      if (!store.storeId) {
        logger.error("[POS] Cannot create customer: Store ID not set");
        return {
          success: false,
          error: "Store ID not set",
        };
      }

      const { success, data, error } = await handlePOSOperation(
        () =>
          createCustomerMutation({
            storeId: store.storeId!,
            name: customerData.name || "",
            email: customerData.email || "",
            phone: customerData.phone || "",
          }),
        {
          successMessage: (data) => POS_MESSAGES.customer.created(data.name),
          onSuccess: (data) => {
            const newCustomer: CustomerInfo = {
              customerId: data._id,
              name: data.name,
              email: data.email || "",
              phone: data.phone || "",
            };
            // Set as current customer and close panel
            store.setCustomer(newCustomer);
            store.setShowCustomerPanel(false);
          },
        }
      );

      if (!success || !data) {
        return {
          success: false,
          error: error || "Failed to create customer",
        };
      }

      const newCustomer: CustomerInfo = {
        customerId: data._id,
        name: data.name,
        email: data.email || "",
        phone: data.phone || "",
      };

      logger.info("[POS] Customer created successfully", {
        customerId: newCustomer.customerId,
        customerName: newCustomer.name,
      });

      return {
        success: true,
        customer: newCustomer,
      };
    },
    [createCustomerMutation, store]
  );

  /**
   * Updates an existing customer
   */
  const updateCustomer = useCallback(
    async (customer: CustomerInfo) => {
      logger.info("[POS] Updating customer", {
        customerId: customer.customerId,
        customerName: customer.name,
      });

      if (!customer.customerId) {
        logger.error("[POS] Cannot update customer: No customer ID");
        showValidationError([POS_MESSAGES.customer.noIdForUpdate]);
        return { success: false, error: "No customer ID" };
      }

      // Validate customer data
      const validation = validateCustomer(customer);
      if (!validation.isValid) {
        logger.warn("[POS] Customer validation failed on update", {
          errors: validation.errors,
        });
        showValidationError(validation.errors);
        return {
          success: false,
          error: validation.errors[0],
        };
      }

      const { success, error } = await handlePOSOperation(
        () =>
          updateCustomerHook(customer.customerId!, {
            name: customer.name,
            email: customer.email,
            phone: customer.phone,
          }),
        {
          successMessage: POS_MESSAGES.customer.updated(customer.name),
          onSuccess: () => {
            // Update the current customer in the store
            store.setCustomer(customer);
          },
        }
      );

      if (!success) {
        logger.error("[POS] Customer update failed", { error });
        return { success: false, error };
      }

      logger.info("[POS] Customer updated successfully", {
        customerId: customer.customerId,
        customerName: customer.name,
      });

      return { success: true };
    },
    [updateCustomerHook, store]
  );

  /**
   * Clears the current customer
   */
  const clearCustomer = useCallback(() => {
    logger.info("[POS] Customer cleared from transaction", {
      clearedCustomerId: store.customer.current?.customerId,
      clearedCustomerName: store.customer.current?.name,
    });
    store.clearCustomer();
  }, [store]);

  /**
   * Toggles customer panel visibility
   */
  const toggleCustomerPanel = useCallback(
    (show?: boolean) => {
      const shouldShow =
        show !== undefined ? show : !store.ui.showCustomerPanel;
      logger.debug("[POS] Customer panel toggled", { show: shouldShow });
      store.setShowCustomerPanel(shouldShow);
    },
    [store]
  );

  return {
    // Operations
    searchCustomers,
    selectCustomer,
    updateCustomerInfo,
    createCustomer,
    updateCustomer,
    clearCustomer,
    toggleCustomerPanel,

    // State (from store)
    currentCustomer: store.customer.current,
    hasCustomer: !!store.customer.current,
    searchQuery: store.customer.searchQuery,
    searchResults: store.customer.searchResults,
    isSearching: store.customer.isSearching,
    isCustomerPanelOpen: store.ui.showCustomerPanel,
  };
};
