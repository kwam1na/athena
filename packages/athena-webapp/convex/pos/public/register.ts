import { v } from "convex/values";

import { query } from "../../_generated/server";
import { getRegisterState } from "../application/queries/getRegisterState";

export const getState = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    cashierId: v.optional(v.id("cashier")),
    registerNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => getRegisterState(ctx, args),
});
