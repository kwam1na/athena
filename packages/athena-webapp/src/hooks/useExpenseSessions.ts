import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { logger } from "../lib/logger";
import { runCommand } from "../lib/errors/runCommand";

type ExpenseActorId = Id<"staffProfile">;

// Hook to get expense sessions for a store
export const useExpenseStoreSessions = (
  storeId: Id<"store"> | undefined,
  terminalId: Id<"posTerminal"> | undefined,
  staffProfileId?: ExpenseActorId,
  status?: "active" | "held" | "completed" | "void",
  limit?: number
) => {
  return useQuery(
    api.inventory.expenseSessions.getStoreExpenseSessions,
    storeId && staffProfileId
      ? {
          storeId,
          staffProfileId,
          terminalId,
          status,
          limit,
        }
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

// Hook to get active expense session for current register/staff profile
export const useExpenseActiveSession = (
  storeId: Id<"store"> | undefined,
  terminalId: Id<"posTerminal"> | undefined,
  staffProfileId?: ExpenseActorId,
  registerNumber?: string
) => {
  return useQuery(
    api.inventory.expenseSessions.getActiveExpenseSession,
    storeId && terminalId && staffProfileId
      ? {
          storeId,
          staffProfileId,
          terminalId,
          registerNumber,
        }
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
      staffProfileId: ExpenseActorId,
      registerNumber?: string
    ) => {
      try {
        const result = await runCommand(() =>
          createSession({
            storeId,
            terminalId,
            staffProfileId,
            registerNumber,
          })
        );

        if (result.kind === "ok") {
          logger.debug("Expense session created successfully", {
            sessionId: result.data.sessionId,
          });
          return result.data.sessionId;
        }

        throw new Error(result.error.message);
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
      staffProfileId: ExpenseActorId,
      updates: {
        notes?: string;
      }
    ) => {
      try {
        const result = await runCommand(() =>
          updateSession({
            sessionId,
            staffProfileId,
            ...updates,
          })
        );

        if (result.kind === "ok") {
          return result.data;
        }

        throw new Error(result.error.message);
      } catch (error) {
        logger.error("Failed to update expense session", error as Error);
        throw error;
      }
    },
  };
};
