import { useMutation } from "convex/react";

import type {
  PosAddItemInput,
  PosAddItemResultDto,
  PosCompleteTransactionInput,
  PosCompleteTransactionResultDto,
  PosHoldSessionInput,
  PosHoldSessionResultDto,
  PosOpenDrawerInput,
  PosStartSessionInput,
  PosStartSessionResultDto,
} from "@/lib/pos/application/dto";
import type { PosCommandGateway } from "@/lib/pos/application/ports";
import { api } from "~/convex/_generated/api";

export function useConvexCommandGateway(): PosCommandGateway {
  const startSessionMutation = useMutation(api.inventory.posSessions.createSession);
  const addItemMutation = useMutation(api.inventory.posSessionItems.addOrUpdateItem);
  const holdSessionMutation = useMutation(api.inventory.posSessions.holdSession);
  const openDrawerMutation = useMutation(api.pos.public.register.openDrawer);
  const completeSessionMutation = useMutation(
    api.inventory.posSessions.completeSession,
  );

  return {
    startSession(input: PosStartSessionInput): Promise<PosStartSessionResultDto> {
      return startSessionMutation(input);
    },
    addItem(input: PosAddItemInput): Promise<PosAddItemResultDto> {
      return addItemMutation(input);
    },
    holdSession(input: PosHoldSessionInput): Promise<PosHoldSessionResultDto> {
      return holdSessionMutation({
        sessionId: input.sessionId,
        cashierId: input.cashierId,
        holdReason: input.reason,
      });
    },
    openDrawer(input: PosOpenDrawerInput) {
      return openDrawerMutation(input);
    },
    completeTransaction(
      input: PosCompleteTransactionInput,
    ): Promise<PosCompleteTransactionResultDto> {
      return completeSessionMutation({
        sessionId: input.sessionId,
        payments: input.payments,
        notes: input.notes,
        subtotal: input.subtotal,
        tax: input.tax,
        total: input.total,
      });
    },
  };
}

export function useConvexDirectTransactionMutation() {
  return useMutation(api.inventory.pos.completeTransaction);
}
