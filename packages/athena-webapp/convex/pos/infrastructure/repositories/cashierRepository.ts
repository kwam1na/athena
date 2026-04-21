import type { QueryCtx } from "../../../_generated/server";
import type { Id } from "../../../_generated/dataModel";

import type { PosCashierSummary } from "../../domain/types";

export async function getCashierForRegisterState(
  ctx: QueryCtx,
  args: {
    storeId: Id<"store">;
    cashierId?: Id<"cashier">;
  },
): Promise<PosCashierSummary | null> {
  if (!args.cashierId) {
    return null;
  }

  const cashier = await ctx.db.get("cashier", args.cashierId);
  if (!cashier || cashier.storeId !== args.storeId || !cashier.active) {
    return null;
  }

  return {
    _id: cashier._id,
    firstName: cashier.firstName,
    lastName: cashier.lastName,
    username: cashier.username,
    active: cashier.active,
  };
}
