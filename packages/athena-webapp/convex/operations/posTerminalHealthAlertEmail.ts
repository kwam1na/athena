import { v } from "convex/values";
import {
  internalAction,
  internalQuery,
  type ActionCtx,
} from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { ADMIN_EMAILS } from "../constants/email";
import type { PosTerminalHealthAlertProps } from "../emails/PosTerminalHealthAlert";
import { sendPosTerminalHealthAlertEmail } from "../mailersend";
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

type SentPosTerminalHealthAlert = {
  recipientEmail: string;
  status: number;
  storeName: string;
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

export async function sendPosTerminalHealthAlertToAdminsWithCtx(
  ctx: Pick<ActionCtx, "runQuery">,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    conditions: PosTerminalHealthAlertCondition[];
    observedAt: number;
  },
): Promise<SentPosTerminalHealthAlert[]> {
  const payload: PosTerminalHealthAlertPayload = await ctx.runQuery(
    internal.operations.posTerminalHealthAlertEmail
      .getPosTerminalHealthAlertPayload,
    args,
  );
  const sentAlerts: SentPosTerminalHealthAlert[] = [];

  for (const recipient of ADMIN_EMAILS) {
    const response = await sendPosTerminalHealthAlertEmail({
      ...payload,
      recipientEmail: recipient.email,
      recipientName: recipient.name,
    });

    if (!response.ok) {
      throw new Error(await response.text());
    }

    sentAlerts.push({
      recipientEmail: recipient.email,
      status: response.status,
      storeName: payload.storeName,
      terminalId: payload.terminalId,
    });
  }

  return sentAlerts;
}

export const sendPosTerminalHealthAlertToAdmins = internalAction({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    conditions: v.array(conditionValidator),
    observedAt: v.number(),
  },
  handler: (ctx, args) => sendPosTerminalHealthAlertToAdminsWithCtx(ctx, args),
});
