import type { Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

import { buildInStorePaymentAllocations } from "../../../cashControls/paymentAllocationAttribution";
import { recordPaymentAllocationWithCtx } from "../../../operations/paymentAllocations";

type PosPaymentInput = {
  method: string;
  amount: number;
  timestamp: number;
};

export async function recordRetailSalePaymentAllocations(
  ctx: MutationCtx,
  args: {
    changeGiven?: number;
    organizationId?: Id<"organization">;
    payments: PosPaymentInput[];
    posTransactionId: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    transactionNumber: string;
  },
) {
  const allocations = buildInStorePaymentAllocations({
    allocationType: "retail_sale",
    changeGiven: args.changeGiven,
    externalReferencePrefix: `${args.transactionNumber}:sale`,
    organizationId: args.organizationId,
    payments: args.payments,
    posTransactionId: args.posTransactionId,
    registerSessionId: args.registerSessionId,
    storeId: args.storeId,
    targetId: args.posTransactionId,
    targetType: "pos_transaction",
  });

  await Promise.all(
    allocations.map((allocation) => recordPaymentAllocationWithCtx(ctx, allocation)),
  );

  return allocations.length > 0;
}

export async function recordRetailVoidPaymentAllocations(
  ctx: MutationCtx,
  args: {
    changeGiven?: number;
    organizationId?: Id<"organization">;
    payments: PosPaymentInput[];
    posTransactionId: Id<"posTransaction">;
    registerSessionId?: Id<"registerSession">;
    storeId: Id<"store">;
    transactionNumber: string;
  },
) {
  const allocations = buildInStorePaymentAllocations({
    allocationType: "retail_sale_void",
    changeGiven: args.changeGiven,
    direction: "out",
    externalReferencePrefix: `${args.transactionNumber}:void`,
    organizationId: args.organizationId,
    payments: args.payments,
    posTransactionId: args.posTransactionId,
    registerSessionId: args.registerSessionId,
    storeId: args.storeId,
    targetId: args.posTransactionId,
    targetType: "pos_transaction",
  });

  await Promise.all(
    allocations.map((allocation) => recordPaymentAllocationWithCtx(ctx, allocation)),
  );

  return allocations.length > 0;
}
