import { v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import type { Id } from "../_generated/dataModel";

const operationalRoleValidator = v.union(
  v.literal("manager"),
  v.literal("front_desk"),
  v.literal("stylist"),
  v.literal("technician"),
  v.literal("cashier")
);

const STAFF_CREDENTIAL_STATUS = v.union(
  v.literal("active"),
  v.literal("suspended"),
  v.literal("revoked")
);

type StaffCredentialStatus = "active" | "suspended" | "revoked";
type OperationalRole =
  | "manager"
  | "front_desk"
  | "stylist"
  | "technician"
  | "cashier";
type StaffCredentialReaderCtx =
  | Pick<QueryCtx, "db">
  | Pick<MutationCtx, "db">;

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

async function getCredentialByStaffProfileId(
  ctx: StaffCredentialReaderCtx,
  staffProfileId: Id<"staffProfile">
) {
  const activeCredential = await ctx.db
    .query("staffCredential")
    .withIndex("by_staffProfileId_status", (q) =>
      q.eq("staffProfileId", staffProfileId).eq("status", "active")
    )
    .first();

  if (activeCredential) {
    return activeCredential;
  }

  return ctx.db
    .query("staffCredential")
    .withIndex("by_staffProfileId", (q) => q.eq("staffProfileId", staffProfileId))
    .first();
}

async function getCredentialById(
  ctx: StaffCredentialReaderCtx,
  staffCredentialId: Id<"staffCredential">
) {
  return ctx.db.get("staffCredential", staffCredentialId);
}

async function getCredentialByUsername(
  ctx: StaffCredentialReaderCtx,
  args: {
    storeId: Id<"store">;
    username: string;
  }
) {
  const normalizedUsername = normalizeUsername(args.username);

  if (!normalizedUsername) {
    return null;
  }

  return ctx.db
    .query("staffCredential")
    .withIndex("by_storeId_username", (q) =>
      q.eq("storeId", args.storeId).eq("username", normalizedUsername)
    )
    .first();
}

async function getActiveRolesForStaffProfile(
  ctx: StaffCredentialReaderCtx,
  args: {
    organizationId: Id<"organization">;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
  }
) {
  const roleAssignments = await ctx.db
    .query("staffRoleAssignment")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", args.staffProfileId)
    )
    .take(20);

  return roleAssignments.filter(
    (assignment) =>
      assignment.status === "active" &&
      assignment.organizationId === args.organizationId &&
      assignment.storeId === args.storeId
  );
}

async function assertStaffProfileReadyForCredential(
  ctx: StaffCredentialReaderCtx,
  args: {
    organizationId: Id<"organization">;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
  }
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
  }
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
  }
) {
  // Store staff rosters stay small enough for the admin credential screen to read them in full.
  const [activeCredentials, suspendedCredentials, revokedCredentials] =
    await Promise.all([
      // eslint-disable-next-line @convex-dev/no-collect-in-query
      ctx.db
        .query("staffCredential")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "active")
        )
        .collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query
      ctx.db
        .query("staffCredential")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "suspended")
        )
        .collect(),
      // eslint-disable-next-line @convex-dev/no-collect-in-query
      ctx.db
        .query("staffCredential")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "revoked")
        )
        .collect(),
    ]);

  return [...activeCredentials, ...suspendedCredentials, ...revokedCredentials];
}

export async function createStaffCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    organizationId: Id<"organization">;
    pinHash: string;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    username: string;
  }
) {
  const normalizedUsername = requireNonEmptyUsername(args.username);

  await assertStaffProfileReadyForCredential(ctx, args);

  const existingCredentialForStaffProfile = await getCredentialByStaffProfileId(
    ctx,
    args.staffProfileId
  );

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
    status: "active" as const,
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
  }
) {
  const existingCredential = args.staffCredentialId
    ? await getCredentialById(ctx, args.staffCredentialId)
    : args.staffProfileId
      ? await getCredentialByStaffProfileId(ctx, args.staffProfileId)
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

    if (conflictingCredential && conflictingCredential._id !== existingCredential._id) {
      throw new Error("Username is already in use for this store.");
    }

    updates.username = normalizedUsername;
  }

  if (args.pinHash !== undefined) {
    updates.pinHash = args.pinHash;
  }

  if (args.status !== undefined) {
    updates.status = args.status;
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
  }
) {
  const normalizedUsername = requireNonEmptyUsername(args.username);
  const matchingCredentials = await ctx.db
    .query("staffCredential")
    .withIndex("by_storeId_username", (q) =>
      q.eq("storeId", args.storeId).eq("username", normalizedUsername)
    )
    .take(2);

  const activeCredential = matchingCredentials.find(
    (credential) => credential.status === "active"
  );

  if (!activeCredential) {
    throw new Error("Invalid staff credentials.");
  }

  if (matchingCredentials.length > 1) {
    throw new Error("Multiple staff credentials match this username.");
  }

  if (activeCredential.pinHash !== args.pinHash) {
    throw new Error("Invalid staff credentials.");
  }

  const staffProfile = await ctx.db.get(
    "staffProfile",
    activeCredential.staffProfileId
  );

  if (!staffProfile) {
    throw new Error("Staff profile not found.");
  }

  if (staffProfile.storeId !== args.storeId) {
    throw new Error("Staff profile does not belong to this store.");
  }

  if (staffProfile.status !== "active") {
    throw new Error("Staff profile is not active.");
  }

  const activeRoles = await getActiveRolesForStaffProfile(ctx, {
    organizationId: activeCredential.organizationId,
    staffProfileId: activeCredential.staffProfileId,
    storeId: args.storeId,
  });

  if (activeRoles.length === 0) {
    throw new Error("Staff profile has no active role assignments.");
  }

  const authorizedRoles =
    args.allowedRoles && args.allowedRoles.length > 0
      ? activeRoles.filter((role) => args.allowedRoles!.includes(role.role))
      : activeRoles;

  if (authorizedRoles.length === 0) {
    throw new Error("Staff profile is not authorized for this subsystem.");
  }

  await ctx.db.patch("staffCredential", activeCredential._id, {
    lastAuthenticatedAt: Date.now(),
  });

  return {
    activeRoles: authorizedRoles.map((role) => role.role),
    credentialId: activeCredential._id,
    staffProfile,
    staffProfileId: activeCredential.staffProfileId,
  };
}

export async function authenticateStaffCredentialForTerminalWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    allowedRoles?: OperationalRole[];
    pinHash: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    username: string;
  }
) {
  const authentication = await authenticateStaffCredentialWithCtx(ctx, args);
  // A staff member can only have a small number of live sessions, so reading them in full is safe.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const activeSessions = await ctx.db
    .query("posSession")
    .withIndex("by_staffProfileId", (q) =>
      q.eq("staffProfileId", authentication.staffProfileId)
    )
    .collect();
  const now = Date.now();
  const activeSessionsOnOtherTerminals = activeSessions.filter(
    (session) =>
      session.status === "active" &&
      session.expiresAt > now &&
      session.terminalId !== args.terminalId
  );

  if (activeSessionsOnOtherTerminals.length > 0) {
    throw new Error("This staff member has an active session on another terminal.");
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
    pinHash: v.string(),
    staffProfileId: v.id("staffProfile"),
    storeId: v.id("store"),
    username: v.string(),
  },
  handler: (ctx, args) => createStaffCredentialWithCtx(ctx, args),
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
  handler: (ctx, args) => updateStaffCredentialWithCtx(ctx, args),
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
  handler: (ctx, args) => authenticateStaffCredentialForTerminalWithCtx(ctx, args),
});
