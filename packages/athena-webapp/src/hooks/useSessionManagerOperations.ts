import { useCallback } from "react";
import { usePOSSessionManager } from "./usePOSSessions";
import { useSessionManagement } from "./useSessionManagement";
import { usePOSStore } from "../stores/posStore";
import { Id } from "../../convex/_generated/dataModel";
import { POSSession } from "../../types";
import { logger } from "../lib/logger";
import { showNoActiveSessionError } from "../lib/pos/toastService";

/**
 * Hook for Session Manager Operations
 *
 * Extracts business logic from SessionManager component.
 * Handles session loading, holding, resuming, and voiding from the UI.
 */
export const useSessionManagerOperations = (
  storeId: Id<"store">,
  terminalId: Id<"posTerminal">,
  cashierId: Id<"cashier">,
  registerNumber?: string
) => {
  const store = usePOSStore();

  // Session management hooks
  const {
    activeSession,
    heldSessions,
    createSession,
    updateSession,
    hasActiveSession,
    hasHeldSessions,
  } = usePOSSessionManager(storeId, terminalId, cashierId, registerNumber);

  const { holdSession, resumeSession, voidSession } = useSessionManagement();

  /**
   * Holds the current session with cart state
   */
  const handleHoldCurrentSession = useCallback(
    async (
      holdReason?: string
    ): Promise<{ success: true } | { success: false; error: string }> => {
      if (!activeSession) {
        showNoActiveSessionError("hold");
        return { success: false, error: "No active session to hold" };
      }

      // First update the session with current cart state
      if (store.cart.items.length > 0 || store.customer.current) {
        await updateSession(activeSession._id, cashierId, {
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

      // Then hold the session (errors handled by holdSession)
      const result = await holdSession(holdReason);

      if (!result.success) {
        return result;
      }

      // Clear local state
      store.startNewTransaction();

      logger.info("Session held successfully", {
        sessionId: activeSession._id,
      });

      return { success: true };
    },
    [activeSession, holdSession, updateSession, store]
  );

  /**
   * Resumes a held session and loads its data
   */
  const handleResumeSession = useCallback(
    async (
      sessionId: Id<"posSession">,
      cashierId: Id<"cashier">,
      terminalId: Id<"posTerminal">,
      onSessionLoaded: (session: POSSession) => void
    ): Promise<{ success: true } | { success: false; error: string }> => {
      logger.debug("Resuming session", { sessionId });

      // If there's an active session, handle it before resuming
      if (activeSession && store.session.currentSessionId) {
        const hasItems = store.cart.items.length > 0;

        // Only hold sessions with items
        if (hasItems) {
          logger.info(
            "Active session with cart data, holding before resuming different session",
            {
              currentSessionId: store.session.currentSessionId,
              resumingSessionId: sessionId,
              itemCount: store.cart.items.length,
            }
          );

          const holdResult = await handleHoldCurrentSession(
            "Auto-held before resuming different session"
          );

          if (!holdResult.success) {
            logger.error("Failed to hold current session, cannot resume", {
              error: holdResult.error,
            });
            return { success: false, error: holdResult.error };
          }

          logger.info(
            "Current session held successfully, proceeding with resume"
          );
        } else {
          // Empty session - just clear it
          logger.info("Active session is empty, clearing before resume", {
            currentSessionId: store.session.currentSessionId,
          });
          store.startNewTransaction();
        }
      }

      // Find the session data from held sessions
      const session = heldSessions?.find((s) => s._id === sessionId);
      if (!session) {
        logger.error("Session not found in held sessions", { sessionId });
        showNoActiveSessionError("resume");
        return { success: false, error: "Session not found in held sessions" };
      }

      logger.debug("Found session data", {
        sessionId: session._id,
        sessionNumber: session.sessionNumber,
        cartItems: session.cartItems.length,
        subtotal: session.subtotal,
        total: session.total,
        status: session.status,
      });

      // First load the session data to restore cart state
      const posSession: POSSession = {
        ...session,
        customer: session.customer || undefined,
      };
      onSessionLoaded(posSession);

      // Then resume the session in the backend (errors handled by resumeSession)
      const result = await resumeSession(sessionId, cashierId, terminalId);

      if (!result.success) {
        logger.info("Failed to resume session", {
          sessionId,
          error: result.error,
        });
        return result;
      }

      // Force recalculate totals to ensure UI is updated
      setTimeout(() => {
        store.calculateTotals();
        logger.debug("Session resumed and totals recalculated");
      }, 100);

      logger.info("Session resumed successfully", { sessionId });
      return { success: true };
    },
    [
      activeSession,
      store,
      heldSessions,
      resumeSession,
      handleHoldCurrentSession,
    ]
  );

  /**
   * Voids a session
   */
  const handleVoidSession = useCallback(
    async (
      sessionId: Id<"posSession">,
      voidReason?: string
    ): Promise<{ success: true } | { success: false; error: string }> => {
      // Errors handled by voidSession
      const result = await voidSession(sessionId, voidReason);

      if (result.success) {
        logger.info("Session voided successfully", { sessionId });
      }

      return result;
    },
    [voidSession]
  );

  /**
   * Creates a new session manually
   */
  const handleNewSession = useCallback(
    async (
      onNewSession: () => void
    ): Promise<
      | { success: true; data: Id<"posSession"> }
      | { success: false; error: string }
    > => {
      logger.debug("Starting new session creation", {
        hasActiveSession: !!activeSession,
        currentSessionId: store.session.currentSessionId,
        isCreating: store.session.isCreating,
      });

      // Prevent creating if session is already being created
      if (store.session.isCreating) {
        const error = "Session creation already in progress";
        logger.warn(error);
        return { success: false, error };
      }

      // If active session exists, handle it appropriately
      if (activeSession && store.session.currentSessionId) {
        const hasItems = store.cart.items.length > 0;

        // Only hold sessions with items or customer info
        if (hasItems) {
          logger.info(
            "Active session with cart data, holding before creating new session",
            {
              sessionId: store.session.currentSessionId,
              sessionNumber: activeSession?.sessionNumber,
              itemCount: store.cart.items.length,
            }
          );

          const holdResult = await handleHoldCurrentSession(
            "Auto-held for new session"
          );

          if (!holdResult.success) {
            logger.error("Failed to hold session, cannot create new session", {
              error: holdResult.error,
            });
            return { success: false, error: holdResult.error };
          }

          logger.info(
            "Session held successfully, cart state cleared, proceeding with new session"
          );
        } else {
          // Empty session - just clear it without holding
          logger.info("Active session is empty, clearing without holding", {
            sessionId: store.session.currentSessionId,
            sessionNumber: activeSession?.sessionNumber,
          });
          store.startNewTransaction();
        }
      }

      // Clear current state first
      onNewSession();

      logger.debug("Creating new session");

      try {
        // Errors handled by createSession
        const newSessionId: Id<"posSession"> = await createSession(
          storeId,
          terminalId
        );

        // Immediately set the new session ID in the store to prevent
        // the auto-init effect from loading a different session
        store.setCurrentSessionId(newSessionId);

        logger.info("Manually created session", { sessionId: newSessionId });

        // Give the queries time to refetch and update the UI
        await new Promise((resolve) => setTimeout(resolve, 300));
        logger.debug("Session UI should be updated now");

        return { success: true, data: newSessionId };
      } catch (error) {
        const errorMessage = (error as Error).message;
        logger.error("Failed to create new session", { error: errorMessage });
        return { success: false, error: errorMessage };
      }
    },
    [activeSession, createSession, storeId, store, handleHoldCurrentSession]
  );

  return {
    // Operations
    handleHoldCurrentSession,
    handleResumeSession,
    handleVoidSession,
    handleNewSession,

    // Session data
    activeSession,
    heldSessions,
    hasActiveSession,
    hasHeldSessions,
  };
};
