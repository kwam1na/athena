import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { CartItem, CustomerInfo } from "../components/pos/types";
import { logger } from "../lib/logger";

// Hook to get sessions for a store
export const usePOSStoreSessions = (
  storeId: Id<"store"> | undefined,
  terminalId: Id<"posTerminal"> | undefined,
  status?: "active" | "held" | "completed" | "void",
  limit?: number
) => {
  return useQuery(
    api.inventory.posSessions.getStoreSessions,
    storeId ? { storeId, terminalId, status, limit } : "skip"
  );
};

// Hook to get a specific session
export const usePOSSession = (sessionId: Id<"posSession"> | undefined) => {
  return useQuery(
    api.inventory.posSessions.getSessionById,
    sessionId ? { sessionId } : "skip"
  );
};

// Hook to get active session for current register/cashier
export const usePOSActiveSession = (
  storeId: Id<"store"> | undefined,
  terminalId: Id<"posTerminal"> | undefined,
  cashierId?: Id<"athenaUser">,
  registerNumber?: string
) => {
  return useQuery(
    api.inventory.posSessions.getActiveSession,
    storeId && terminalId
      ? { storeId, cashierId, terminalId, registerNumber }
      : "skip"
  );
};

// Hook to create a new session
export const usePOSSessionCreate = () => {
  const createSession = useMutation(api.inventory.posSessions.createSession);

  return {
    createSession: async (
      storeId: Id<"store">,
      terminalId: Id<"posTerminal">,
      cashierId?: Id<"athenaUser">,
      registerNumber?: string
    ) => {
      try {
        const result = await createSession({
          storeId,
          terminalId,
          cashierId,
          registerNumber,
        });

        logger.debug("Session created successfully", {
          sessionId: result.sessionId,
        });
        return result.sessionId;
      } catch (error) {
        logger.error("Failed to create session", error as Error);
        throw error;
      }
    },
  };
};

// Hook to update session (cart items, customer info, totals)
export const usePOSSessionUpdate = () => {
  const updateSession = useMutation(api.inventory.posSessions.updateSession);

  return {
    updateSession: async (
      sessionId: Id<"posSession">,
      updates: {
        customerId?: Id<"posCustomer">;
        customerInfo?: CustomerInfo;
        subtotal?: number;
        tax?: number;
        total?: number;
      }
    ) => {
      try {
        // Cart items are now managed via posSessionItems mutations
        return await updateSession({
          sessionId,
          customerId: updates.customerId,
          customerInfo: updates.customerInfo,
          subtotal: updates.subtotal,
          tax: updates.tax,
          total: updates.total,
        });
      } catch (error) {
        logger.error("Failed to update session", error as Error);
        throw error;
      }
    },
  };
};

// Hook to hold/suspend a session
export const usePOSSessionHold = () => {
  const holdSession = useMutation(api.inventory.posSessions.holdSession);

  return {
    holdSession: async (sessionId: Id<"posSession">, holdReason?: string) => {
      try {
        return await holdSession({ sessionId, holdReason });
      } catch (error) {
        logger.error("Failed to hold session", error as Error);
        throw error;
      }
    },
  };
};

// Hook to resume a held session
export const usePOSSessionResume = () => {
  const resumeSession = useMutation(api.inventory.posSessions.resumeSession);

  return {
    resumeSession: async (sessionId: Id<"posSession">) => {
      try {
        return await resumeSession({ sessionId });
      } catch (error) {
        logger.error("Failed to resume session", error as Error);
        throw error;
      }
    },
  };
};

// Hook to complete a session (convert to transaction)
export const usePOSSessionComplete = () => {
  const completeSession = useMutation(
    api.inventory.posSessions.completeSession
  );

  return {
    completeSession: async (
      sessionId: Id<"posSession">,
      paymentDetails: {
        paymentMethod: string;
        amountPaid: number;
        changeGiven?: number;
        notes?: string;
        subtotal: number;
        tax: number;
        total: number;
      }
    ) => {
      try {
        return await completeSession({
          sessionId,
          ...paymentDetails,
        });
      } catch (error) {
        logger.error("Failed to complete session", error as Error);
        throw error;
      }
    },
  };
};

// Hook to void a session
export const usePOSSessionVoid = () => {
  const voidSession = useMutation(api.inventory.posSessions.voidSession);

  return {
    voidSession: async (sessionId: Id<"posSession">, voidReason?: string) => {
      try {
        return await voidSession({ sessionId, voidReason });
      } catch (error) {
        logger.error("Failed to void session", error as Error);
        throw error;
      }
    },
  };
};

// Composite hook that provides all session operations
export const usePOSSessionManager = (
  storeId: Id<"store"> | undefined,
  terminalId: Id<"posTerminal">,
  cashierId?: Id<"athenaUser">,
  registerNumber?: string
) => {
  const { createSession } = usePOSSessionCreate();
  const { updateSession } = usePOSSessionUpdate();
  const { holdSession } = usePOSSessionHold();
  const { resumeSession } = usePOSSessionResume();
  const { completeSession } = usePOSSessionComplete();
  const { voidSession } = usePOSSessionVoid();

  const activeSession = usePOSActiveSession(
    storeId,
    terminalId,
    cashierId,
    registerNumber
  );

  const heldSessions = usePOSStoreSessions(storeId, terminalId, "held", 10);

  return {
    // Data
    activeSession,
    heldSessions,

    // Operations
    createSession: (storeId: Id<"store">, terminalId: Id<"posTerminal">) =>
      createSession(storeId, terminalId, cashierId, registerNumber),
    updateSession,
    holdSession,
    resumeSession,
    completeSession,
    voidSession,

    // State helpers
    hasActiveSession: !!activeSession,
    hasHeldSessions: (heldSessions?.length || 0) > 0,
  };
};
