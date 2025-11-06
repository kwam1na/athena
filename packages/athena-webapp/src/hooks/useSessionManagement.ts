import { useCallback } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { usePOSStore } from "../stores/posStore";
import { Id } from "../../convex/_generated/dataModel";
import { logger } from "../lib/logger";
import { usePOSActiveSession } from "./usePOSSessions";

/**
 * Hook for POS Session Management
 *
 * Handles session lifecycle: create, hold, resume, void.
 * Focused on session state management only - cart and transaction logic elsewhere.
 */
export const useSessionManagement = () => {
  const store = usePOSStore();

  const activeSession = usePOSActiveSession(store.storeId);

  // Convex mutations
  const createSessionMutation = useMutation(
    api.inventory.posSessions.createSession
  );
  const updateSessionMutation = useMutation(
    api.inventory.posSessions.updateSession
  );
  const holdSessionMutation = useMutation(
    api.inventory.posSessions.holdSession
  );
  const resumeSessionMutation = useMutation(
    api.inventory.posSessions.resumeSession
  );
  const voidSessionMutation = useMutation(
    api.inventory.posSessions.voidSession
  );
  const releaseSessionInventoryHoldsAndDeleteItemsMutation = useMutation(
    api.inventory.posSessions.releaseSessionInventoryHoldsAndDeleteItems
  );

  /**
   * Creates a new session
   */
  const createSession = useCallback(
    async (storeId: Id<"store">) => {
      logger.info("[POS] Creating new session", {
        storeId,
        registerNumber: store.ui.registerNumber,
      });

      try {
        store.setSessionCreating(true);

        // Clear cart state before creating new session
        store.clearCart();
        logger.debug("[POS] Cleared cart before creating new session");

        const result = await createSessionMutation({
          storeId,
          registerNumber: store.ui.registerNumber,
        });

        store.setCurrentSessionId(result.sessionId);
        store.setSessionExpiresAt(result.expiresAt);

        logger.info("[POS] Session created successfully", {
          sessionId: result.sessionId,
          expiresAt: result.expiresAt,
          registerNumber: store.ui.registerNumber,
        });

        toast.success("New session created");

        return result.sessionId;
      } catch (error) {
        logger.error("[POS] Failed to create session", error as Error);
        toast.error((error as Error).message);
        throw error;
      } finally {
        store.setSessionCreating(false);
      }
    },
    [createSessionMutation, store]
  );

  /**
   * Updates session metadata (customer info, totals)
   */
  const updateSession = useCallback(
    async (updates: {
      customerId?: Id<"posCustomer">;
      customerInfo?: {
        name?: string;
        email?: string;
        phone?: string;
      };
      subtotal?: number;
      tax?: number;
      total?: number;
    }): Promise<{ success: true } | { success: false; error: string }> => {
      const sessionId = store.session.currentSessionId;

      logger.debug("[POS] Updating session metadata", {
        sessionId,
        hasCustomer: !!updates.customerId,
        hasCustomerInfo: !!updates.customerInfo,
        hasTotals: updates.total !== undefined,
        total: updates.total,
      });

      if (!sessionId) {
        const error = "No active session to update";
        logger.warn("[POS] Attempted to update session without active session");
        return { success: false, error };
      }

      try {
        const result = await updateSessionMutation({
          sessionId: sessionId as Id<"posSession">,
          ...updates,
        });

        // Update session expiration time from server
        store.setSessionExpiresAt(result.expiresAt);

        logger.debug("[POS] Session updated successfully", {
          sessionId: result.sessionId,
          expiresAt: result.expiresAt,
        });
        return { success: true };
      } catch (error) {
        const errorMessage = (error as Error).message;
        logger.error("[POS] Failed to update session", error as Error);
        // Don't show toast for automatic updates
        return { success: false, error: errorMessage };
      }
    },
    [updateSessionMutation, store]
  );

  /**
   * Holds/suspends the current session
   */
  const holdSession = useCallback(
    async (
      reason?: string
    ): Promise<{ success: true } | { success: false; error: string }> => {
      const sessionId = activeSession?._id;

      logger.info("[POS] Holding session", {
        sessionId,
        reason,
        cartItemCount: store.cart.items.length,
        cartTotal: store.cart.total,
        hasCustomer: !!store.customer.current,
      });

      if (!sessionId) {
        const error = "No active session to hold";
        logger.error("[POS] Cannot hold: No active session");
        toast.error(error);
        return { success: false, error };
      }

      try {
        // First update the session with current cart state if needed
        if (store.cart.items.length > 0) {
          logger.debug("[POS] Saving session state before hold");
          await updateSession({
            customerId: store.customer.current?.customerId,
            customerInfo: store.customer.current
              ? {
                  name: store.customer.current.name,
                  email: store.customer.current.email,
                  phone: store.customer.current.phone,
                }
              : undefined,
            subtotal: store.cart.subtotal,
            tax: store.cart.tax,
            total: store.cart.total,
          });
        }

        // Then hold the session
        const result = await holdSessionMutation({
          sessionId: sessionId as Id<"posSession">,
          holdReason: reason,
        });

        if (!result.success) {
          logger.error("[POS] Failed to hold session", {
            sessionId,
            message: result.message,
          });
          toast.error(result.message);
          return { success: false, error: result.message };
        }

        // Update expiration time from server
        store.setSessionExpiresAt(result.data.expiresAt);

        // Clear current session state
        store.setCurrentSessionId(null);
        store.setActiveSession(null);
        store.startNewTransaction();

        logger.info("[POS] Session held successfully", {
          sessionId,
          itemsHeld: store.cart.items.length,
        });
        toast.success("Session held successfully");
        return { success: true };
      } catch (error) {
        // Handle unexpected errors (network, etc.)
        const errorMessage = (error as Error).message;
        logger.error("[POS] Unexpected error holding session", error as Error);
        toast.error(errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [holdSessionMutation, updateSession, store, activeSession]
  );

  /**
   * Resumes a held session
   */
  const resumeSession = useCallback(
    async (
      sessionId: Id<"posSession">
    ): Promise<
      | {
          success: true;
          data: { sessionId: Id<"posSession">; expiresAt: number };
        }
      | { success: false; error: string }
    > => {
      logger.info("[POS] Resuming held session", { sessionId });

      try {
        const result = await resumeSessionMutation({
          sessionId,
        });

        if (!result.success) {
          // Provide user-friendly error messages for inventory issues
          if (result.message.includes("no longer available")) {
            toast.error("Cannot resume session - some items are out of stock", {
              description: result.message,
              duration: 5000,
            });
          } else {
            toast.error(result.message);
          }

          return { success: false, error: result.message };
        }

        // Update expiration time from server
        store.setSessionExpiresAt(result.data.expiresAt);

        toast.success("Session resumed");

        return { success: true, data: result.data };
      } catch (error) {
        // Handle unexpected errors (network, etc.)
        const errorMessage = (error as Error).message;
        logger.error("[POS] Unexpected error resuming session", {
          sessionId,
          error: error as Error,
        });
        toast.error(errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [resumeSessionMutation, store]
  );

  /**
   * Voids a session
   */
  const voidSession = useCallback(
    async (
      sessionId: Id<"posSession">,
      reason?: string
    ): Promise<{ success: true } | { success: false; error: string }> => {
      logger.info("[POS] Voiding session", { sessionId, reason });

      try {
        const result = await voidSessionMutation({
          sessionId,
          voidReason: reason,
        });

        if (!result.success) {
          logger.error("[POS] Failed to void session", {
            sessionId,
            message: result.message,
          });
          toast.error(result.message);
          return { success: false, error: result.message };
        }

        logger.info("[POS] Session voided successfully", {
          sessionId,
          reason,
        });
        toast.success("Session voided");
        return { success: true };
      } catch (error) {
        // Handle unexpected errors (network, etc.)
        const errorMessage = (error as Error).message;
        logger.error("[POS] Unexpected error voiding session", {
          sessionId,
          error: error as Error,
        });
        toast.error(errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [voidSessionMutation]
  );

  /**
   * Releases the inventory holds for a session and deletes the items
   */
  const releaseSessionInventoryHoldsAndDeleteItems = useCallback(
    async (
      sessionId: Id<"posSession">
    ): Promise<{ success: true } | { success: false; error: string }> => {
      logger.info("[POS] Releasing session inventory holds", { sessionId });

      try {
        const result = await releaseSessionInventoryHoldsAndDeleteItemsMutation(
          {
            sessionId,
          }
        );

        if (!result.success) {
          logger.error("[POS] Failed to release session inventory holds", {
            sessionId,
            message: result.message,
          });
          toast.error(result.message);
          return { success: false, error: result.message };
        }

        logger.info("[POS] Session inventory holds released successfully", {
          sessionId,
        });

        return { success: true };
      } catch (error) {
        // Handle unexpected errors (network, etc.)
        const errorMessage = (error as Error).message;
        logger.error(
          "[POS] Unexpected error releasing session inventory holds",
          {
            sessionId,
            error: error as Error,
          }
        );
        toast.error(errorMessage);
        return { success: false, error: errorMessage };
      }
    },
    [releaseSessionInventoryHoldsAndDeleteItemsMutation]
  );

  /**
   * Starts a new transaction (clears current state)
   */
  const startNewTransaction = useCallback(() => {
    logger.info("[POS] Starting new transaction (clearing state)");
    store.startNewTransaction();
  }, [store]);

  return {
    // Operations
    createSession,
    updateSession,
    holdSession,
    resumeSession,
    voidSession,
    releaseSessionInventoryHoldsAndDeleteItems,
    startNewTransaction,

    // State (from store)
    currentSessionId: store.session.currentSessionId,
    activeSession: store.session.activeSession,
    sessionExpiresAt: store.session.expiresAt,
    isSessionCreating: store.session.isCreating,
    hasActiveSession: !!store.session.currentSessionId,
  };
};
