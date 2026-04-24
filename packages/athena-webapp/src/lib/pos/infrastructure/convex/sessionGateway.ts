import { useMutation, useQuery } from "convex/react";

import type { CartItem } from "@/components/pos/types";
import {
  type NormalizedCommandResult,
  runCommand,
} from "@/lib/errors/runCommand";
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

type SessionCommandPayload = {
  sessionId?: Id<"posSession">;
  expiresAt?: number;
};

type RemoveItemPayload = {
  expiresAt?: number;
};

export function useConvexActiveSession(input: {
  storeId?: Id<"store">;
  terminalId?: Id<"posTerminal"> | null;
  staffProfileId?: Id<"staffProfile"> | null;
  registerNumber?: string;
}): PosSessionDetail | null | undefined {
  const result = useQuery(
    api.inventory.posSessions.getActiveSession,
    input.storeId && input.terminalId && input.staffProfileId
      ? {
          storeId: input.storeId,
          terminalId: input.terminalId,
          staffProfileId: input.staffProfileId,
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
  staffProfileId?: Id<"staffProfile"> | null;
  limit?: number;
}): PosSessionDetail[] | undefined {
  const result = useQuery(
    api.inventory.posSessions.getStoreSessions,
    input.storeId && input.terminalId && input.staffProfileId
      ? {
          storeId: input.storeId,
          terminalId: input.terminalId,
          staffProfileId: input.staffProfileId,
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
  const bindSessionToRegisterSessionMutation = useMutation(
    api.inventory.posSessions.bindSessionToRegisterSession,
  );
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
    resumeSession: (args: Parameters<typeof resumeSessionMutation>[0]) =>
      runCommand<SessionCommandPayload>(() => resumeSessionMutation(args)),
    bindSessionToRegisterSession: (
      args: Parameters<typeof bindSessionToRegisterSessionMutation>[0],
    ) =>
      runCommand<SessionCommandPayload>(() =>
        bindSessionToRegisterSessionMutation(args),
      ),
    voidSession: (args: Parameters<typeof voidSessionMutation>[0]) =>
      runCommand<{ sessionId?: Id<"posSession"> }>(() => voidSessionMutation(args)),
    updateSession: (args: Parameters<typeof updateSessionMutation>[0]) =>
      runCommand<SessionCommandPayload>(() => updateSessionMutation(args)),
    syncSessionCheckoutState: (
      args: Parameters<typeof syncSessionCheckoutStateMutation>[0],
    ) => runCommand<SessionCommandPayload>(() => syncSessionCheckoutStateMutation(args)),
    releaseSessionInventoryHoldsAndDeleteItems: (
      args: Parameters<typeof releaseSessionMutation>[0],
    ) =>
      runCommand<{ sessionId?: Id<"posSession"> }>(() => releaseSessionMutation(args)),
    removeItem: (args: Parameters<typeof removeItemMutation>[0]) =>
      runCommand<RemoveItemPayload>(() => removeItemMutation(args)),
  };
}
