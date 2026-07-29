import { v } from "convex/values";
import { internalQuery } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { PosTerminalHealthAlertProps } from "../emails/PosTerminalHealthAlert";
import { resolveAppUrl } from "./dailyManagerReportEmail";
import type { PosTerminalHealthAlertCondition } from "../pos/application/terminalRuntime/terminalHealthAlerts";

const conditionValidator = v.union(
  v.literal("storage_critical"),
  v.literal("sync_stuck"),
);

const CONDITION_SUMMARIES: Record<PosTerminalHealthAlertCondition, string> = {
  storage_critical:
    "Local storage on this terminal is critically degraded. Offline sales durability is at risk.",
  sync_stuck:
    "Offline sales on this terminal are held and not syncing. A review may be blocking the queue.",
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
