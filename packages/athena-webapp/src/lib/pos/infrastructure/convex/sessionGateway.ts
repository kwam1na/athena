import { useMutation, useQuery } from "convex/react";

import type { CartItem } from "@/components/pos/types";
import { api } from "~/convex/_generated/api";
import type { Id } from "~/convex/_generated/dataModel";
import type { POSSession } from "~/types";
import { mapActiveSessionDto, mapHeldSessionsDto } from "./sessionGateway.mapper";

export type PosSessionCustomer = {
  _id?: Id<"posCustomer">;
  name: string;
  email?: string;
  phone?: string;
} | null;

export type PosSessionDetail = POSSession & {
  cartItems: CartItem[];
  customer?: PosSessionCustomer;
  subtotal?: number;
  tax?: number;
  total?: number;
  holdReason?: string;
};

export function useConvexActiveSession(input: {
  storeId?: Id<"store">;
  terminalId?: Id<"posTerminal"> | null;
  cashierId?: Id<"cashier"> | null;
  registerNumber?: string;
}): PosSessionDetail | null | undefined {
  const result = useQuery(
    api.inventory.posSessions.getActiveSession,
    input.storeId && input.terminalId && input.cashierId
      ? {
          storeId: input.storeId,
          terminalId: input.terminalId,
          cashierId: input.cashierId,
          registerNumber: input.registerNumber,
        }
      : "skip",
  );

  if (result === undefined) {
    return undefined;
  }

  return mapActiveSessionDto(result as unknown as PosSessionDetail | null) as
    | PosSessionDetail
    | null;
}

export function useConvexHeldSessions(input: {
  storeId?: Id<"store">;
  terminalId?: Id<"posTerminal"> | null;
  cashierId?: Id<"cashier"> | null;
  limit?: number;
}): PosSessionDetail[] | undefined {
  const result = useQuery(
    api.inventory.posSessions.getStoreSessions,
    input.storeId && input.terminalId && input.cashierId
      ? {
          storeId: input.storeId,
          terminalId: input.terminalId,
          cashierId: input.cashierId,
          status: "held",
          limit: input.limit ?? 10,
        }
      : "skip",
  );

  if (result === undefined) {
    return undefined;
  }

  return mapHeldSessionsDto(result as unknown as PosSessionDetail[]);
}

export function useConvexSessionActions() {
  const resumeSessionMutation = useMutation(api.inventory.posSessions.resumeSession);
  const voidSessionMutation = useMutation(api.inventory.posSessions.voidSession);
  const updateSessionMutation = useMutation(api.inventory.posSessions.updateSession);
  const syncSessionCheckoutStateMutation = useMutation(
    api.inventory.posSessions.syncSessionCheckoutState,
  );
  const releaseSessionMutation = useMutation(
    api.inventory.posSessions.releaseSessionInventoryHoldsAndDeleteItems,
  );
  const removeItemMutation = useMutation(api.inventory.posSessionItems.removeItem);

  return {
    resumeSession: resumeSessionMutation,
    voidSession: voidSessionMutation,
    updateSession: updateSessionMutation,
    syncSessionCheckoutState: syncSessionCheckoutStateMutation,
    releaseSessionInventoryHoldsAndDeleteItems: releaseSessionMutation,
    removeItem: removeItemMutation,
  };
}
