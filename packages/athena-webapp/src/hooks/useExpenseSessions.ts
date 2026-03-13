import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { logger } from "../lib/logger";

// Hook to get expense sessions for a store
export const useExpenseStoreSessions = (
  storeId: Id<"store"> | undefined,
  terminalId: Id<"posTerminal"> | undefined,
  cashierId?: Id<"cashier">,
  status?: "active" | "held" | "completed" | "void",
  limit?: number
) => {
  return useQuery(
    api.inventory.expenseSessions.getStoreExpenseSessions,
    storeId && cashierId
      ? { storeId, cashierId, terminalId, status, limit }
      : "skip"
  );
};

// Hook to get a specific expense session
export const useExpenseSession = (
  sessionId: Id<"expenseSession"> | undefined
) => {
  return useQuery(
    api.inventory.expenseSessions.getExpenseSessionById,
    sessionId ? { sessionId } : "skip"
  );
};

// Hook to get active expense session for current register/cashier
export const useExpenseActiveSession = (
  storeId: Id<"store"> | undefined,
  terminalId: Id<"posTerminal"> | undefined,
  cashierId?: Id<"cashier">,
  registerNumber?: string
) => {
  return useQuery(
    api.inventory.expenseSessions.getActiveExpenseSession,
    storeId && terminalId && cashierId
      ? { storeId, cashierId, terminalId, registerNumber }
      : "skip"
  );
};

// Hook to create a new expense session
export const useExpenseSessionCreate = () => {
  const createSession = useMutation(
    api.inventory.expenseSessions.createExpenseSession
  );

  return {
    createSession: async (
      storeId: Id<"store">,
      terminalId: Id<"posTerminal">,
      cashierId: Id<"cashier">,
      registerNumber?: string
    ) => {
      try {
        const result = await createSession({
          storeId,
          terminalId,
          cashierId,
          registerNumber,
        });

        if (result.success) {
          logger.debug("Expense session created successfully", {
            sessionId: result.data.sessionId,
          });
          return result.data.sessionId;
        } else {
          throw new Error(result.message);
        }
      } catch (error) {
        logger.error("Failed to create expense session", error as Error);
        throw error;
      }
    },
  };
};

// Hook to update expense session (notes)
export const useExpenseSessionUpdate = () => {
  const updateSession = useMutation(
    api.inventory.expenseSessions.updateExpenseSession
  );

  return {
    updateSession: async (
      sessionId: Id<"expenseSession">,
      cashierId: Id<"cashier">,
      updates: {
        notes?: string;
      }
    ) => {
      try {
        return await updateSession({
          sessionId,
          cashierId,
          ...updates,
        });
      } catch (error) {
        logger.error("Failed to update expense session", error as Error);
        throw error;
      }
    },
  };
};
