import { v } from "convex/values";
import { mutation, query } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";
import {
  addNotificationSubscriptionOperationDefinition,
  removeNotificationSubscriptionOperationDefinition,
  setNotificationSubscriptionEnabledOperationDefinition,
} from "../operationAdmission/definitions";
import {
  listNotificationSubscriptionsReadDefinition,
  listOrganizationMemberRecipientCandidatesReadDefinition,
} from "../operationAdmission/readDefinitions";
import {
  admitPublicMutation,
  admitPublicQuery,
} from "../platform/operationAdmission";
import type {
  OperationMutationCtx,
  OperationQueryCtx,
} from "../operationAdmission/types";
import { requireNonDemoFoundationMutation } from "../sharedDemo/foundation";
import { isSharedDemoActionDeniedData } from "../../shared/sharedDemoActionError";
import {
  notificationCategoryValidator,
  notificationChannelValidator,
} from "../schemas/notifications";
import {
  ok,
  userError,
  type CommandResult,
} from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";
import { operationalRoleValidator } from "../operations/staffRoles";
import {
  normalizeRecipientEmail,
  SUBSCRIPTION_RESOLUTION_CAP,
} from "./deliveryPolicy";
import type { NotificationCategory } from "./registry";

/**
 * Public subscription management for the notifications rail — its FIRST
 * public Convex surface. Auth posture mirrors convex/reports/access.ts: a
 * single opaque error for every failure mode (missing auth, missing row,
 * wrong org, insufficient role) so a caller cannot distinguish "doesn't
 * exist" from "exists but you can't see it".
 *
 * setSubscriptionEnabled/removeSubscription load the target row FIRST and
 * authorize against the row's OWN organizationId — never a caller-supplied
 * org — closing the cross-org manipulation hole a trusting design would open.
 */

const SUBSCRIPTIONS_ACCESS_DENIED = "Notification settings unavailable.";

// One list read covers every category of one organization. Four categories x
// the per-category cap is the theoretical maximum (800); a smaller budget
// keeps the query's read volume bounded, and the `complete` flag reports N+
// semantics whenever rows were left unread instead of truncating silently.
export const SUBSCRIPTION_LIST_READ_BUDGET = 400;

// Stable grouping order for the settings surface. Kept in sync with
// notificationCategoryValidator by the NotificationCategory type.
const LISTED_CATEGORIES: readonly NotificationCategory[] = [
  "approvals",
  "cash_controls",
  "eod",
  "system_health",
];

const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type SubscriptionAuthCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

async function requireOrganizationFullAdminWithCtx(
  ctx: SubscriptionAuthCtx,
  organizationId: Id<"organization">,
) {
  let athenaUser;
  try {
    athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
  } catch {
    throw new Error(SUBSCRIPTIONS_ACCESS_DENIED);
  }
  const membership = await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: SUBSCRIPTIONS_ACCESS_DENIED,
    organizationId,
    userId: athenaUser._id,
  });
  return { athenaUser, membership };
}

const subscriptionProjectionValidator = v.object({
  subscriptionId: v.id("notificationSubscription"),
  category: notificationCategoryValidator,
  channel: notificationChannelValidator,
  recipientEmail: v.string(),
  recipientName: v.optional(v.string()),
  storeId: v.optional(v.id("store")),
  enabled: v.boolean(),
  updatedAt: v.number(),
});

const listSubscriptionsReturns = v.object({
  complete: v.boolean(),
  categories: v.array(
    v.object({
      category: notificationCategoryValidator,
      subscriptions: v.array(subscriptionProjectionValidator),
    }),
  ),
});

export const listSubscriptionsForOrganization = query({
  args: { organizationId: v.id("organization") },
  returns: listSubscriptionsReturns,
  handler: admitPublicQuery(
    listNotificationSubscriptionsReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { organizationId: Id<"organization"> },
    ) => {
      await requireOrganizationFullAdminWithCtx(ctx, args.organizationId);

      // Probe one past the budget: `complete: false` means the org has at
      // least SUBSCRIPTION_LIST_READ_BUDGET + 1 rows (N+ semantics).
      const rows = await ctx.db
        .query("notificationSubscription")
        .withIndex("by_organizationId_and_category", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .take(SUBSCRIPTION_LIST_READ_BUDGET + 1);
      const complete = rows.length <= SUBSCRIPTION_LIST_READ_BUDGET;
      const bounded = complete
        ? rows
        : rows.slice(0, SUBSCRIPTION_LIST_READ_BUDGET);

      const grouped = new Map(
        LISTED_CATEGORIES.map((category) => [
          category,
          [] as Array<{
            subscriptionId: Id<"notificationSubscription">;
            category: NotificationCategory;
            channel: "email" | "in_app";
            recipientEmail: string;
            recipientName?: string;
            storeId?: Id<"store">;
            enabled: boolean;
            updatedAt: number;
          }>,
        ]),
      );
      for (const row of bounded) {
        grouped.get(row.category)?.push({
          subscriptionId: row._id,
          category: row.category,
          channel: row.channel,
          recipientEmail: row.recipientEmail,
          recipientName: row.recipientName,
          storeId: row.storeId,
          enabled: row.enabled,
          updatedAt: row.updatedAt,
        });
      }

      return {
        complete,
        categories: LISTED_CATEGORIES.map((category) => ({
          category,
          subscriptions: grouped.get(category) ?? [],
        })),
      };
    },
  ),
});

// Bounded read for the recipient picker: one organization's membership rows.
// A named cap (not .collect()) keeps the read volume predictable even if an
// organization's roster grows large; the picker is a UI convenience, not a
// paginated directory.
export const ORGANIZATION_MEMBER_CANDIDATE_READ_CAP = 500;

const organizationMemberRecipientCandidateValidator = v.object({
  userId: v.id("athenaUser"),
  displayName: v.string(),
  email: v.string(),
  role: v.union(v.literal("full_admin"), v.literal("pos_only")),
  operationalRoles: v.array(operationalRoleValidator),
});

const listOrganizationMemberRecipientCandidatesReturns = v.array(
  organizationMemberRecipientCandidateValidator,
);

function memberDisplayName(user: {
  firstName?: string;
  lastName?: string;
  email: string;
}): string {
  const name = [user.firstName, user.lastName]
    .map((part) => part?.trim())
    .filter((part): part is string => !!part)
    .join(" ");
  return name || user.email;
}

// Lists organization members for the notifications recipient picker. Joins
// organizationMember -> athenaUser via the same by_organizationId_userId
// index pattern as inventory/organizationMembers.ts:getAll (that query is
// left untouched — this is a separate, narrower projection scoped to this
// module's own auth posture and read admission). Manager-first ordering is
// applied client-side; this query only carries operationalRoles.
export const listOrganizationMemberRecipientCandidates = query({
  args: { organizationId: v.id("organization") },
  returns: listOrganizationMemberRecipientCandidatesReturns,
  handler: admitPublicQuery(
    listOrganizationMemberRecipientCandidatesReadDefinition,
    async (
      ctx: OperationQueryCtx,
      args: { organizationId: Id<"organization"> },
    ) => {
      await requireOrganizationFullAdminWithCtx(ctx, args.organizationId);

      const memberships = await ctx.db
        .query("organizationMember")
        .withIndex("by_organizationId_userId", (q) =>
          q.eq("organizationId", args.organizationId),
        )
        .take(ORGANIZATION_MEMBER_CANDIDATE_READ_CAP);

      const users = await Promise.all(
        memberships.map((membership) =>
          ctx.db.get("athenaUser", membership.userId),
        ),
      );

      const candidates: Array<{
        userId: Id<"athenaUser">;
        displayName: string;
        email: string;
        role: "full_admin" | "pos_only";
        operationalRoles: Array<
          "manager" | "front_desk" | "stylist" | "technician" | "cashier"
        >;
      }> = [];
      for (let index = 0; index < memberships.length; index += 1) {
        const user = users[index];
        if (!user) continue;
        candidates.push({
          userId: user._id,
          displayName: memberDisplayName(user),
          email: user.email,
          role: memberships[index]!.role,
          operationalRoles: memberships[index]!.operationalRoles ?? [],
        });
      }

      return candidates;
    },
  ),
});

function mapSubscriptionCommandError(
  error: unknown,
): CommandResult<never> | null {
  if (
    error &&
    typeof error === "object" &&
    "data" in error &&
    isSharedDemoActionDeniedData((error as { data: unknown }).data)
  ) {
    return userError({
      code: "authorization_failed",
      message: (error as { data: { message: string } }).data.message,
    });
  }

  const message = error instanceof Error ? error.message : "";
  if (message === SUBSCRIPTIONS_ACCESS_DENIED) {
    return userError({ code: "authorization_failed", message });
  }
  if (message === "Sign in again to continue.") {
    return userError({ code: "authentication_failed", message });
  }
  return null;
}

type AddSubscriptionArgs = {
  organizationId: Id<"organization">;
  category: NotificationCategory;
  channel: "email" | "in_app";
  recipientEmail: string;
  recipientName?: string;
};

async function addSubscriptionCommandWithCtx(
  ctx: OperationMutationCtx,
  args: AddSubscriptionArgs,
): Promise<
  CommandResult<{ subscriptionId: Id<"notificationSubscription"> }>
> {
  try {
    await requireOrganizationFullAdminWithCtx(ctx, args.organizationId);
    requireNonDemoFoundationMutation({ organizationId: args.organizationId });
  } catch (error) {
    const mapped = mapSubscriptionCommandError(error);
    if (mapped) return mapped;
    throw error;
  }

  if (args.channel !== "email") {
    return userError({
      code: "validation_failed",
      message: "Only email notifications are supported right now.",
    });
  }

  const recipientEmail = normalizeRecipientEmail(args.recipientEmail);
  if (!EMAIL_FORMAT.test(recipientEmail)) {
    return userError({
      code: "validation_failed",
      message: "Enter a valid email address.",
    });
  }

  // The cap protects dispatch's bounded audience read, which scans every row
  // in the (org, category) bucket — enabled or not — so disabled rows count.
  const existing = await ctx.db
    .query("notificationSubscription")
    .withIndex("by_organizationId_and_category", (q) =>
      q.eq("organizationId", args.organizationId).eq("category", args.category),
    )
    .take(SUBSCRIPTION_RESOLUTION_CAP);
  if (existing.length >= SUBSCRIPTION_RESOLUTION_CAP) {
    return userError({
      code: "precondition_failed",
      message: `This category already has the maximum of ${SUBSCRIPTION_RESOLUTION_CAP} recipients. Remove one before adding another.`,
    });
  }
  const duplicate = existing.some(
    (subscription) =>
      subscription.channel === "email" &&
      normalizeRecipientEmail(subscription.recipientEmail) === recipientEmail,
  );
  if (duplicate) {
    return userError({
      code: "conflict",
      message: "This recipient already receives these notifications.",
    });
  }

  const now = Date.now();
  const recipientName = args.recipientName?.trim() || undefined;
  // Org-wide rows only: storeId is intentionally never set from this API.
  const subscriptionId = await ctx.db.insert("notificationSubscription", {
    organizationId: args.organizationId,
    category: args.category,
    channel: "email",
    recipientEmail,
    recipientName,
    enabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return ok({ subscriptionId });
}

export const addSubscription = mutation({
  args: {
    organizationId: v.id("organization"),
    category: notificationCategoryValidator,
    channel: notificationChannelValidator,
    recipientEmail: v.string(),
    recipientName: v.optional(v.string()),
  },
  returns: commandResultValidator(
    v.object({ subscriptionId: v.id("notificationSubscription") }),
  ),
  handler: admitPublicMutation(
    addNotificationSubscriptionOperationDefinition,
    addSubscriptionCommandWithCtx,
  ),
});

// Loads the target row and authorizes against the ROW'S organizationId. A
// missing row returns the same opaque denial as a wrong-org caller.
async function requireOwnedSubscriptionRowWithCtx(
  ctx: OperationMutationCtx,
  subscriptionId: Id<"notificationSubscription">,
) {
  const subscription = await ctx.db.get(
    "notificationSubscription",
    subscriptionId,
  );
  if (!subscription) {
    throw new Error(SUBSCRIPTIONS_ACCESS_DENIED);
  }
  await requireOrganizationFullAdminWithCtx(ctx, subscription.organizationId);
  requireNonDemoFoundationMutation({
    organizationId: subscription.organizationId,
  });
  return subscription;
}

async function setSubscriptionEnabledCommandWithCtx(
  ctx: OperationMutationCtx,
  args: { subscriptionId: Id<"notificationSubscription">; enabled: boolean },
): Promise<CommandResult<null>> {
  let subscription;
  try {
    subscription = await requireOwnedSubscriptionRowWithCtx(
      ctx,
      args.subscriptionId,
    );
  } catch (error) {
    const mapped = mapSubscriptionCommandError(error);
    if (mapped) return mapped;
    throw error;
  }

  await ctx.db.patch("notificationSubscription", subscription._id, {
    enabled: args.enabled,
    updatedAt: Date.now(),
  });
  return ok(null);
}

export const setSubscriptionEnabled = mutation({
  args: {
    subscriptionId: v.id("notificationSubscription"),
    enabled: v.boolean(),
  },
  returns: commandResultValidator(v.null()),
  handler: admitPublicMutation(
    setNotificationSubscriptionEnabledOperationDefinition,
    setSubscriptionEnabledCommandWithCtx,
  ),
});

async function removeSubscriptionCommandWithCtx(
  ctx: OperationMutationCtx,
  args: { subscriptionId: Id<"notificationSubscription"> },
): Promise<CommandResult<null>> {
  let subscription;
  try {
    subscription = await requireOwnedSubscriptionRowWithCtx(
      ctx,
      args.subscriptionId,
    );
  } catch (error) {
    const mapped = mapSubscriptionCommandError(error);
    if (mapped) return mapped;
    throw error;
  }

  await ctx.db.delete("notificationSubscription", subscription._id);
  return ok(null);
}

export const removeSubscription = mutation({
  args: { subscriptionId: v.id("notificationSubscription") },
  returns: commandResultValidator(v.null()),
  handler: admitPublicMutation(
    removeNotificationSubscriptionOperationDefinition,
    removeSubscriptionCommandWithCtx,
  ),
});
