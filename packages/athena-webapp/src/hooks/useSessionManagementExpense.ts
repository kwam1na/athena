import { useCallback } from "react";
import { toast } from "sonner";

import { Id } from "../../convex/_generated/dataModel";
import { type NormalizedCommandResult } from "../lib/errors/runCommand";
import { logger } from "../lib/logger";
import { useExpenseStore } from "../stores/expenseStore";
import { useExpenseLocalRuntime } from "./useExpenseLocalRuntime";

type ExpenseActorId = Id<"staffProfile">;

function getCommandErrorMessage<T>(
  result: Exclude<NormalizedCommandResult<T>, { kind: "ok" }>,
) {
  return result.kind === "user_error"
    ? result.error.message
    : result.error.message;
}

/**
 * Hook for Expense Session Management
 *
 * Handles expense session lifecycle: create, hold, resume, void.
 * Simplified version of POS session management (no customer, no payments).
 */
export const useSessionManagementExpense = () => {
  const store = useExpenseStore();
  const currentStaffProfileId = store.cashier.id;
  const { expenseLocalGateway } = useExpenseLocalRuntime({
    staffProfileId: currentStaffProfileId || null,
    storeId: store.storeId,
    syncEnabled: false,
    terminalId: store.terminalId,
  });

  const createSession = useCallback(
    async (storeId: Id<"store">, staffProfileId?: ExpenseActorId) => {
      logger.info("[Expense] Creating new session", {
        storeId,
        staffProfileId,
        registerNumber: store.ui.registerNumber,
        terminalId: store.terminalId,
      });

      const terminalId = store.terminalId;
      if (!terminalId) {
        toast.error("Terminal details missing");
        throw new Error("Terminal details missing");
      }

      const sessionStaffProfileId =
        staffProfileId !== undefined ? staffProfileId : currentStaffProfileId;

      if (!sessionStaffProfileId) {
        toast.error("Staff profile missing");
        throw new Error("Staff profile missing");
      }

      try {
        store.setSessionCreating(true);
        store.clearCart();
        logger.debug("[Expense] Cleared cart before creating new session");

        const result = await expenseLocalGateway.startSession({
          storeId,
          staffProfileId: sessionStaffProfileId,
          registerNumber: store.ui.registerNumber,
          terminalId,
        });

        if (result.kind !== "ok") {
          throw new Error(getCommandErrorMessage(result));
        }

        store.setCurrentSessionId(
          result.data.localExpenseSessionId as Id<"expenseSession">,
        );
        store.setSessionExpiresAt(null);

        logger.info("[Expense] Session created successfully", {
          sessionId: result.data.localExpenseSessionId,
          registerNumber: store.ui.registerNumber,
          staffProfileId,
        });

        return result.data.localExpenseSessionId as Id<"expenseSession">;
      } catch (error) {
        logger.error("[Expense] Failed to create session", error as Error);
        throw error;
      } finally {
        store.setSessionCreating(false);
      }
    },
    [currentStaffProfileId, expenseLocalGateway, store],
  );

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
        logger.warn("[Expense] Attempted to update session without active session");
        return { success: false, error };
      }

      logger.debug("[Expense] Session updated successfully", {
        sessionId,
        hasNotes: !!updates.notes,
      });
      return { success: true };
    },
    [store],
  );

  const holdSession = useCallback(async (): Promise<
    { success: true } | { success: false; error: string }
  > => {
    const sessionId = store.session.currentSessionId;

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

    if (!store.storeId || !store.terminalId) {
      const error = "Terminal details missing";
      toast.error(error);
      return { success: false, error };
    }

    const savedLocally = await expenseLocalGateway.holdSession({
      terminalId: store.terminalId,
      storeId: store.storeId,
      staffProfileId: currentStaffProfileId,
      localExpenseSessionId: sessionId as string,
    });

    if (!savedLocally) {
      const errorMessage = "Unable to hold this expense session locally.";
      logger.error("[Expense] Failed to hold session", {
        sessionId,
        message: errorMessage,
      });
      return { success: false, error: errorMessage };
    }

    store.setSessionExpiresAt(null);
    store.setCurrentSessionId(null);
    store.setActiveSession(null);
    store.startNewTransaction();

    logger.info("[Expense] Session held successfully", {
      sessionId,
      itemsHeld: store.cart.items.length,
    });
    toast.success("Session held");
    return { success: true };
  }, [currentStaffProfileId, expenseLocalGateway, store]);

  const resumeSession = useCallback(
    async (
      sessionId: Id<"expenseSession">,
      staffProfileId: ExpenseActorId,
      terminalId: Id<"posTerminal">,
    ): Promise<
      | {
          success: true;
          data: { sessionId: Id<"expenseSession">; expiresAt: number };
        }
      | { success: false; error: string }
    > => {
      logger.info("[Expense] Resuming held session", { sessionId });

      if (!store.storeId) {
        const error = "Store details missing";
        toast.error(error);
        return { success: false, error };
      }

      const savedLocally = await expenseLocalGateway.resumeSession({
        terminalId,
        storeId: store.storeId,
        staffProfileId,
        localExpenseSessionId: sessionId as string,
      });

      if (!savedLocally) {
        const errorMessage = "Unable to resume this expense session locally.";
        logger.error("[Expense] Failed to resume session", {
          sessionId,
          message: errorMessage,
        });
        return { success: false, error: errorMessage };
      }

      store.setCurrentSessionId(sessionId);
      store.setSessionExpiresAt(null);
      toast.success("Session resumed");

      return { success: true, data: { sessionId, expiresAt: 0 } };
    },
    [expenseLocalGateway, store],
  );

  const voidSession = useCallback(async (): Promise<
    { success: true } | { success: false; error: string }
  > => {
    const sessionId = store.session.currentSessionId;

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

    if (!currentStaffProfileId || !store.storeId || !store.terminalId) {
      const error = "Terminal or staff details missing";
      toast.error(error);
      return { success: false, error };
    }

    const savedLocally = await expenseLocalGateway.voidSession({
      terminalId: store.terminalId,
      storeId: store.storeId,
      staffProfileId: currentStaffProfileId,
      localExpenseSessionId: sessionId as string,
    });

    if (!savedLocally) {
      const errorMessage = "Unable to void this expense session locally.";
      logger.error("[Expense] Failed to void session", {
        sessionId,
        message: errorMessage,
      });
      return { success: false, error: errorMessage };
    }

    store.setCurrentSessionId(null);
    store.setActiveSession(null);
    store.startNewTransaction();

    logger.info("[Expense] Session voided successfully", { sessionId });
    return { success: true };
  }, [currentStaffProfileId, expenseLocalGateway, store]);

  return {
    createSession,
    updateSession,
    holdSession,
    resumeSession,
    voidSession,
  };
};
