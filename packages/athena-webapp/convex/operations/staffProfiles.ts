import { v } from "convex/values";
import type { Doc, Id } from "../_generated/dataModel";
import {
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../_generated/server";
import { ok, userError } from "../../shared/commandResult";
import { commandResultValidator } from "../lib/commandResultValidators";
import { normalizePhoneNumber } from "./helpers/linking";
import {
  createStaffCredentialWithCtx,
  getStaffCredentialByStaffProfileIdWithCtx,
  getStaffCredentialUsernameAvailabilityWithCtx,
  listStaffCredentialsByStoreWithCtx,
  updateStaffCredentialWithCtx,
  type StaffCredentialStatus,
} from "./staffCredentials";
import {
  deriveDefaultOperationalRoles,
  operationalRoleValidator,
  type OperationalRole,
  uniqueOperationalRoles,
} from "./staffRoles";

const MAX_STAFF_PROFILE_RESULTS = 100;
const MAX_STAFF_ROLE_ASSIGNMENTS = 20;
const MAX_STAFF_ROLE_RESULTS = MAX_STAFF_PROFILE_RESULTS * 5;

const staffProfileStatusValidator = v.union(
  v.literal("active"),
  v.literal("inactive")
);

type StaffProfileStatus = "active" | "inactive";
type StaffProfileReaderCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;

function normalizeOptionalString(value?: string) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function requireNameSegment(fieldName: "first name" | "last name", value?: string) {
  const normalizedValue = normalizeOptionalString(value);

  if (!normalizedValue) {
    throw new Error(`Staff ${fieldName} is required.`);
  }

  return normalizedValue;
}

function buildStaffFullName(firstName: string, lastName: string) {
  return `${firstName} ${lastName}`.trim();
}

async function ensureLinkedUserAvailable(
  ctx: StaffProfileReaderCtx,
  args: {
    linkedUserId?: Id<"athenaUser">;
    staffProfileId?: Id<"staffProfile">;
    storeId: Id<"store">;
  }
) {
  if (!args.linkedUserId) {
    return;
  }

  const existingProfile = await ctx.db
    .query("staffProfile")
    .withIndex("by_storeId_linkedUserId", (q) =>
      q.eq("storeId", args.storeId).eq("linkedUserId", args.linkedUserId)
    )
    .first();

  if (existingProfile && existingProfile._id !== args.staffProfileId) {
    throw new Error("A staff profile already links this Athena user in the store.");
  }
}

export function buildRoleAssignmentDrafts(args: {
  memberRole?: "full_admin" | "pos_only";
  organizationId: Id<"organization">;
  requestedRoles?: OperationalRole[];
  staffProfileId: Id<"staffProfile">;
  storeId: Id<"store">;
}) {
  const roles = uniqueOperationalRoles([
    ...(args.memberRole ? deriveDefaultOperationalRoles(args.memberRole) : []),
    ...(args.requestedRoles ?? []),
  ]);

  return roles.map((role, index) => ({
    staffProfileId: args.staffProfileId,
    storeId: args.storeId,
    organizationId: args.organizationId,
    role,
    isPrimary: index === 0,
    status: "active" as const,
  }));
}

function assertRoleConfiguration(args: {
  memberRole?: "full_admin" | "pos_only";
  requestedRoles?: OperationalRole[];
}) {
  const roles = uniqueOperationalRoles([
    ...(args.memberRole ? deriveDefaultOperationalRoles(args.memberRole) : []),
    ...(args.requestedRoles ?? []),
  ]);

  if (roles.length === 0) {
    throw new Error("At least one staff role is required.");
  }
}

async function syncStaffRoleAssignmentsWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    memberRole?: "full_admin" | "pos_only";
    organizationId: Id<"organization">;
    requestedRoles: OperationalRole[];
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
  }
) {
  assertRoleConfiguration(args);
  const desiredRoles = buildRoleAssignmentDrafts(args);

  const existingAssignments = await ctx.db
    .query("staffRoleAssignment")
    .withIndex("by_staffProfileId", (q) => q.eq("staffProfileId", args.staffProfileId))
    .take(MAX_STAFF_ROLE_ASSIGNMENTS);

  for (const assignment of existingAssignments) {
    if (!desiredRoles.some((candidate) => candidate.role === assignment.role)) {
      await ctx.db.patch("staffRoleAssignment", assignment._id, {
        isPrimary: false,
        status: "inactive",
      });
    }
  }

  for (const assignment of desiredRoles) {
    const current = existingAssignments.find(
      (candidate) => candidate.role === assignment.role
    );

    if (current) {
      await ctx.db.patch("staffRoleAssignment", current._id, {
        isPrimary: assignment.isPrimary,
        organizationId: args.organizationId,
        status: "active",
        storeId: args.storeId,
      });
      continue;
    }

    await ctx.db.insert("staffRoleAssignment", {
      ...assignment,
      assignedAt: Date.now(),
    });
  }
}

function normalizeStaffProfilePatch(args: {
  email?: string;
  phoneNumber?: string;
  staffCode?: string;
  jobTitle?: string;
  notes?: string;
  hiredAt?: number;
}) {
  return {
    email: normalizeOptionalString(args.email),
    hiredAt: args.hiredAt,
    jobTitle: normalizeOptionalString(args.jobTitle),
    notes: normalizeOptionalString(args.notes),
    phoneNumber: normalizePhoneNumber(args.phoneNumber),
    staffCode: normalizeOptionalString(args.staffCode),
  };
}

function buildStaffProfileResult(
  staffProfile: Doc<"staffProfile">,
  args: {
    credentialStatus: StaffCredentialStatus | null;
    primaryRole: OperationalRole | null;
    roles: OperationalRole[];
    username: string | null;
  }
) {
  return {
    ...staffProfile,
    credentialStatus: args.credentialStatus,
    primaryRole: args.primaryRole,
    roles: args.roles,
    username: args.username,
  };
}

export async function getStaffProfileByIdWithCtx(
  ctx: StaffProfileReaderCtx,
  args: {
    staffProfileId: Id<"staffProfile">;
  }
) {
  const staffProfile = await ctx.db.get("staffProfile", args.staffProfileId);

  if (!staffProfile) {
    return null;
  }

  const [roleAssignments, credential] = await Promise.all([
    ctx.db
      .query("staffRoleAssignment")
      .withIndex("by_staffProfileId", (q) =>
        q.eq("staffProfileId", args.staffProfileId)
      )
      .take(MAX_STAFF_ROLE_ASSIGNMENTS),
    getStaffCredentialByStaffProfileIdWithCtx(ctx, args.staffProfileId),
  ]);

  const activeRoleAssignments = roleAssignments.filter(
    (assignment) => assignment.status === "active"
  );
  const roles = activeRoleAssignments.map((assignment) => assignment.role);
  const primaryRole =
    activeRoleAssignments.find((assignment) => assignment.isPrimary)?.role ??
    roles[0] ??
    null;

  return buildStaffProfileResult(staffProfile, {
    credentialStatus: credential?.status ?? null,
    primaryRole,
    roles,
    username: credential?.username ?? null,
  });
}

export async function listStaffProfilesWithCtx(
  ctx: StaffProfileReaderCtx,
  args: {
    status?: StaffProfileStatus;
    storeId: Id<"store">;
  }
) {
  const [staffProfiles, roleAssignments, credentials] = await Promise.all([
    args.status
      ? ctx.db
          .query("staffProfile")
          .withIndex("by_storeId_status", (q) =>
            q.eq("storeId", args.storeId).eq("status", args.status!)
          )
          .take(MAX_STAFF_PROFILE_RESULTS)
      : ctx.db
          .query("staffProfile")
          .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
          .take(MAX_STAFF_PROFILE_RESULTS),
    ctx.db
      .query("staffRoleAssignment")
      .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
      .take(MAX_STAFF_ROLE_RESULTS),
    listStaffCredentialsByStoreWithCtx(ctx, { storeId: args.storeId }),
  ]);

  return staffProfiles.map((staffProfile) => {
    const activeRoleAssignments = roleAssignments.filter(
      (assignment) =>
        assignment.staffProfileId === staffProfile._id &&
        assignment.status === "active"
    );
    const roles = activeRoleAssignments.map((assignment) => assignment.role);
    const credential =
      credentials.find((candidate) => candidate.staffProfileId === staffProfile._id) ??
      null;

    return buildStaffProfileResult(staffProfile, {
      credentialStatus: credential?.status ?? null,
      primaryRole:
        activeRoleAssignments.find((assignment) => assignment.isPrimary)?.role ??
        roles[0] ??
        null,
      roles,
      username: credential?.username ?? null,
    });
  });
}

export async function createStaffProfileWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    createdByUserId?: Id<"athenaUser">;
    email?: string;
    firstName: string;
    hiredAt?: number;
    jobTitle?: string;
    lastName: string;
    linkedUserId?: Id<"athenaUser">;
    memberRole?: "full_admin" | "pos_only";
    notes?: string;
    organizationId: Id<"organization">;
    phoneNumber?: string;
    requestedRoles: OperationalRole[];
    staffCode?: string;
    storeId: Id<"store">;
    username: string;
  }
) {
  await ensureLinkedUserAvailable(ctx, {
    linkedUserId: args.linkedUserId,
    storeId: args.storeId,
  });
  assertRoleConfiguration(args);

  const usernameAvailability = await getStaffCredentialUsernameAvailabilityWithCtx(
    ctx as Pick<QueryCtx, "db">,
    {
      storeId: args.storeId,
      username: args.username,
    }
  );

  if (!usernameAvailability.available) {
    throw new Error("Username is already in use for this store.");
  }

  const firstName = requireNameSegment("first name", args.firstName);
  const lastName = requireNameSegment("last name", args.lastName);
  const profilePatch = {
    ...normalizeStaffProfilePatch(args),
    firstName,
    fullName: buildStaffFullName(firstName, lastName),
    lastName,
  };
  const staffProfileId = await ctx.db.insert("staffProfile", {
    ...profilePatch,
    createdByUserId: args.createdByUserId,
    linkedUserId: args.linkedUserId,
    memberRole: args.memberRole,
    organizationId: args.organizationId,
    status: "active" as const,
    storeId: args.storeId,
    updatedByUserId: args.createdByUserId,
  });

  await syncStaffRoleAssignmentsWithCtx(ctx, {
    memberRole: args.memberRole,
    organizationId: args.organizationId,
    requestedRoles: args.requestedRoles,
    staffProfileId,
    storeId: args.storeId,
  });

  await createStaffCredentialWithCtx(ctx, {
    organizationId: args.organizationId,
    staffProfileId,
    storeId: args.storeId,
    username: args.username,
  });

  return getStaffProfileByIdWithCtx(ctx, { staffProfileId });
}

export async function updateStaffProfileWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    email?: string;
    firstName?: string;
    hiredAt?: number;
    jobTitle?: string;
    lastName?: string;
    linkedUserId?: Id<"athenaUser">;
    memberRole?: "full_admin" | "pos_only";
    notes?: string;
    organizationId: Id<"organization">;
    phoneNumber?: string;
    requestedRoles?: OperationalRole[];
    staffCode?: string;
    staffProfileId: Id<"staffProfile">;
    status?: StaffProfileStatus;
    storeId: Id<"store">;
    updatedByUserId?: Id<"athenaUser">;
    username?: string;
  }
) {
  const existingProfile = await ctx.db.get("staffProfile", args.staffProfileId);

  if (!existingProfile) {
    throw new Error("Staff profile not found.");
  }

  if (
    existingProfile.storeId !== args.storeId ||
    existingProfile.organizationId !== args.organizationId
  ) {
    throw new Error("Staff profile does not belong to this store.");
  }

  if (args.linkedUserId !== undefined) {
    await ensureLinkedUserAvailable(ctx, {
      linkedUserId: args.linkedUserId,
      staffProfileId: args.staffProfileId,
      storeId: args.storeId,
    });
  }

  if (args.requestedRoles) {
    assertRoleConfiguration({
      memberRole: args.memberRole ?? existingProfile.memberRole,
      requestedRoles: args.requestedRoles,
    });
  }

  const firstName = requireNameSegment(
    "first name",
    args.firstName ?? existingProfile.firstName
  );
  const lastName = requireNameSegment(
    "last name",
    args.lastName ?? existingProfile.lastName
  );

  const updates = {
    ...normalizeStaffProfilePatch(args),
    firstName,
    fullName: buildStaffFullName(firstName, lastName),
    lastName,
    linkedUserId:
      args.linkedUserId === undefined ? existingProfile.linkedUserId : args.linkedUserId,
    memberRole: args.memberRole ?? existingProfile.memberRole,
    status: args.status ?? existingProfile.status,
    updatedByUserId: args.updatedByUserId ?? existingProfile.updatedByUserId,
  };

  const hasProfileUpdates =
    args.email !== undefined ||
    args.firstName !== undefined ||
    args.hiredAt !== undefined ||
    args.jobTitle !== undefined ||
    args.lastName !== undefined ||
    args.linkedUserId !== undefined ||
    args.memberRole !== undefined ||
    args.notes !== undefined ||
    args.phoneNumber !== undefined ||
    args.staffCode !== undefined ||
    args.status !== undefined ||
    args.updatedByUserId !== undefined;
  const hasCredentialUpdates = args.username !== undefined;

  if (!hasProfileUpdates && !args.requestedRoles && !hasCredentialUpdates) {
    throw new Error("No staff profile changes were provided.");
  }

  await ctx.db.patch("staffProfile", args.staffProfileId, updates);

  if (args.requestedRoles) {
    await syncStaffRoleAssignmentsWithCtx(ctx, {
      memberRole: args.memberRole ?? existingProfile.memberRole,
      organizationId: args.organizationId,
      requestedRoles: args.requestedRoles,
      staffProfileId: args.staffProfileId,
      storeId: args.storeId,
    });
  }

  if (args.username !== undefined) {
    const existingCredential = await getStaffCredentialByStaffProfileIdWithCtx(
      ctx,
      args.staffProfileId
    );

    if (existingCredential) {
      await updateStaffCredentialWithCtx(ctx, {
        organizationId: args.organizationId,
        staffProfileId: args.staffProfileId,
        storeId: args.storeId,
        username: args.username,
      });
    } else {
      await createStaffCredentialWithCtx(ctx, {
        organizationId: args.organizationId,
        staffProfileId: args.staffProfileId,
        storeId: args.storeId,
        username: args.username,
      });
    }
  }

  return getStaffProfileByIdWithCtx(ctx, {
    staffProfileId: args.staffProfileId,
  });
}

export const getByUserAndStore = internalQuery({
  args: {
    storeId: v.id("store"),
    userId: v.id("athenaUser"),
  },
  handler: async (ctx, args) =>
    ctx.db
      .query("staffProfile")
      .withIndex("by_storeId_linkedUserId", (q) =>
        q.eq("storeId", args.storeId).eq("linkedUserId", args.userId)
      )
      .first(),
});

export const getStaffProfileById = query({
  args: {
    staffProfileId: v.id("staffProfile"),
  },
  handler: (ctx, args) => getStaffProfileByIdWithCtx(ctx, args),
});

export const listStaffProfiles = query({
  args: {
    status: v.optional(staffProfileStatusValidator),
    storeId: v.id("store"),
  },
  handler: (ctx, args) => listStaffProfilesWithCtx(ctx, args),
});

export const createStaffProfile = mutation({
  args: {
    createdByUserId: v.optional(v.id("athenaUser")),
    email: v.optional(v.string()),
    firstName: v.string(),
    hiredAt: v.optional(v.number()),
    jobTitle: v.optional(v.string()),
    lastName: v.string(),
    linkedUserId: v.optional(v.id("athenaUser")),
    memberRole: v.optional(v.union(v.literal("full_admin"), v.literal("pos_only"))),
    notes: v.optional(v.string()),
    organizationId: v.id("organization"),
    phoneNumber: v.optional(v.string()),
    requestedRoles: v.array(operationalRoleValidator),
    staffCode: v.optional(v.string()),
    storeId: v.id("store"),
    username: v.string(),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    try {
      return ok(await createStaffProfileWithCtx(ctx, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (
        message === "Username is already in use for this store." ||
        message === "A staff profile already links this Athena user in the store."
      ) {
        return userError({
          code: "conflict",
          message,
        });
      }

      if (
        message === "At least one staff role is required." ||
        message.startsWith("Staff first name is required.") ||
        message.startsWith("Staff last name is required.")
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

export const updateStaffProfile = mutation({
  args: {
    email: v.optional(v.string()),
    firstName: v.optional(v.string()),
    hiredAt: v.optional(v.number()),
    jobTitle: v.optional(v.string()),
    lastName: v.optional(v.string()),
    linkedUserId: v.optional(v.id("athenaUser")),
    memberRole: v.optional(v.union(v.literal("full_admin"), v.literal("pos_only"))),
    notes: v.optional(v.string()),
    organizationId: v.id("organization"),
    phoneNumber: v.optional(v.string()),
    requestedRoles: v.optional(v.array(operationalRoleValidator)),
    staffCode: v.optional(v.string()),
    staffProfileId: v.id("staffProfile"),
    status: v.optional(staffProfileStatusValidator),
    storeId: v.id("store"),
    updatedByUserId: v.optional(v.id("athenaUser")),
    username: v.optional(v.string()),
  },
  returns: commandResultValidator(v.any()),
  handler: async (ctx, args) => {
    try {
      return ok(await updateStaffProfileWithCtx(ctx, args));
    } catch (error) {
      const message = error instanceof Error ? error.message : "";

      if (
        message === "Staff profile not found." ||
        message === "Staff credential not found."
      ) {
        return userError({
          code: "not_found",
          message,
        });
      }

      if (
        message === "Staff profile does not belong to this store." ||
        message === "Username is already in use for this store." ||
        message === "A staff profile already links this Athena user in the store."
      ) {
        return userError({
          code: "conflict",
          message,
        });
      }

      if (
        message === "No staff profile changes were provided." ||
        message === "At least one staff role is required." ||
        message.startsWith("Staff first name is required.") ||
        message.startsWith("Staff last name is required.")
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
