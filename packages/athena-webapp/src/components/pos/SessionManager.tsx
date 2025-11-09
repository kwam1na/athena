import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { PauseCircle, PlayCircle, Clock, Plus, Ban } from "lucide-react";
import { useSessionManagerOperations } from "@/hooks/useSessionManagerOperations";
import { Id } from "../../../convex/_generated/dataModel";
import { POSSession } from "../../../types";
import { CartItem, CustomerInfo } from "./types";
import { HeldSessionsList } from "./session/HeldSessionsList";
import { HoldSessionDialog } from "./session/HoldSessionDialog";
import { usePOSStore } from "~/src/stores/posStore";
import { FadeIn } from "../common/FadeIn";
import { motion } from "framer-motion";
import { usePOSActiveSession } from "~/src/hooks/usePOSSessions";

interface SessionManagerProps {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  cashierId: Id<"cashier">;
  registerNumber?: string;
  cartItems: CartItem[];
  customerInfo: CustomerInfo;
  subtotal: number;
  tax: number;
  total: number;
  onSessionLoaded: (session: POSSession) => void;
  onNewSession: () => void;
  resetAutoSessionInitialized: () => void;
}

export function SessionManager(props: SessionManagerProps) {
  const {
    storeId,
    terminalId,
    cashierId,
    registerNumber,
    onSessionLoaded,
    onNewSession,
    resetAutoSessionInitialized,
  } = props;

  // Use focused session manager operations hook
  const {
    heldSessions,
    activeSession: activeSessionResponse,
    handleHoldCurrentSession,
    handleResumeSession,
    handleVoidSession,
    handleNewSession,
  } = useSessionManagerOperations(
    storeId,
    terminalId,
    cashierId,
    registerNumber
  );

  const store = usePOSStore();

  const { activeSession: activeSessionStore } = store.session;

  const activeSession = activeSessionResponse || activeSessionStore;

  // Local UI state
  const [showHoldDialog, setShowHoldDialog] = useState(false);

  // Wrapper functions to handle UI state
  const onHoldConfirm = async (reason?: string) => {
    await handleHoldCurrentSession(reason);
    resetAutoSessionInitialized();
  };

  const onResumeSession = async (
    sessionId: Id<"posSession">,
    cashierId: Id<"cashier">,
    terminalId: Id<"posTerminal">
  ) => {
    await handleResumeSession(
      sessionId,
      cashierId,
      terminalId,
      onSessionLoaded
    );
  };

  const onVoidConfirm = async (reason?: string) => {
    if (!activeSession) return;
    await handleVoidSession(activeSession._id, reason);
    store.startNewTransaction();
  };

  const onNewSessionClick = async () => {
    await handleNewSession(onNewSession);
  };

  const hasSessionExpired =
    (activeSession?.expiresAt && activeSession.expiresAt < Date.now()) ||
    (!activeSession && !!store.session.currentSessionId);

  return (
    <div className="flex items-center gap-2">
      {/* Active Session Badge */}
      {activeSession && activeSession.status === "active" && (
        <FadeIn>
          <Badge variant="outline" className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {activeSession.sessionNumber}
          </Badge>
        </FadeIn>
      )}

      {hasSessionExpired && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: { delay: 0.6 } }}
          exit={{ opacity: 0 }}
        >
          <Badge
            variant="outline"
            className="flex items-center gap-1 text-red-500 bg-red-50"
          >
            <Clock className="h-3 w-3" />
            Expired
          </Badge>
        </motion.div>
      )}
      {/* Hold Current Session */}
      {activeSession && (
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-1"
          onClick={() => onHoldConfirm()}
          disabled={store.cart.items.length === 0}
        >
          <PauseCircle className="h-4 w-4" />
          Hold
        </Button>
      )}

      {/* Void Current Session */}
      {activeSession && (
        <Button
          variant="outline"
          size="sm"
          className="flex items-center gap-1"
          onClick={() => onVoidConfirm()}
          disabled={store.cart.items.length === 0}
        >
          <Ban className="h-4 w-4 text-destructive" />
          Void
        </Button>
      )}

      {/* Held Sessions Popover */}
      {heldSessions && heldSessions.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1"
            >
              <PlayCircle className="h-4 w-4" />
              Resume
              <Badge variant="secondary" className="ml-1">
                {heldSessions.length}
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-full">
            <HeldSessionsList
              sessions={heldSessions}
              onResumeSession={onResumeSession}
              onVoidSession={async (sessionId) => {
                await handleVoidSession(sessionId);
              }}
            />
          </PopoverContent>
        </Popover>
      )}

      {/* New Transaction */}
      <Button
        variant="outline"
        size="sm"
        onClick={onNewSessionClick}
        disabled={activeSession?.status === "active"}
        className="flex items-center gap-1"
      >
        <Plus className="h-4 w-4" />
        New
      </Button>

      {/* Dialogs */}
      <HoldSessionDialog
        open={showHoldDialog}
        onOpenChange={setShowHoldDialog}
        onConfirm={onHoldConfirm}
      />
    </div>
  );
}
