import React, { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { DialogTrigger } from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  PauseCircle,
  PlayCircle,
  Clock,
  Plus,
  Trash2,
  Ban,
} from "lucide-react";
import { useSessionManagerOperations } from "@/hooks/useSessionManagerOperations";
import { Id } from "../../../convex/_generated/dataModel";
import { POSSession } from "../../../types";
import { CartItem, CustomerInfo } from "./types";
import { HeldSessionsList } from "./session/HeldSessionsList";
import { HoldSessionDialog } from "./session/HoldSessionDialog";
import { VoidSessionDialog } from "./session/VoidSessionDialog";
import { usePOSStore } from "~/src/stores/posStore";

interface SessionManagerProps {
  storeId: Id<"store">;
  cashierId?: Id<"athenaUser">;
  registerNumber?: string;
  cartItems: CartItem[];
  customerInfo: CustomerInfo;
  subtotal: number;
  tax: number;
  total: number;
  onSessionLoaded: (session: POSSession) => void;
  onNewSession: () => void;
}

export function SessionManager(props: SessionManagerProps) {
  const { storeId, cashierId, registerNumber, onSessionLoaded, onNewSession } =
    props;

  // Use focused session manager operations hook
  const {
    activeSession,
    heldSessions,
    hasActiveSession,
    handleHoldCurrentSession,
    handleResumeSession,
    handleVoidSession,
    handleNewSession,
  } = useSessionManagerOperations(storeId, cashierId, registerNumber);

  const store = usePOSStore();

  // Local UI state
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);

  // Wrapper functions to handle UI state
  const onHoldConfirm = async (reason?: string) => {
    await handleHoldCurrentSession(reason);
    setShowHoldDialog(false);
  };

  const onResumeSession = async (sessionId: Id<"posSession">) => {
    await handleResumeSession(sessionId, onSessionLoaded);
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
        <Badge variant="outline" className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {activeSession.sessionNumber}
        </Badge>
      )}

      {hasSessionExpired && (
        <Badge
          variant="outline"
          className="flex items-center gap-1 text-red-500 bg-red-50"
        >
          <Clock className="h-3 w-3" />
          Expired
        </Badge>
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
