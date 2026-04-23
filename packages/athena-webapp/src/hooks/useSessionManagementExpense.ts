import { useCallback } from "react";
import { toast } from "sonner";
import { useMutation } from "convex/react";

import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { presentCommandToast } from "../lib/errors/presentCommandToast";
import {
  type NormalizedCommandResult,
  runCommand,
} from "../lib/errors/runCommand";
import { logger } from "../lib/logger";
import { useExpenseStore } from "../stores/expenseStore";
import { useExpenseActiveSession } from "./useExpenseSessions";
import { useGetTerminal } from "./useGetTerminal";

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
  const terminal = useGetTerminal();
  const currentStaffProfileId = store.cashier.id;
  const activeSession = useExpenseActiveSession(
    store.storeId,
    terminal?._id,
    currentStaffProfileId || undefined,
  );

  const createSessionMutation = useMutation(
    api.inventory.expenseSessions.createExpenseSession,
  );
  const updateSessionMutation = useMutation(
    api.inventory.expenseSessions.updateExpenseSession,
  );
  const holdSessionMutation = useMutation(
    api.inventory.expenseSessions.holdExpenseSession,
  );
  const resumeSessionMutation = useMutation(
    api.inventory.expenseSessions.resumeExpenseSession,
  );
  const voidSessionMutation = useMutation(
    api.inventory.expenseSessions.voidExpenseSession,
  );
  const releaseSessionInventoryHoldsAndDeleteItemsMutation = useMutation(
    api.inventory.expenseSessions.releaseExpenseSessionInventoryHoldsAndDeleteItems,
  );

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

        const result = await runCommand(() =>
          createSessionMutation({
            storeId,
            staffProfileId: sessionStaffProfileId,
            registerNumber: store.ui.registerNumber,
            terminalId,
          }),
        );

        if (result.kind !== "ok") {
          presentCommandToast(result);
          throw new Error(getCommandErrorMessage(result));
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
        throw error;
      } finally {
        store.setSessionCreating(false);
      }
    },
    [createSessionMutation, currentStaffProfileId, store],
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

      const result = await runCommand(() =>
        updateSessionMutation({
          sessionId: sessionId as Id<"expenseSession">,
          ...updates,
          staffProfileId: updates.staffProfileId,
        }),
      );

      if (result.kind !== "ok") {
        const errorMessage = getCommandErrorMessage(result);
        logger.error("[Expense] Failed to update session", { error: errorMessage });
        return { success: false, error: errorMessage };
      }

      store.setSessionExpiresAt(result.data.expiresAt);

      logger.debug("[Expense] Session updated successfully", {
        sessionId: result.data.sessionId,
        expiresAt: result.data.expiresAt,
      });
      return { success: true };
    },
    [store, updateSessionMutation],
  );

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

    const result = await runCommand(() =>
      holdSessionMutation({
        sessionId: sessionId as Id<"expenseSession">,
        staffProfileId: currentStaffProfileId,
      }),
    );

    if (result.kind !== "ok") {
      const errorMessage = getCommandErrorMessage(result);
      logger.error("[Expense] Failed to hold session", {
        sessionId,
        message: errorMessage,
      });
      presentCommandToast(result);
      return { success: false, error: errorMessage };
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
  }, [activeSession, currentStaffProfileId, holdSessionMutation, store]);

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

      const result = await runCommand(() =>
        resumeSessionMutation({
          sessionId,
          staffProfileId,
          terminalId,
        }),
      );

      if (result.kind !== "ok") {
        const errorMessage = getCommandErrorMessage(result);
        logger.error("[Expense] Failed to resume session", {
          sessionId,
          message: errorMessage,
        });
        presentCommandToast(result);
        return { success: false, error: errorMessage };
      }

      store.setSessionExpiresAt(result.data.expiresAt);
      toast.success("Session resumed");

      return { success: true, data: result.data };
    },
    [resumeSessionMutation, store],
  );

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

    const result = await runCommand(() =>
      voidSessionMutation({
        sessionId: sessionId as Id<"expenseSession">,
      }),
    );

    if (result.kind !== "ok") {
      const errorMessage = getCommandErrorMessage(result);
      logger.error("[Expense] Failed to void session", {
        sessionId,
        message: errorMessage,
      });
      presentCommandToast(result);
      return { success: false, error: errorMessage };
    }

    store.setCurrentSessionId(null);
    store.setActiveSession(null);
    store.startNewTransaction();

    logger.info("[Expense] Session voided successfully", { sessionId });
    toast.success("Session voided");
    return { success: true };
  }, [activeSession, store, voidSessionMutation]);

  const releaseSessionInventoryHoldsAndDeleteItems = useCallback(
    async (
      sessionId: Id<"expenseSession">,
    ): Promise<{ success: true } | { success: false; error: string }> => {
      logger.info("[Expense] Releasing inventory holds and deleting items", {
        sessionId,
      });

      const result = await runCommand(() =>
        releaseSessionInventoryHoldsAndDeleteItemsMutation({
          sessionId,
        }),
      );

      if (result.kind !== "ok") {
        const errorMessage = getCommandErrorMessage(result);
        logger.error("[Expense] Failed to release holds", {
          sessionId,
          message: errorMessage,
        });
        presentCommandToast(result);
        return { success: false, error: errorMessage };
      }

      logger.info("[Expense] Inventory holds released successfully", {
        sessionId,
      });
      return { success: true };
    },
    [releaseSessionInventoryHoldsAndDeleteItemsMutation],
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
