import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { PosTerminalHealthAlertProps } from "../emails/PosTerminalHealthAlert";
import { resolveAppUrl } from "./dailyManagerReportEmail";
import type { PosTerminalHealthAlertCondition } from "../pos/application/terminalRuntime/terminalHealthAlerts";

const conditionValidator = v.union(
  v.literal("storage_critical"),
  v.literal("sync_stuck"),
  v.literal("sync_failing"),
);

const CONDITION_SUMMARIES: Record<PosTerminalHealthAlertCondition, string> = {
  storage_critical:
    "Storage is almost full. New offline sales may not be saved reliably.",
  sync_stuck:
    "Offline sales are waiting to sync. A pending review may be holding the queue.",
  sync_failing:
    "Offline sales keep failing to sync. Every upload attempt is being rejected.",
};

type PosTerminalHealthAlertPayload = PosTerminalHealthAlertProps & {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
};

export const getPosTerminalHealthAlertPayload = internalQuery({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    conditions: v.array(conditionValidator),
    observedAt: v.number(),
  },
  handler: async (ctx, args): Promise<PosTerminalHealthAlertPayload> => {
    const [store, terminal] = await Promise.all([
      ctx.db.get("store", args.storeId),
      ctx.db.get("posTerminal", args.terminalId),
    ]);
    if (!store || !terminal) {
      throw new Error("Terminal health alert context was not found.");
    }
    const organization = await ctx.db.get(
      "organization",
      store.organizationId,
    );

    const terminalLabel = terminal.registerNumber
      ? `${terminal.displayName} / Register ${terminal.registerNumber}`
      : terminal.displayName;

    return {
      conditionSummaries: args.conditions.map(
        (condition) => CONDITION_SUMMARIES[condition],
      ),
      healthUrl: `${resolveAppUrl()}/${organization?.slug ?? store.slug}/store/${store.slug}/pos/terminals/${args.terminalId}`,
      observedAtLabel: `Reported ${new Date(args.observedAt).toUTCString()}`,
      storeId: store._id,
      storeName: store.name,
      terminalId: terminal._id,
      terminalLabel,
    };
  },
});
