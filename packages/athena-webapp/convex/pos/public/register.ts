import { v } from "convex/values";

import { mutation, query } from "../../_generated/server";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import { getRegisterState } from "../application/queries/getRegisterState";
import { openDrawer as openDrawerCommand } from "../application/commands/register";
import { getServicePrincipalActorWithCtx } from "../../servicePrincipals/actor";
import { requirePosApplicationAuthorityWithCtx } from "../application/posApplicationAuthority";

const registerSessionSummaryValidator = v.object({
  _id: v.id("registerSession"),
  status: v.union(
    v.literal("open"),
    v.literal("active"),
    v.literal("closing"),
    v.literal("closeout_rejected"),
    v.literal("closed"),
  ),
  terminalId: v.optional(v.id("posTerminal")),
  registerNumber: v.optional(v.string()),
  openingFloat: v.number(),
  expectedCash: v.number(),
  openedAt: v.number(),
  notes: v.optional(v.string()),
  workflowTraceId: v.optional(v.string()),
});

const userErrorValidator = v.object({
  code: v.union(
    v.literal("validation_failed"),
    v.literal("authentication_failed"),
    v.literal("authorization_failed"),
    v.literal("not_found"),
    v.literal("conflict"),
    v.literal("precondition_failed"),
    v.literal("rate_limited"),
    v.literal("unavailable"),
  ),
  title: v.optional(v.string()),
  message: v.string(),
  fields: v.optional(v.record(v.string(), v.array(v.string()))),
  retryable: v.optional(v.boolean()),
  traceId: v.optional(v.string()),
  metadata: v.optional(v.record(v.string(), v.any())),
});

const registerSessionCommandResultValidator = v.union(
  v.object({
    kind: v.literal("ok"),
    data: v.union(v.null(), registerSessionSummaryValidator),
  }),
  v.object({
    kind: v.literal("user_error"),
    error: userErrorValidator,
  }),
);

export const getState = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.optional(v.id("posTerminal")),
    staffProfileId: v.optional(v.id("staffProfile")),
    registerNumber: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return null;
    }

    const serviceActor = await getServicePrincipalActorWithCtx(ctx);
    if (serviceActor) {
      const authority = await requirePosApplicationAuthorityWithCtx(ctx, {
        storeId: args.storeId,
      });
      if (args.terminalId && args.terminalId !== authority.terminalId) {
        throw new Error("The POS application session is no longer authorized.");
      }
      return getRegisterState(ctx, {
        ...args,
        terminalId: authority.terminalId,
      });
    }

    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You cannot view register state for this store.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return getRegisterState(ctx, args);
  },
});

export const openDrawer = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    staffProfileId: v.id("staffProfile"),
    registerNumber: v.optional(v.string()),
    openingFloat: v.number(),
    notes: v.optional(v.string()),
  },
  returns: registerSessionCommandResultValidator,
  handler: async (ctx, args) => {
    const serviceActor = await getServicePrincipalActorWithCtx(ctx);
    if (serviceActor) {
      const authority = await requirePosApplicationAuthorityWithCtx(ctx, {
        storeId: args.storeId,
      });
      if (authority.terminalId !== args.terminalId) {
        throw new Error("The POS application session is no longer authorized.");
      }
    }
    return openDrawerCommand(ctx, args);
  },
});
