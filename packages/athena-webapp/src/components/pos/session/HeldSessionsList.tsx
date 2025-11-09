import React from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Users, ShoppingCart, PlayCircle, Ban, Clock } from "lucide-react";
import { Id } from "../../../../convex/_generated/dataModel";
import { useGetCurrencyFormatter } from "~/src/hooks/useGetCurrencyFormatter";
import { usePOSStore } from "~/src/stores/posStore";

interface HeldSession {
  _id: Id<"posSession">;
  expiresAt: number;
  sessionNumber: string;
  cartItems: any[];
  total?: number;
  subtotal?: number;
  heldAt?: number;
  updatedAt: number;
  holdReason?: string;
  customer?: {
    name: string;
    email?: string;
    phone?: string;
  } | null;
}

interface HeldSessionsListProps {
  sessions: HeldSession[];
  onResumeSession: (
    sessionId: Id<"posSession">,
    cashierId: Id<"cashier">,
    terminalId: Id<"posTerminal">
  ) => void;
  onVoidSession: (sessionId: Id<"posSession">) => void;
}

export function HeldSessionsList({
  sessions,
  onResumeSession,
  onVoidSession,
}: HeldSessionsListProps) {
  const store = usePOSStore();

  const formatter = useGetCurrencyFormatter();

  if (sessions.length === 0) {
    return (
      <div className="text-center py-6 text-muted-foreground">
        No held sessions
      </div>
    );
  }

  const hasExpired = (timestamp: number) => {
    return timestamp < Date.now();
  };

  const getSessionCartItemsCount = (session: HeldSession) => {
    const count = session.cartItems.reduce(
      (acc, item) => acc + item.quantity,
      0
    );
    return count == 1 ? `${count} item` : `${count} items`;
  };

  return (
    <div className="space-y-4">
      <h4 className="font-medium">Held Sessions</h4>
      <div className="space-y-2 max-h-96 overflow-y-auto">
        {sessions.map((session) => (
          <Card key={session._id} className="p-3">
            <div className="flex items-center justify-between">
              <div className="space-y-1 flex-1">
                <div className="flex items-center gap-2">
                  <Badge variant="outline">{session.sessionNumber}</Badge>
                  {session.customer && (
                    <Badge
                      variant="secondary"
                      className="flex items-center gap-1"
                    >
                      <Users className="h-3 w-3" />
                      {session.customer.name}
                    </Badge>
                  )}
                  {hasExpired(session.expiresAt) && (
                    <Badge
                      variant="outline"
                      className="flex items-center gap-1 text-red-500 bg-red-50"
                    >
                      <Clock className="h-3 w-3" />
                      Expired
                    </Badge>
                  )}
                </div>
                <div className="text-sm text-muted-foreground flex items-center gap-4">
                  <span className="flex items-center gap-1">
                    <ShoppingCart className="h-3 w-3" />
                    {getSessionCartItemsCount(session)}
                  </span>
                  {session.total && <b>{formatter.format(session.total)}</b>}
                  {/* <span>
                    Held at {formatTime(session.heldAt || session.updatedAt)}
                  </span> */}
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
                  disabled={hasExpired(session.expiresAt)}
                  onClick={() =>
                    onResumeSession(
                      session._id,
                      store.cashier.id as Id<"cashier">,
                      store.terminalId as Id<"posTerminal">
                    )
                  }
                  title="Resume session"
                >
                  <PlayCircle className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onVoidSession(session._id)}
                  title="Void session"
                >
                  <Ban className="h-4 w-4 text-destructive" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}
