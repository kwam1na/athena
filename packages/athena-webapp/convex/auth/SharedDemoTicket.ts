import { ConvexCredentials } from "@convex-dev/auth/providers/ConvexCredentials";
import type { GenericActionCtxWithAuthConfig } from "@convex-dev/auth/server";
import type { GenericDataModel } from "convex/server";
import type { Value } from "convex/values";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { hashSharedDemoTicket } from "../sharedDemo/crypto";

const consumeTicketRef = (internal as any).sharedDemo.admission.consumeSharedDemoTicket;
const consumeExchangeBudgetRef = (internal as any).sharedDemo.admission.consumeSharedDemoExchangeBudget;

export const SHARED_DEMO_AUTH_PROVIDER_ID = "shared-demo";

export async function authorizeSharedDemoTicket(
  credentials: Partial<Record<string, Value | undefined>>,
  ctx: GenericActionCtxWithAuthConfig<GenericDataModel>,
): Promise<{ userId: Id<"users"> } | null> {
  const ticket = typeof credentials.ticket === "string" ? credentials.ticket : "";
  if (!ticket || ticket.length > 256) return null;

  try {
    await ctx.runMutation(consumeExchangeBudgetRef, {});
    const result = (await ctx.runMutation(consumeTicketRef, {
      ticketHash: await hashSharedDemoTicket(ticket),
    })) as { authUserId: Id<"users"> };
    return { userId: result.authUserId };
  } catch {
    return null;
  }
}

export const SharedDemoTicket: ReturnType<typeof ConvexCredentials> =
  ConvexCredentials({
    id: SHARED_DEMO_AUTH_PROVIDER_ID,
    authorize: authorizeSharedDemoTicket,
  });
