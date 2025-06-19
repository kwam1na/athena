import { useQuery, useMutation } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { POSSession } from "../../types";
import { CartItem, CustomerInfo } from "../components/pos/types";

// Hook to get sessions for a store
export const usePOSStoreSessions = (
  storeId: Id<"store"> | undefined,
  status?: "active" | "held" | "completed" | "void",
  limit?: number
) => {
  return useQuery(
    api.inventory.posSessions.getStoreSessions,
    storeId ? { storeId, status, limit } : "skip"
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
  cashierId?: Id<"athenaUser">,
  registerNumber?: string
) => {
  return useQuery(
    api.inventory.posSessions.getActiveSession,
    storeId ? { storeId, cashierId, registerNumber } : "skip"
  );
};

// Hook to create a new session
export const usePOSSessionCreate = () => {
  const createSession = useMutation(api.inventory.posSessions.createSession);

  return {
    createSession: async (
      storeId: Id<"store">,
      cashierId?: Id<"athenaUser">,
      registerNumber?: string
    ) => {
      try {
        const sessionId = await createSession({
          storeId,
          cashierId,
          registerNumber,
        });

        console.log("✅ Session created successfully:", sessionId);
        return sessionId;
      } catch (error) {
        console.error("❌ Failed to create session:", error);
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
        cartItems?: CartItem[];
        customerId?: Id<"posCustomer">;
        customerInfo?: CustomerInfo;
        subtotal?: number;
        tax?: number;
        total?: number;
      }
    ) => {
      try {
        // Convert CartItem[] to the expected format
        const formattedCartItems = updates.cartItems?.map((item) => ({
          id: item.id,
          name: item.name,
          barcode: item.barcode,
          price: item.price,
          quantity: item.quantity,
          image: item.image || undefined,
          size: item.size,
          length: item.length ?? undefined,
          skuId: item.skuId,
        }));

        return await updateSession({
          sessionId,
          cartItems: formattedCartItems,
          customerId: updates.customerId,
          customerInfo: updates.customerInfo,
          subtotal: updates.subtotal,
          tax: updates.tax,
          total: updates.total,
        });
      } catch (error) {
        console.error("Failed to update session:", error);
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
        console.error("Failed to hold session:", error);
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
        console.error("Failed to resume session:", error);
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
      }
    ) => {
      try {
        return await completeSession({
          sessionId,
          ...paymentDetails,
        });
      } catch (error) {
        console.error("Failed to complete session:", error);
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
        console.error("Failed to void session:", error);
        throw error;
      }
    },
  };
};

// Composite hook that provides all session operations
export const usePOSSessionManager = (
  storeId: Id<"store"> | undefined,
  cashierId?: Id<"athenaUser">,
  registerNumber?: string
) => {
  const { createSession } = usePOSSessionCreate();
  const { updateSession } = usePOSSessionUpdate();
  const { holdSession } = usePOSSessionHold();
  const { resumeSession } = usePOSSessionResume();
  const { completeSession } = usePOSSessionComplete();
  const { voidSession } = usePOSSessionVoid();

  const activeSession = usePOSActiveSession(storeId, cashierId, registerNumber);
  const heldSessions = usePOSStoreSessions(storeId, "held", 10);

  return {
    // Data
    activeSession,
    heldSessions,

    // Operations
    createSession: (storeId: Id<"store">) =>
      createSession(storeId, cashierId, registerNumber),
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
