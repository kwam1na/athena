import React, { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  PauseCircle,
  PlayCircle,
  Clock,
  Users,
  ShoppingCart,
  Trash2,
  Plus,
} from "lucide-react";
import { usePOSSessionManager } from "@/hooks/usePOSSessions";
import { usePOSOperations } from "@/hooks/usePOSOperations";
import { Id } from "../../../convex/_generated/dataModel";
import { POSSession } from "../../../types";
import { CartItem, CustomerInfo } from "./types";
import { toast } from "sonner";

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
  const {
    storeId,
    cashierId,
    registerNumber,
    cartItems,
    customerInfo,
    subtotal,
    tax,
    total,
    onSessionLoaded,
    onNewSession,
  } = props;

  const {
    activeSession,
    heldSessions,
    createSession,
    updateSession,
    holdSession,
    resumeSession,
    voidSession,
    hasActiveSession,
    hasHeldSessions,
  } = usePOSSessionManager(storeId, cashierId, registerNumber);

  // Get POS operations for better session data handling
  const posOperations = usePOSOperations();

  // Debug logging
  React.useEffect(() => {
    console.log("🔄 SessionManager - activeSession changed:", {
      sessionId: activeSession?._id,
      sessionNumber: activeSession?.sessionNumber,
      status: activeSession?.status,
      hasSession: !!activeSession,
      timestamp: new Date().toLocaleTimeString(),
    });
  }, [activeSession]);

  // Additional debug logging for session state changes
  React.useEffect(() => {
    console.log("📊 SessionManager - session state:", {
      hasActiveSession,
      hasHeldSessions,
      heldSessionsCount: heldSessions?.length || 0,
      cartItemsCount: cartItems.length,
    });
  }, [hasActiveSession, hasHeldSessions, heldSessions, cartItems.length]);

  const [holdReason, setHoldReason] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [showHoldDialog, setShowHoldDialog] = useState(false);
  const [showVoidDialog, setShowVoidDialog] = useState(false);
  const [selectedSessionForVoid, setSelectedSessionForVoid] =
    useState<Id<"posSession"> | null>(null);

  const handleHoldCurrentSession = async () => {
    if (!activeSession) return;

    try {
      // First update the session with current cart state
      if (cartItems.length > 0 || customerInfo.customerId) {
        await updateSession(activeSession._id, {
          cartItems,
          customerId: customerInfo.customerId,
          customerInfo,
          subtotal,
          tax,
          total,
        });
      }

      // Then hold the session
      await holdSession(activeSession._id, holdReason);
      setHoldReason("");
      setShowHoldDialog(false);
      onNewSession(); // Clear current cart
    } catch (error) {
      console.error("Failed to hold session:", error);
      toast.error("Failed to hold session: " + (error as Error).message);
    }
  };

  const handleResumeSession = async (sessionId: Id<"posSession">) => {
    try {
      console.log("🔄 Resuming session:", sessionId);

      // Find the session data from held sessions first
      const session = heldSessions?.find((s) => s._id === sessionId);
      if (!session) {
        console.error("❌ Session not found in held sessions:", sessionId);
        toast.error("Session data not found");
        return;
      }

      console.log("📋 Found session data:", {
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

      // Then resume the session in the backend
      await resumeSession(sessionId);

      // Force recalculate totals to ensure the order summary is updated
      setTimeout(() => {
        posOperations.rawStore.calculateTotals();
        console.log("✅ Session resumed and totals recalculated");
      }, 100);

      console.log("✅ Session resumed and loaded successfully");
    } catch (error) {
      console.error("Failed to resume session:", error);
      toast.error("Failed to resume session: " + (error as Error).message);
    }
  };

  const handleVoidSession = async () => {
    if (!selectedSessionForVoid) return;

    try {
      await voidSession(selectedSessionForVoid, voidReason);
      setVoidReason("");
      setShowVoidDialog(false);
      setSelectedSessionForVoid(null);
    } catch (error) {
      console.error("Failed to void session:", error);
    }
  };

  const handleNewSession = async () => {
    try {
      console.log("🆕 Starting new session creation...");

      // Clear current state first
      onNewSession();

      // Only create new session if there's no active session
      if (!activeSession) {
        console.log("🔄 No active session found, creating new one...");
        const newSessionId = await createSession(storeId);
        console.log("✅ Manually created session:", newSessionId);

        // Give the queries time to refetch and update the UI
        // This ensures the session badge shows the new session number
        await new Promise((resolve) => setTimeout(resolve, 300));
        console.log("🔄 Session UI should be updated now");
      } else {
        console.log(
          "⚠️ Active session already exists:",
          activeSession.sessionNumber
        );
      }
    } catch (error) {
      console.error("❌ Failed to create new session:", error);
    }
  };

  const formatTime = (timestamp: number) => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
    }).format(amount);
  };

  return (
    <div className="flex items-center gap-2">
      {/* Active Session Info - Only show if we have a specific active session */}
      {activeSession && activeSession.status === "active" && (
        <Badge variant="outline" className="flex items-center gap-1">
          <Clock className="h-3 w-3" />
          {activeSession.sessionNumber}
        </Badge>
      )}

      {/* Hold Current Session */}
      {activeSession && cartItems.length > 0 && (
        <Dialog open={showHoldDialog} onOpenChange={setShowHoldDialog}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-1"
            >
              <PauseCircle className="h-4 w-4" />
              Hold
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Hold Current Session</DialogTitle>
              <DialogDescription>
                This will save your current cart and customer information so you
                can return to it later.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div>
                <Label htmlFor="holdReason">Reason (optional)</Label>
                <Input
                  id="holdReason"
                  placeholder="Customer stepped away, phone call, etc."
                  value={holdReason}
                  onChange={(e) => setHoldReason(e.target.value)}
                />
              </div>
              <div className="flex justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setShowHoldDialog(false)}
                >
                  Cancel
                </Button>
                <Button onClick={handleHoldCurrentSession}>Hold Session</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      {/* Held Sessions */}
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
                {heldSessions?.length}
              </Badge>
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96">
            <div className="space-y-4">
              <h4 className="font-medium">Held Sessions</h4>
              <div className="space-y-2">
                {heldSessions?.map((session) => (
                  <Card key={session._id} className="p-3">
                    <div className="flex items-center justify-between">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">
                            {session.sessionNumber}
                          </Badge>
                          {session.customer && (
                            <Badge
                              variant="secondary"
                              className="flex items-center gap-1"
                            >
                              <Users className="h-3 w-3" />
                              {session.customer.name}
                            </Badge>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground flex items-center gap-4">
                          <span className="flex items-center gap-1">
                            <ShoppingCart className="h-3 w-3" />
                            {session.cartItems.length} items
                          </span>
                          {session.total && (
                            <span>{formatCurrency(session.total)}</span>
                          )}
                          <span>
                            Held at{" "}
                            {formatTime(session.heldAt || session.updatedAt)}
                          </span>
                        </div>
                        {session.holdReason && (
                          <p className="text-sm text-muted-foreground italic">
                            "{session.holdReason}"
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleResumeSession(session._id)}
                        >
                          <PlayCircle className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            setSelectedSessionForVoid(session._id);
                            setShowVoidDialog(true);
                          }}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}

      {/* New Transaction */}
      <Button
        variant="outline"
        size="sm"
        onClick={handleNewSession}
        className="flex items-center gap-1"
      >
        <Plus className="h-4 w-4" />
        New
      </Button>

      {/* Void Session Dialog */}
      <Dialog open={showVoidDialog} onOpenChange={setShowVoidDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Void Session</DialogTitle>
            <DialogDescription>
              This will permanently delete the held session. This action cannot
              be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="voidReason">Reason</Label>
              <Textarea
                id="voidReason"
                placeholder="Why is this session being voided?"
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                required
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setShowVoidDialog(false);
                  setSelectedSessionForVoid(null);
                  setVoidReason("");
                }}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                onClick={handleVoidSession}
                disabled={!voidReason.trim()}
              >
                Void Session
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
