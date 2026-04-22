import { useCallback } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useExpenseStore } from "../stores/expenseStore";
import { Id } from "../../convex/_generated/dataModel";
import { logger } from "../lib/logger";
import { useExpenseActiveSession } from "./useExpenseSessions";
import { useGetTerminal } from "./useGetTerminal";

type ExpenseActorId = Id<"staffProfile"> | Id<"cashier">;

const toStaffProfileId = (actorId: ExpenseActorId) =>
  actorId as unknown as Id<"staffProfile">;

/**
 * Hook for Expense Session Management
 *
 * Handles expense session lifecycle: create, hold, resume, void.
 * Simplified version of POS session management (no customer, no payments).
 */
export const useSessionManagementExpense = () => {
  const store = useExpenseStore();
  const terminal = useGetTerminal();
  const currentStaffProfileId = store.cashier.id as unknown as
    | Id<"staffProfile">
    | null;
  const activeSession = useExpenseActiveSession(
    store.storeId,
    terminal?._id,
    currentStaffProfileId || undefined
  );

  // Convex mutations
  const createSessionMutation = useMutation(
    api.inventory.expenseSessions.createExpenseSession
  );
  const updateSessionMutation = useMutation(
    api.inventory.expenseSessions.updateExpenseSession
  );
  const holdSessionMutation = useMutation(
    api.inventory.expenseSessions.holdExpenseSession
  );
  const resumeSessionMutation = useMutation(
    api.inventory.expenseSessions.resumeExpenseSession
  );
  const voidSessionMutation = useMutation(
    api.inventory.expenseSessions.voidExpenseSession
  );
  const releaseSessionInventoryHoldsAndDeleteItemsMutation = useMutation(
    api.inventory.expenseSessions
      .releaseExpenseSessionInventoryHoldsAndDeleteItems
  );

  /**
   * Creates a new expense session
   */
  const createSession = useCallback(
    async (storeId: Id<"store">, staffProfileId?: ExpenseActorId) => {
      logger.info("[Expense] Creating new session", {
        storeId,
        staffProfileId,
        registerNumber: store.ui.registerNumber,
        terminalId: store.terminalId,
      });

      if (!store.terminalId) {
        toast.error("Terminal details missing");
        throw new Error("Terminal details missing");
      }

      const sessionStaffProfileId =
        staffProfileId !== undefined
          ? toStaffProfileId(staffProfileId)
          : currentStaffProfileId;

      if (!sessionStaffProfileId) {
        toast.error("Staff profile missing");
        throw new Error("Staff profile missing");
      }

      try {
        store.setSessionCreating(true);
        store.clearCart();
        logger.debug("[Expense] Cleared cart before creating new session");

        const result = await createSessionMutation({
          storeId,
          staffProfileId: sessionStaffProfileId,
          registerNumber: store.ui.registerNumber,
          terminalId: store.terminalId,
        });

        if (!result.success) {
          throw new Error(result.message);
        }

        store.setCurrentSessionId(result.data.sessionId);
        store.setSessionExpiresAt(result.data.expiresAt);

        logger.info("[Expense] Session created successfully", {
          sessionId: result.data.sessionId,
          expiresAt: result.data.expiresAt,
          registerNumber: store.ui.registerNumber,
          staffProfileId,
        });

        toast.success("New expense session created");

        return result.data.sessionId;
      } catch (error) {
        logger.error("[Expense] Failed to create session", error as Error);
        toast.error((error as Error).message);
        throw error;
      } finally {
        store.setSessionCreating(false);
      }
    },
    [createSessionMutation, currentStaffProfileId, store]
  );

  /**
   * Updates expense session metadata (notes)
   */
  const updateSession = useCallback(
    async (updates: {
      staffProfileId: ExpenseActorId;
      notes?: string;
    }): Promise<{ success: true } | { success: false; error: string }> => {
      const sessionId = store.session.currentSessionId;

      logger.debug("[Expense] Updating session metadata", {
        sessionId,
        hasNotes: !!updates.notes,
      });

      if (!sessionId) {
        const error = "No active session to update";
        logger.warn(
          "[Expense] Attempted to update session without active session"
        );
        return { success: false, error };
      }

      try {
        const result = await updateSessionMutation({
          sessionId: sessionId as Id<"expenseSession">,
          ...updates,
          staffProfileId: toStaffProfileId(updates.staffProfileId),
        });

        store.setSessionExpiresAt(result.expiresAt);

        logger.debug("[Expense] Session updated successfully", {
          sessionId: result.sessionId,
          expiresAt: result.expiresAt,
        });
        return { success: true };
      } catch (error) {
        const errorMessage = (error as Error).message;
        logger.error("[Expense] Failed to update session", error as Error);
        return { success: false, error: errorMessage };
      }
    },
    [updateSessionMutation, store]
  );

  /**
   * Holds/suspends the current expense session
   */
  const holdSession = useCallback(async (): Promise<
    { success: true } | { success: false; error: string }
  > => {
    const sessionId = activeSession?._id;

    logger.info("[Expense] Holding session", {
      sessionId,
      cartItemCount: store.cart.items.length,
      cartTotal: store.cart.total,
    });

    if (!sessionId) {
      const error = "No active session to hold";
      logger.error("[Expense] Cannot hold: No active session");
      toast.error(error);
      return { success: false, error };
    }

    if (!currentStaffProfileId) {
      const error = "No staff profile available for this session";
      logger.error("[Expense] Cannot hold: Missing staff profile");
      toast.error(error);
      return { success: false, error };
    }

    try {
      const result = await holdSessionMutation({
        sessionId: sessionId as Id<"expenseSession">,
        staffProfileId: currentStaffProfileId,
      });

      if (!result.success) {
        logger.error("[Expense] Failed to hold session", {
          sessionId,
          message: result.message,
        });
        toast.error(result.message);
        return { success: false, error: result.message };
      }

      store.setSessionExpiresAt(result.data.expiresAt);
      store.setCurrentSessionId(null);
      store.setActiveSession(null);
      store.startNewTransaction();

      logger.info("[Expense] Session held successfully", {
        sessionId,
        itemsHeld: store.cart.items.length,
      });
      toast.success("Session held");
      return { success: true };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(
        "[Expense] Unexpected error holding session",
        error as Error
      );
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [activeSession, currentStaffProfileId, holdSessionMutation, store]);

  /**
   * Resumes a held expense session
   */
  const resumeSession = useCallback(
    async (
      sessionId: Id<"expenseSession">,
      staffProfileId: ExpenseActorId,
      terminalId: Id<"posTerminal">
    ): Promise<
      | {
          success: true;
          data: { sessionId: Id<"expenseSession">; expiresAt: number };
        }
      | { success: false; error: string }
    > => {
      logger.info("[Expense] Resuming held session", { sessionId });

      try {
        const result = await resumeSessionMutation({
          sessionId,
          staffProfileId: toStaffProfileId(staffProfileId),
          terminalId,
        });

        if (!result.success) {
          toast.error(result.message);
          return { success: false, error: result.message };
        }

        store.setSessionExpiresAt(result.data.expiresAt);
        toast.success("Session resumed");

        return { success: true, data: result.data };
      } catch (error) {
        const errorMessage = (error as Error).message;
        logger.error("[Expense] Unexpected error resuming session", {
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
   * Voids the current expense session
   */
  const voidSession = useCallback(async (): Promise<
    { success: true } | { success: false; error: string }
  > => {
    const sessionId = activeSession?._id;

    logger.info("[Expense] Voiding session", {
      sessionId,
      cartItemCount: store.cart.items.length,
    });

    if (!sessionId) {
      const error = "No active session to void";
      logger.error("[Expense] Cannot void: No active session");
      toast.error(error);
      return { success: false, error };
    }

    try {
      const result = await voidSessionMutation({
        sessionId: sessionId as Id<"expenseSession">,
      });

      if (!result.success) {
        logger.error("[Expense] Failed to void session", {
          sessionId,
          message: result.message,
        });
        toast.error(result.message);
        return { success: false, error: result.message };
      }

      // Clear session state
      store.setCurrentSessionId(null);
      store.setActiveSession(null);
      store.startNewTransaction();

      logger.info("[Expense] Session voided successfully", { sessionId });
      toast.success("Session voided");
      return { success: true };
    } catch (error) {
      const errorMessage = (error as Error).message;
      logger.error(
        "[Expense] Unexpected error voiding session",
        error as Error
      );
      toast.error(errorMessage);
      return { success: false, error: errorMessage };
    }
  }, [voidSessionMutation, store, activeSession]);

  /**
   * Releases inventory holds and deletes items for a session
   */
  const releaseSessionInventoryHoldsAndDeleteItems = useCallback(
    async (
      sessionId: Id<"expenseSession">
    ): Promise<{ success: true } | { success: false; error: string }> => {
      logger.info("[Expense] Releasing inventory holds and deleting items", {
        sessionId,
      });

      try {
        const result = await releaseSessionInventoryHoldsAndDeleteItemsMutation(
          {
            sessionId,
          }
        );

        if (!result.success) {
          logger.error("[Expense] Failed to release holds", {
            sessionId,
            message: result.message,
          });
          return { success: false, error: result.message };
        }

        logger.info("[Expense] Inventory holds released successfully", {
          sessionId,
        });
        return { success: true };
      } catch (error) {
        const errorMessage = (error as Error).message;
        logger.error(
          "[Expense] Unexpected error releasing holds",
          error as Error
        );
        return { success: false, error: errorMessage };
      }
    },
    [releaseSessionInventoryHoldsAndDeleteItemsMutation]
  );

  return {
    createSession,
    updateSession,
    holdSession,
    resumeSession,
    voidSession,
    releaseSessionInventoryHoldsAndDeleteItems,
  };
};
