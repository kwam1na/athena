import { v } from "convex/values";

import type { Doc, Id } from "../_generated/dataModel";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { commandResultValidator } from "../lib/commandResultValidators";
import {
  getAuthenticatedAthenaUserWithCtx,
  requireAuthenticatedAthenaUserWithCtx,
} from "../lib/athenaUserAuth";
import { ok, userError } from "../../shared/commandResult";
import { authenticateStaffCredentialWithCtx } from "./staffCredentials";
import { recordOperationalEventWithCtx } from "./operationalEvents";

export const MANAGER_ELEVATION_TTL_MS = 15 * 60 * 1000;

type ManagerElevationCtx =
  | Pick<QueryCtx, "db">
  | Pick<MutationCtx, "db">;

type ActiveManagerElevation = {
  accountId: Id<"athenaUser">;
  elevationId: Id<"managerElevation">;
  expiresAt: number;
  managerDisplayName: string;
  managerStaffProfileId: Id<"staffProfile">;
  organizationId: Id<"organization">;
  startedAt: number;
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
};

function getStaffDisplayName(staffProfile: Doc<"staffProfile">) {
  return (
    staffProfile.fullName ||
    [staffProfile.firstName, staffProfile.lastName].filter(Boolean).join(" ") ||
    "Manager"
  );
}

async function assertActiveTerminal(
  ctx: ManagerElevationCtx,
  args: { storeId: Id<"store">; terminalId: Id<"posTerminal"> },
) {
  const terminal = await ctx.db.get("posTerminal", args.terminalId);

  if (!terminal || terminal.storeId !== args.storeId) {
    return userError({
      code: "precondition_failed",
      message: "This terminal is not registered for the active store.",
    });
  }

  if (terminal.status !== "active") {
    return userError({
      code: "precondition_failed",
      message: "This terminal is not active.",
    });
  }

  return null;
}

async function getCandidateElevations(
  ctx: ManagerElevationCtx,
  args: {
    accountId: Id<"athenaUser">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  return ctx.db
    .query("managerElevation")
    .withIndex("by_storeId_terminalId_accountId", (q) =>
      q
        .eq("storeId", args.storeId)
        .eq("terminalId", args.terminalId)
        .eq("accountId", args.accountId),
    )
    .take(20);
}

async function toActiveElevation(
  ctx: ManagerElevationCtx,
  elevation: Doc<"managerElevation">,
): Promise<ActiveManagerElevation | null> {
  if (elevation.endedAt || elevation.expiresAt <= Date.now()) {
    return null;
  }

  const [managerCredential, managerStaffProfile, managerRoleAssignments] =
    await Promise.all([
      ctx.db.get("staffCredential", elevation.managerCredentialId),
      ctx.db.get("staffProfile", elevation.managerStaffProfileId),
      ctx.db
        .query("staffRoleAssignment")
        .withIndex("by_staffProfileId", (q) =>
          q.eq("staffProfileId", elevation.managerStaffProfileId),
        )
        .take(20),
    ]);

  if (!managerStaffProfile || managerStaffProfile.status !== "active") {
    return null;
  }

  if (
    !managerCredential ||
    managerCredential.status !== "active" ||
    managerCredential.staffProfileId !== elevation.managerStaffProfileId ||
    managerCredential.storeId !== elevation.storeId
  ) {
    return null;
  }

  const hasActiveManagerRole = managerRoleAssignments.some(
    (assignment) =>
      assignment.status === "active" &&
      assignment.role === "manager" &&
      assignment.organizationId === elevation.organizationId &&
      assignment.storeId === elevation.storeId,
  );

  if (!hasActiveManagerRole) {
    return null;
  }

  return {
    accountId: elevation.accountId,
    elevationId: elevation._id,
    expiresAt: elevation.expiresAt,
    managerDisplayName: getStaffDisplayName(managerStaffProfile),
    managerStaffProfileId: elevation.managerStaffProfileId,
    organizationId: elevation.organizationId,
    startedAt: elevation.createdAt,
    storeId: elevation.storeId,
    terminalId: elevation.terminalId,
  };
}

export async function getActiveManagerElevationWithCtx(
  ctx: ManagerElevationCtx,
  args: {
    accountId: Id<"athenaUser">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const elevations = await getCandidateElevations(ctx, args);
  const activeElevations = (
    await Promise.all(
      elevations
        .sort((a, b) => b.createdAt - a.createdAt)
        .map((elevation) => toActiveElevation(ctx, elevation)),
    )
  ).filter(Boolean) as ActiveManagerElevation[];

  return activeElevations[0] ?? null;
}

export async function startManagerElevationWithCtx(
  ctx: MutationCtx,
  args: {
    accountId: Id<"athenaUser">;
    pinHash: string;
    reason?: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    username: string;
  },
) {
  const account = await ctx.db.get("athenaUser", args.accountId);

  if (!account) {
    return userError({
      code: "precondition_failed",
      message: "Sign in again before starting manager elevation.",
    });
  }

  const terminalError = await assertActiveTerminal(ctx, args);
  if (terminalError) {
    return terminalError;
  }

  const authentication = await authenticateStaffCredentialWithCtx(ctx, {
    allowedRoles: ["manager"],
    pinHash: args.pinHash,
    storeId: args.storeId,
    username: args.username,
  });

  if (authentication.kind !== "ok") {
    return authentication;
  }

  const now = Date.now();
  const existingElevations = await getCandidateElevations(ctx, args);
  await Promise.all(
    existingElevations
      .filter((elevation) => !elevation.endedAt && elevation.expiresAt > now)
      .map((elevation) =>
        ctx.db.patch("managerElevation", elevation._id, {
          endedAt: now,
          endReason: "superseded" as const,
        }),
      ),
  );

  const elevationId = await ctx.db.insert("managerElevation", {
    accountId: args.accountId,
    createdAt: now,
    expiresAt: now + MANAGER_ELEVATION_TTL_MS,
    managerCredentialId: authentication.data.credentialId,
    managerStaffProfileId: authentication.data.staffProfileId,
    organizationId: authentication.data.staffProfile.organizationId,
    reason: args.reason,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: authentication.data.staffProfileId,
    actorUserId: args.accountId,
    eventType: "manager_elevation.started",
    message: `Manager elevation started for ${getStaffDisplayName(authentication.data.staffProfile)}.`,
    metadata: {
      expiresAt: now + MANAGER_ELEVATION_TTL_MS,
      managerCredentialId: authentication.data.credentialId,
      terminalId: args.terminalId,
    },
    organizationId: authentication.data.staffProfile.organizationId,
    reason: args.reason,
    storeId: args.storeId,
    subjectId: elevationId,
    subjectLabel: getStaffDisplayName(authentication.data.staffProfile),
    subjectType: "managerElevation",
  });

  return ok({
    accountId: args.accountId,
    elevationId,
    expiresAt: now + MANAGER_ELEVATION_TTL_MS,
    managerCredentialId: authentication.data.credentialId,
    managerDisplayName: getStaffDisplayName(authentication.data.staffProfile),
    managerStaffProfileId: authentication.data.staffProfileId,
    organizationId: authentication.data.staffProfile.organizationId,
    staffProfile: {
      firstName: authentication.data.staffProfile.firstName,
      fullName: authentication.data.staffProfile.fullName,
      lastName: authentication.data.staffProfile.lastName,
    },
    staffProfileId: authentication.data.staffProfileId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });
}

export async function endManagerElevationWithCtx(
  ctx: MutationCtx,
  args: {
    accountId: Id<"athenaUser">;
    elevationId: Id<"managerElevation">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const elevation = await ctx.db.get("managerElevation", args.elevationId);

  if (
    !elevation ||
    elevation.accountId !== args.accountId ||
    elevation.storeId !== args.storeId ||
    elevation.terminalId !== args.terminalId
  ) {
    return userError({
      code: "not_found",
      message: "Manager elevation is no longer active.",
    });
  }

  if (elevation.endedAt) {
    return ok({ elevationId: elevation._id, ended: false });
  }

  const now = Date.now();
  const endReason = elevation.expiresAt <= now ? "expired" : "manager_ended";

  await ctx.db.patch("managerElevation", elevation._id, {
    endedAt: now,
    endReason,
  });

  await recordOperationalEventWithCtx(ctx, {
    actorStaffProfileId: elevation.managerStaffProfileId,
    actorUserId: args.accountId,
    eventType: "manager_elevation.ended",
    message: "Manager elevation ended.",
    metadata: {
      endReason,
      terminalId: args.terminalId,
    },
    organizationId: elevation.organizationId,
    storeId: args.storeId,
    subjectId: elevation._id,
    subjectType: "managerElevation",
  });

  return ok({ elevationId: elevation._id, ended: true });
}

export const getActiveManagerElevation = query({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  handler: async (ctx, args) => {
    const account = await getAuthenticatedAthenaUserWithCtx(ctx);
    if (!account) {
      return null;
    }

    return getActiveManagerElevationWithCtx(ctx, {
      accountId: account._id,
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
  },
});

export const startManagerElevation = mutation({
  args: {
    pinHash: v.string(),
    reason: v.optional(v.string()),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    username: v.string(),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    const account = await requireAuthenticatedAthenaUserWithCtx(ctx);

    return startManagerElevationWithCtx(ctx, {
      accountId: account._id,
      ...args,
    });
  },
});

export const endManagerElevation = mutation({
  args: {
    elevationId: v.id("managerElevation"),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    const account = await requireAuthenticatedAthenaUserWithCtx(ctx);

    return endManagerElevationWithCtx(ctx, {
      accountId: account._id,
      ...args,
    });
  },
});
