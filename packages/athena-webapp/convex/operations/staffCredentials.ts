import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Doc, Id } from "../_generated/dataModel";
import { operationalRoleValidator, type OperationalRole } from "./staffRoles";
import { ok, userError, type CommandResult } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";

export const STAFF_CREDENTIAL_STATUS = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("suspended"),
  v.literal("revoked"),
);

export type StaffCredentialStatus =
  | "pending"
  | "active"
  | "suspended"
  | "revoked";
type StaffCredentialReaderCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

type StaffCredentialAuthenticationData = {
  activeRoles: OperationalRole[];
  credentialId: Id<"staffCredential">;
  staffProfile: Doc<"staffProfile">;
  staffProfileId: Id<"staffProfile">;
};

type StaffCredentialAuthenticationResult =
  CommandResult<StaffCredentialAuthenticationData>;

const ACTIVE_STAFF_SESSION_LOOKUP_LIMIT = 100;

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function requireNonEmptyUsername(username: string) {
  const normalizedUsername = normalizeUsername(username);

  if (!normalizedUsername) {
    throw new Error("Username is required.");
  }

  return normalizedUsername;
}

function invalidStaffCredentialsResult(): StaffCredentialAuthenticationResult {
  return userError({
    code: "authentication_failed",
    message: "Invalid staff credentials.",
  });
}

function staffAuthorizationFailedResult(
  message: string,
): StaffCredentialAuthenticationResult {
  return userError({
    code: "authorization_failed",
    message,
  });
}

function staffPreconditionFailedResult(
  message: string,
): StaffCredentialAuthenticationResult {
  return userError({
    code: "precondition_failed",
    message,
  });
}

export async function getStaffCredentialByStaffProfileIdWithCtx(
  ctx: StaffCredentialReaderCtx,
  staffProfileId: Id<"staffProfile">,
) {
  const [activeCredential, pendingCredential] = await Promise.all([
    ctx.db
      .query("staffCredential")
      .withIndex("by_staffProfileId_status", (q) =>
        q.eq("staffProfileId", staffProfileId).eq("status", "active"),
      )
      .first(),
    ctx.db
      .query("staffCredential")
      .withIndex("by_staffProfileId_status", (q) =>
        q.eq("staffProfileId", staffProfileId).eq("status", "pending"),
      )
      .first(),
  ]);

  if (activeCredential) {
    return activeCredential;
  }

  if (pendingCredential) {
    return pendingCredential;
  }

  return ctx.db
    .query("staffCredential")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", staffProfileId),
    )
    .first();
}

async function getCredentialById(
  ctx: StaffCredentialReaderCtx,
  staffCredentialId: Id<"staffCredential">,
) {
  return ctx.db.get("staffCredential", staffCredentialId);
}

async function getCredentialByUsername(
  ctx: StaffCredentialReaderCtx,
  args: {
    storeId: Id<"store">;
    username: string;
  },
) {
  const normalizedUsername = normalizeUsername(args.username);

  if (!normalizedUsername) {
    return null;
  }

  return ctx.db
    .query("staffCredential")
    .withIndex("by_storeId_username", (q) =>
      q.eq("storeId", args.storeId).eq("username", normalizedUsername),
    )
    .first();
}

async function getActiveRolesForStaffProfile(
  ctx: StaffCredentialReaderCtx,
  args: {
    organizationId: Id<"organization">;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
  },
) {
  const roleAssignments = await ctx.db
    .query("staffRoleAssignment")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", args.staffProfileId),
    )
    .take(20);

  return roleAssignments.filter(
    (assignment) =>
      assignment.status === "active" &&
      assignment.organizationId === args.organizationId &&
      assignment.storeId === args.storeId,
  );
}

async function assertStaffProfileReadyForCredential(
  ctx: StaffCredentialReaderCtx,
  args: {
    organizationId: Id<"organization">;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
  },
) {
  const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);

  if (!staffProfile) {
    throw new Error("Staff profile not found.");
  }

  if (
    staffProfile.storeId !== args.storeId ||
    staffProfile.organizationId !== args.organizationId
  ) {
    throw new Error("Staff profile does not belong to this store.");
  }

  if (staffProfile.status !== "active") {
    throw new Error("Staff profile is not active.");
  }

  const activeRoles = await getActiveRolesForStaffProfile(ctx, args);

  if (activeRoles.length === 0) {
    throw new Error("Staff profile has no active role assignments.");
  }

  return { activeRoles, staffProfile };
}

export async function getStaffCredentialUsernameAvailabilityWithCtx(
  ctx: Pick<QueryCtx, "db">,
  args: {
    storeId: Id<"store">;
    username: string;
  },
) {
  const normalizedUsername = requireNonEmptyUsername(args.username);
  const existingCredential = await getCredentialByUsername(ctx, {
    storeId: args.storeId,
    username: normalizedUsername,
  });

  return {
    available: !existingCredential,
    normalizedUsername,
  };
}

export async function listStaffCredentialsByStoreWithCtx(
  ctx: StaffCredentialReaderCtx,
  args: {
    storeId: Id<"store">;
  },
) {
  // Store staff rosters stay small enough for the admin credential screen to read them in full.
  const [
    pendingCredentials,
    activeCredentials,
    suspendedCredentials,
    revokedCredentials,
  ] = await Promise.all([
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    ctx.db
      .query("staffCredential")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "pending"),
      )
      .collect(),
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    ctx.db
      .query("staffCredential")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active"),
      )
      .collect(),
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    ctx.db
      .query("staffCredential")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "suspended"),
      )
      .collect(),
    // eslint-disable-next-line @convex-dev/no-collect-in-query
    ctx.db
      .query("staffCredential")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "revoked"),
      )
      .collect(),
  ]);

  return [
    ...pendingCredentials,
    ...activeCredentials,
    ...suspendedCredentials,
    ...revokedCredentials,
  ];
}

export async function createStaffCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organization">;
    pinHash?: string;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    username: string;
  },
) {
  const normalizedUsername = requireNonEmptyUsername(args.username);

  await assertStaffProfileReadyForCredential(ctx, args);

  const existingCredentialForStaffProfile =
    await getStaffCredentialByStaffProfileIdWithCtx(ctx, args.staffProfileId);

  if (existingCredentialForStaffProfile) {
    throw new Error("Staff credential already exists for this staff profile.");
  }

  const existingCredential = await getCredentialByUsername(ctx, {
    storeId: args.storeId,
    username: normalizedUsername,
  });

  if (existingCredential) {
    throw new Error("Username is already in use for this store.");
  }

  const credentialId = await ctx.db.insert("staffCredential", {
    staffProfileId: args.staffProfileId,
    organizationId: args.organizationId,
    storeId: args.storeId,
    username: normalizedUsername,
    pinHash: args.pinHash,
    status: args.pinHash ? ("active" as const) : ("pending" as const),
  });

  return ctx.db.get("staffCredential", credentialId);
}

export async function updateStaffCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organization">;
    pinHash?: string;
    staffCredentialId?: Id<"staffCredential">;
    staffProfileId?: Id<"staffProfile">;
    status?: StaffCredentialStatus;
    storeId: Id<"store">;
    username?: string;
  },
) {
  const existingCredential = args.staffCredentialId
    ? await getCredentialById(ctx, args.staffCredentialId)
    : args.staffProfileId
      ? await getStaffCredentialByStaffProfileIdWithCtx(
          ctx,
          args.staffProfileId,
        )
      : null;

  if (!existingCredential) {
    throw new Error("Staff credential not found.");
  }

  if (
    existingCredential.organizationId !== args.organizationId ||
    existingCredential.storeId !== args.storeId
  ) {
    throw new Error("Staff credential does not belong to this store.");
  }

  const updates: Record<string, unknown> = {};

  if (
    args.status === "active" ||
    args.username !== undefined ||
    args.pinHash !== undefined
  ) {
    await assertStaffProfileReadyForCredential(ctx, {
      organizationId: args.organizationId,
      staffProfileId: existingCredential.staffProfileId,
      storeId: args.storeId,
    });
  }

  if (args.username !== undefined) {
    const normalizedUsername = requireNonEmptyUsername(args.username);
    const conflictingCredential = await getCredentialByUsername(ctx, {
      storeId: args.storeId,
      username: normalizedUsername,
    });

    if (
      conflictingCredential &&
      conflictingCredential._id !== existingCredential._id
    ) {
      throw new Error("Username is already in use for this store.");
    }

    updates.username = normalizedUsername;
  }

  if (args.pinHash !== undefined) {
    updates.pinHash = args.pinHash;
  }

  const resolvedStatus =
    args.status ??
    (args.pinHash !== undefined && existingCredential.status === "pending"
      ? "active"
      : undefined);

  if (resolvedStatus !== undefined) {
    updates.status = resolvedStatus;
  }

  const nextStatus =
    (updates.status as StaffCredentialStatus | undefined) ??
    existingCredential.status;
  const nextPinHash =
    (updates.pinHash as string | undefined) ?? existingCredential.pinHash;

  if (nextStatus === "active" && !nextPinHash) {
    throw new Error("Active staff credentials require a PIN.");
  }

  if (Object.keys(updates).length === 0) {
    throw new Error("No credential changes were provided.");
  }

  await ctx.db.patch("staffCredential", existingCredential._id, updates);

  return ctx.db.get("staffCredential", existingCredential._id);
}

export async function authenticateStaffCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    allowedRoles?: OperationalRole[];
    pinHash: string;
    storeId: Id<"store">;
    username: string;
  },
): Promise<StaffCredentialAuthenticationResult> {
  const normalizedUsername = normalizeUsername(args.username);

  if (!normalizedUsername) {
    return invalidStaffCredentialsResult();
  }

  const matchingCredentials = await ctx.db
    .query("staffCredential")
    .withIndex("by_storeId_username", (q) =>
      q.eq("storeId", args.storeId).eq("username", normalizedUsername),
    )
    .take(2);

  const activeCredential = matchingCredentials.find(
    (credential) => credential.status === "active",
  );

  if (!activeCredential) {
    return invalidStaffCredentialsResult();
  }

  if (matchingCredentials.length > 1) {
    throw new Error("Multiple staff credentials match this username.");
  }

  if (!activeCredential.pinHash || activeCredential.pinHash !== args.pinHash) {
    return invalidStaffCredentialsResult();
  }

  const staffProfile = await ctx.db.get(
    "staffProfile",
    activeCredential.staffProfileId,
  );

  if (!staffProfile) {
    throw new Error("Staff profile not found.");
  }

  if (staffProfile.storeId !== args.storeId) {
    throw new Error("Staff profile does not belong to this store.");
  }

  if (staffProfile.status !== "active") {
    return staffAuthorizationFailedResult("Staff profile is not active.");
  }

  const activeRoles = await getActiveRolesForStaffProfile(ctx, {
    organizationId: activeCredential.organizationId,
    staffProfileId: activeCredential.staffProfileId,
    storeId: args.storeId,
  });

  if (activeRoles.length === 0) {
    return staffAuthorizationFailedResult(
      "Staff profile has no active role assignments.",
    );
  }

  const authorizedRoles =
    args.allowedRoles && args.allowedRoles.length > 0
      ? activeRoles.filter((role) => args.allowedRoles!.includes(role.role))
      : activeRoles;

  if (authorizedRoles.length === 0) {
    return staffAuthorizationFailedResult(
      "Staff profile is not authorized for this subsystem.",
    );
  }

  await ctx.db.patch("staffCredential", activeCredential._id, {
    lastAuthenticatedAt: Date.now(),
  });

  return ok({
    activeRoles: authorizedRoles.map((role) => role.role),
    credentialId: activeCredential._id,
    staffProfile,
    staffProfileId: activeCredential.staffProfileId,
  });
}

export async function authenticateStaffCredentialForTerminalWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    allowedRoles?: OperationalRole[];
    pinHash: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    username: string;
  },
): Promise<StaffCredentialAuthenticationResult> {
  const authentication = await authenticateStaffCredentialWithCtx(ctx, args);

  if (authentication.kind === "user_error") {
    return authentication;
  }

  // A staff member can only have a small number of live sessions, so reading them in full is safe.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const activeSessions = await ctx.db
    .query("posSession")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", authentication.data.staffProfileId),
    )
    .collect();
  const activeExpenseSessions = await ctx.db
    .query("expenseSession")
    .withIndex("by_staffProfileId_and_status", (q) =>
      q
        .eq("staffProfileId", authentication.data.staffProfileId)
        .eq("status", "active"),
    )
    .take(ACTIVE_STAFF_SESSION_LOOKUP_LIMIT);
  const now = Date.now();
  const activeSessionsOnOtherTerminals = activeSessions.filter(
    (session) =>
      session.status === "active" &&
      session.expiresAt > now &&
      session.terminalId !== args.terminalId,
  );
  const activeExpenseSessionsOnOtherTerminals = activeExpenseSessions.filter(
    (session) =>
      session.expiresAt > now && session.terminalId !== args.terminalId,
  );

  if (
    activeSessionsOnOtherTerminals.length > 0 ||
    activeExpenseSessionsOnOtherTerminals.length > 0
  ) {
    return staffPreconditionFailedResult(
      "This staff member has an active session on another terminal.",
    );
  }

  return authentication;
}

export const getStaffCredentialUsernameAvailability = query({
  args: {
    storeId: v.id("store"),
    username: v.string(),
  },
  handler: (ctx, args) =>
    getStaffCredentialUsernameAvailabilityWithCtx(ctx, args),
});

export const listStaffCredentialsByStore = query({
  args: {
    storeId: v.id("store"),
  },
  handler: (ctx, args) => listStaffCredentialsByStoreWithCtx(ctx, args),
});

export const createStaffCredential = mutation({
  args: {
    organizationId: v.id("organization"),
    pinHash: v.optional(v.string()),
    staffProfileId: v.id("staffProfile"),
    storeId: v.id("store"),
    username: v.string(),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    try {
      return ok(await createStaffCredentialWithCtx(ctx, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (message === "Staff profile not found.") {
        return userError({
          code: "not_found",
          message,
        });
      }

      if (
        message === "Staff profile does not belong to this store." ||
        message === "Staff credential already exists for this staff profile." ||
        message === "Username is already in use for this store."
      ) {
        return userError({
          code: "conflict",
          message,
        });
      }

      if (
        message === "Staff profile is not active." ||
        message === "Staff profile has no active role assignments." ||
        message === "Username is required."
      ) {
        return userError({
          code: "validation_failed",
          message,
        });
      }

      throw error;
    }
  },
});

export const updateStaffCredential = mutation({
  args: {
    organizationId: v.id("organization"),
    pinHash: v.optional(v.string()),
    staffCredentialId: v.optional(v.id("staffCredential")),
    staffProfileId: v.optional(v.id("staffProfile")),
    status: v.optional(STAFF_CREDENTIAL_STATUS),
    storeId: v.id("store"),
    username: v.optional(v.string()),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    try {
      return ok(await updateStaffCredentialWithCtx(ctx, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (message === "Staff credential not found.") {
        return userError({
          code: "not_found",
          message,
        });
      }

      if (
        message === "Staff credential does not belong to this store." ||
        message === "Username is already in use for this store."
      ) {
        return userError({
          code: "conflict",
          message,
        });
      }

      if (
        message === "Active staff credentials require a PIN." ||
        message === "No credential changes were provided." ||
        message === "Username is required." ||
        message === "Staff profile is not active." ||
        message === "Staff profile has no active role assignments."
      ) {
        return userError({
          code: "validation_failed",
          message,
        });
      }

      throw error;
    }
  },
});

export const authenticateStaffCredential = mutation({
  args: {
    allowedRoles: v.optional(v.array(operationalRoleValidator)),
    pinHash: v.string(),
    storeId: v.id("store"),
    username: v.string(),
  },
  handler: (ctx, args) => authenticateStaffCredentialWithCtx(ctx, args),
});

export const authenticateStaffCredentialForTerminal = mutation({
  args: {
    allowedRoles: v.optional(v.array(operationalRoleValidator)),
    pinHash: v.string(),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    username: v.string(),
  },
  handler: (ctx, args) =>
    authenticateStaffCredentialForTerminalWithCtx(ctx, args),
});
