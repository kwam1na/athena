import { useMutation } from "convex/react";

import type {
  PosAddItemInput,
  PosAddItemResultDto,
  PosCompleteTransactionInput,
  PosCompleteTransactionResultDto,
  PosHoldSessionInput,
  PosHoldSessionResultDto,
  PosOpenDrawerInput,
  PosOpenDrawerResultDto,
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
        staffProfileId: input.staffProfileId,
        holdReason: input.reason,
      });
    },
    openDrawer(input: PosOpenDrawerInput): Promise<PosOpenDrawerResultDto> {
      return openDrawerMutation(input);
    },
    async completeTransaction(
      input: PosCompleteTransactionInput,
    ): Promise<PosCompleteTransactionResultDto> {
      const result = await completeSessionMutation({
        sessionId: input.sessionId,
        staffProfileId: input.staffProfileId,
        payments: input.payments,
        notes: input.notes,
        subtotal: input.subtotal,
        tax: input.tax,
        total: input.total,
        // U8: a session completes into exactly one sale, so the session id is a
        // stable, client-supplied idempotency token — a retried completion returns
        // the original transaction instead of minting a duplicate and double-
        // charging the drawer.
        idempotencyKey: `session:${input.sessionId}`,
      });
      // U7: the server hard-rejects a price that deviates from catalog authority
      // unless an authorized manager override proof accompanies it. The online
      // session gateway does not yet carry an inline manager-proof resubmission,
      // so surface the requirement as a blocking failure rather than silently
      // completing at an unverified price.
      if (result.kind === "approval_required") {
        return {
          kind: "user_error",
          error: {
            code: "precondition_failed",
            message: result.approval.reason,
          },
        };
      }
      return result;
    },
  };
}

export function useConvexDirectTransactionMutation() {
  return useMutation(api.inventory.pos.completeTransaction);
}
