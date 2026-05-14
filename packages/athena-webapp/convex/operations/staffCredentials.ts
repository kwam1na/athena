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
import type { ApprovalSubjectIdentity } from "../../shared/approvalPolicy";
import { createApprovalProofWithCtx } from "./approvalProofs";
import {
  createPosLocalStaffProofToken,
  hashPosLocalStaffProofToken,
  POS_LOCAL_STAFF_PROOF_TTL_MS,
} from "../pos/application/sync/staffProof";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../lib/athenaUserAuth";

export const STAFF_CREDENTIAL_STATUS = v.union(
  v.literal("pending"),
  v.literal("active"),
  v.literal("suspended"),
  v.literal("revoked"),
);

const localPinVerifierValidator = v.object({
  algorithm: v.string(),
  hash: v.string(),
  iterations: v.number(),
  salt: v.string(),
  version: v.number(),
});

const localStaffAuthorityRecordValidator = v.object({
  activeRoles: v.array(v.union(v.literal("cashier"), v.literal("manager"))),
  credentialId: v.id("staffCredential"),
  credentialVersion: v.number(),
  displayName: v.optional(v.union(v.string(), v.null())),
  expiresAt: v.number(),
  issuedAt: v.number(),
  organizationId: v.id("organization"),
  refreshedAt: v.number(),
  staffProfileId: v.id("staffProfile"),
  status: v.literal("active"),
  storeId: v.id("store"),
  terminalId: v.id("posTerminal"),
  username: v.string(),
  verifier: localPinVerifierValidator,
});

export type StaffCredentialStatus =
  | "pending"
  | "active"
  | "suspended"
  | "revoked";
type StaffCredentialReaderCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type PublicStaffCredential = Omit<
  Doc<"staffCredential">,
  "localPinVerifier" | "localVerifierVersion" | "pinHash"
>;

type StaffCredentialAuthenticationData = {
  activeRoles: OperationalRole[];
  credentialId: Id<"staffCredential">;
  credentialVersion?: number;
  posLocalStaffProof?: {
    expiresAt: number;
    token: string;
  };
  staffProfile: Doc<"staffProfile">;
  staffProfileId: Id<"staffProfile">;
};

type StaffCredentialAuthenticationResult =
  CommandResult<StaffCredentialAuthenticationData>;

type StaffCredentialApprovalAuthenticationData = {
  approvalProofId: Id<"approvalProof">;
  approvedByStaffProfileId: Id<"staffProfile">;
  expiresAt: number;
  requestedByStaffProfileId?: Id<"staffProfile">;
};

type PosTerminalAuthorizationResult = CommandResult<{
  store: Doc<"store">;
  terminal: Doc<"posTerminal">;
}>;

const ACTIVE_STAFF_SESSION_LOOKUP_LIMIT = 100;
const STAFF_AUTHORITY_REFRESH_LIMIT = 1_000;

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

function terminalAuthorizationFailedResult(): PosTerminalAuthorizationResult {
  return userError({
    code: "authorization_failed",
    message: "This terminal is not available for staff authentication.",
  });
}

async function requirePosTerminalAuthorityWithCtx(
  ctx: MutationCtx,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<PosTerminalAuthorizationResult> {
  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (!terminal || terminal.storeId !== args.storeId || terminal.status !== "active") {
    return terminalAuthorizationFailedResult();
  }

  try {
    const store = await ctx.db.get("store", args.storeId);
    if (!store) {
      return terminalAuthorizationFailedResult();
    }
    const athenaUser = await requireAuthenticatedAthenaUserWithCtx(ctx);
    if (terminal.registeredByUserId !== athenaUser._id) {
      return terminalAuthorizationFailedResult();
    }
    await requireOrganizationMemberRoleWithCtx(ctx, {
      allowedRoles: ["full_admin", "pos_only"],
      failureMessage: "You do not have access to this POS terminal.",
      organizationId: store.organizationId,
      userId: athenaUser._id,
    });

    return ok({ store, terminal });
  } catch {
    return terminalAuthorizationFailedResult();
  }
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
): Promise<PublicStaffCredential[]> {
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
  ].map(toPublicStaffCredential);
}

function toPublicStaffCredential(
  credential: Doc<"staffCredential">,
): PublicStaffCredential {
  const {
    localPinVerifier: _localPinVerifier,
    localVerifierVersion: _localVerifierVersion,
    pinHash: _pinHash,
    ...publicCredential
  } = credential;
  return publicCredential;
}

export async function createStaffCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    localPinVerifier?: {
      algorithm: string;
      hash: string;
      iterations: number;
      salt: string;
      version: number;
    };
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
    ...(args.localPinVerifier
      ? {
          localPinVerifier: args.localPinVerifier,
          localVerifierVersion: 1,
        }
      : {}),
    pinHash: args.pinHash,
    status: args.pinHash ? ("active" as const) : ("pending" as const),
  });

  const credential = await ctx.db.get("staffCredential", credentialId);
  if (!credential) return null;
  return toPublicStaffCredential(credential);
}

export async function updateStaffCredentialWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    localPinVerifier?: {
      algorithm: string;
      hash: string;
      iterations: number;
      salt: string;
      version: number;
    };
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
    updates.localPinVerifier = args.localPinVerifier;
    updates.localVerifierVersion =
      (existingCredential.localVerifierVersion ?? 0) + 1;
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

  const credential = await ctx.db.get("staffCredential", existingCredential._id);
  if (!credential) return null;
  return toPublicStaffCredential(credential);
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
    ...(activeCredential.localVerifierVersion
      ? { credentialVersion: activeCredential.localVerifierVersion }
      : {}),
    staffProfile,
    staffProfileId: activeCredential.staffProfileId,
  });
}

export async function authenticateStaffCredentialForTerminalWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    allowedRoles?: OperationalRole[];
    allowActiveSessionsOnOtherTerminals?: boolean;
    pinHash: string;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    username: string;
  },
): Promise<StaffCredentialAuthenticationResult> {
  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (
    !terminal ||
    terminal.storeId !== args.storeId ||
    terminal.status !== "active"
  ) {
    return staffAuthorizationFailedResult(
      "This terminal is not available for staff authentication.",
    );
  }

  const authentication = await authenticateStaffCredentialWithCtx(ctx, args);

  if (authentication.kind === "user_error") {
    return authentication;
  }

  if (args.allowActiveSessionsOnOtherTerminals) {
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

  return withPosLocalStaffProof(ctx, authentication, args);
}

async function withPosLocalStaffProof(
  ctx: Pick<MutationCtx, "db">,
  authentication: StaffCredentialAuthenticationResult,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
): Promise<StaffCredentialAuthenticationResult> {
  if (authentication.kind !== "ok") {
    return authentication;
  }

  const credential = await ctx.db.get(
    "staffCredential",
    authentication.data.credentialId,
  );
  const proof = await issuePosLocalStaffProofWithCtx(ctx, {
    credentialId: authentication.data.credentialId,
    credentialVersion: credential?.localVerifierVersion,
    staffProfileId: authentication.data.staffProfileId,
    storeId: args.storeId,
    terminalId: args.terminalId,
  });

  return ok({
    ...authentication.data,
    posLocalStaffProof: proof,
  });
}

async function issuePosLocalStaffProofWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    credentialId: Id<"staffCredential">;
    credentialVersion?: number;
    staffProfileId: Id<"staffProfile">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const now = Date.now();
  const token = createPosLocalStaffProofToken();
  const expiresAt = now + POS_LOCAL_STAFF_PROOF_TTL_MS;

  await ctx.db.insert("posLocalStaffProof", {
    credentialId: args.credentialId,
    ...(args.credentialVersion
      ? { credentialVersion: args.credentialVersion }
      : {}),
    createdAt: now,
    expiresAt,
    staffProfileId: args.staffProfileId,
    status: "active",
    storeId: args.storeId,
    terminalId: args.terminalId,
    tokenHash: await hashPosLocalStaffProofToken(token),
  });

  return { expiresAt, token };
}

export async function authenticateStaffCredentialForApprovalWithCtx(
  ctx: Pick<MutationCtx, "db">,
  args: {
    actionKey: string;
    pinHash: string;
    reason?: string;
    requiredRole: OperationalRole;
    requestedByStaffProfileId?: Id<"staffProfile">;
    storeId: Id<"store">;
    subject: ApprovalSubjectIdentity;
    username: string;
  },
): Promise<CommandResult<StaffCredentialApprovalAuthenticationData>> {
  const authentication = await authenticateStaffCredentialWithCtx(ctx, {
    allowedRoles: [args.requiredRole],
    pinHash: args.pinHash,
    storeId: args.storeId,
    username: args.username,
  });

  if (authentication.kind !== "ok") {
    return authentication;
  }

  return createApprovalProofWithCtx(ctx as MutationCtx, {
    actionKey: args.actionKey,
    approvedByCredentialId: authentication.data.credentialId,
    approvedByStaffProfileId: authentication.data.staffProfileId,
    organizationId: authentication.data.staffProfile.organizationId,
    reason: args.reason,
    requiredRole: args.requiredRole,
    requestedByStaffProfileId: args.requestedByStaffProfileId,
    storeId: args.storeId,
    subject: args.subject,
  });
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
    localPinVerifier: v.optional(localPinVerifierValidator),
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
    localPinVerifier: v.optional(localPinVerifierValidator),
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
    allowActiveSessionsOnOtherTerminals: v.optional(v.boolean()),
    pinHash: v.string(),
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
    username: v.string(),
  },
  handler: async (ctx, args) => {
    const terminalAuthority = await requirePosTerminalAuthorityWithCtx(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
    if (terminalAuthority.kind !== "ok") {
      return terminalAuthority;
    }

    return authenticateStaffCredentialForTerminalWithCtx(ctx, args);
  },
});

export const refreshTerminalStaffAuthority = mutation({
  args: {
    storeId: v.id("store"),
    terminalId: v.id("posTerminal"),
  },
  returns: commandResultValidator(v.array(localStaffAuthorityRecordValidator)),
  handler: async (ctx, args) => {
    const terminalAuthority = await requirePosTerminalAuthorityWithCtx(ctx, {
      storeId: args.storeId,
      terminalId: args.terminalId,
    });
    if (terminalAuthority.kind !== "ok") {
      return terminalAuthority;
    }

    const refreshedAt = Date.now();
    const credentials = await ctx.db
      .query("staffCredential")
      .withIndex("by_storeId_status", (q) =>
        q.eq("storeId", args.storeId).eq("status", "active"),
      )
      .take(STAFF_AUTHORITY_REFRESH_LIMIT + 1);
    const [profiles, roleAssignments] = await Promise.all([
      ctx.db
        .query("staffProfile")
        .withIndex("by_storeId_status", (q) =>
          q.eq("storeId", args.storeId).eq("status", "active"),
        )
        .take(STAFF_AUTHORITY_REFRESH_LIMIT + 1),
      ctx.db
        .query("staffRoleAssignment")
        .withIndex("by_storeId", (q) => q.eq("storeId", args.storeId))
        .take(STAFF_AUTHORITY_REFRESH_LIMIT + 1),
    ]);
    if (
      credentials.length > STAFF_AUTHORITY_REFRESH_LIMIT ||
      profiles.length > STAFF_AUTHORITY_REFRESH_LIMIT ||
      roleAssignments.length > STAFF_AUTHORITY_REFRESH_LIMIT
    ) {
      return userError({
        code: "precondition_failed",
        message:
          "Staff sign-in list is too large to refresh safely. Contact support before using offline sign-in.",
      });
    }
    const activeProfilesById = new Map(
      profiles.map((profile) => [profile._id, profile]),
    );
    const activePosRolesByStaffProfileId = new Map<
      Id<"staffProfile">,
      Array<"cashier" | "manager">
    >();
    for (const assignment of roleAssignments) {
      if (
        assignment.status !== "active" ||
        (assignment.role !== "cashier" && assignment.role !== "manager")
      ) {
        continue;
      }
      const roles = activePosRolesByStaffProfileId.get(assignment.staffProfileId) ?? [];
      roles.push(assignment.role);
      activePosRolesByStaffProfileId.set(assignment.staffProfileId, roles);
    }
    const authority = [];

    for (const credential of credentials) {
      if (
        !credential.pinHash ||
        !credential.localPinVerifier ||
        !credential.localVerifierVersion
      ) {
        continue;
      }

      const staffProfile = activeProfilesById.get(credential.staffProfileId);
      if (
        !staffProfile ||
        staffProfile.storeId !== args.storeId ||
        staffProfile.status !== "active"
      ) {
        continue;
      }

      const activeRoles =
        activePosRolesByStaffProfileId.get(credential.staffProfileId) ?? [];

      if (activeRoles.length === 0) {
        continue;
      }

      const expiresAt = refreshedAt + POS_LOCAL_STAFF_PROOF_TTL_MS;

      authority.push({
        activeRoles,
        credentialId: credential._id,
        credentialVersion: credential.localVerifierVersion,
        displayName:
          staffProfile.fullName ??
          [staffProfile.firstName, staffProfile.lastName]
            .filter(Boolean)
            .join(" ") ??
          null,
        expiresAt,
        issuedAt: refreshedAt,
        organizationId: credential.organizationId,
        refreshedAt,
        staffProfileId: credential.staffProfileId,
        status: credential.status,
        storeId: args.storeId,
        terminalId: args.terminalId,
        username: credential.username,
        verifier: credential.localPinVerifier,
      });
    }

    return ok(authority);
  },
});

export const authenticateStaffCredentialForApproval = mutation({
  args: {
    actionKey: v.string(),
    pinHash: v.string(),
    reason: v.optional(v.string()),
    requiredRole: operationalRoleValidator,
    requestedByStaffProfileId: v.optional(v.id("staffProfile")),
    storeId: v.id("store"),
    subject: v.object({
      type: v.string(),
      id: v.string(),
      label: v.optional(v.string()),
    }),
    username: v.string(),
  },
  returns: commandResultValidator(
    v.object({
      approvalProofId: v.id("approvalProof"),
      approvedByStaffProfileId: v.id("staffProfile"),
      expiresAt: v.number(),
      requestedByStaffProfileId: v.optional(v.id("staffProfile")),
    }),
  ),
  handler: (ctx, args) =>
    authenticateStaffCredentialForApprovalWithCtx(ctx, args),
});
