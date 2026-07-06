import { v } from "convex/values";

import type { Doc, Id } from "../../_generated/dataModel";
import {
  internalMutation,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "../../_generated/server";
import { recordOperationalEventWithCtx } from "../../operations/operationalEvents";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";

const POS_RECOVERY_ACCOUNT_EMAIL = "pos@wigclub.store";
const POS_RECOVERY_CODE_VERSION = 1;
const POS_RECOVERY_FAILURE_AUDIT_BUCKET_MS = 15 * 60 * 1000;
const POS_RECOVERY_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const POS_RECOVERY_CODE_GROUP_SIZE = 4;
const POS_RECOVERY_CODE_GROUP_COUNT = 3;
const POS_RECOVERY_CODE_LENGTH =
  POS_RECOVERY_CODE_GROUP_SIZE * POS_RECOVERY_CODE_GROUP_COUNT;
const POS_RECOVERY_CODE_WORDS = [
  "anchor",
  "apron",
  "basket",
  "beacon",
  "berry",
  "blanket",
  "bottle",
  "bridge",
  "brush",
  "button",
  "candle",
  "canvas",
  "cart",
  "cedar",
  "chair",
  "circle",
  "clay",
  "clock",
  "cloud",
  "cocoa",
  "copper",
  "coral",
  "cotton",
  "cup",
  "daisy",
  "desk",
  "drum",
  "fabric",
  "feather",
  "field",
  "flame",
  "flower",
  "frame",
  "garden",
  "ginger",
  "glass",
  "globe",
  "grape",
  "harbor",
  "hazel",
  "honey",
  "ivory",
  "jacket",
  "jewel",
  "kettle",
  "ladder",
  "lamp",
  "leaf",
  "linen",
  "maple",
  "marble",
  "meadow",
  "mint",
  "mirror",
  "moss",
  "needle",
  "notebook",
  "olive",
  "orange",
  "paddle",
  "paper",
  "pearl",
  "pencil",
  "pepper",
  "petal",
  "pillow",
  "plum",
  "pocket",
  "ribbon",
  "river",
  "saddle",
  "saffron",
  "shell",
  "silver",
  "sketch",
  "slate",
  "spoon",
  "stone",
  "table",
  "thread",
  "ticket",
  "toast",
  "velvet",
  "violet",
  "walnut",
  "window",
  "wood",
  "wool",
] as const;
const GENERIC_RECOVERY_FAILURE = "POS recovery sign-in failed.";

type PosRecoveryCredential = Doc<"posRecoveryCredential">;
type PosRecoveryCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type PosRecoveryAccessCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function bytesToHex(bytes: ArrayBuffer | Uint8Array) {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(data)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function randomHex(byteCount: number) {
  const bytes = new Uint8Array(byteCount);
  crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function randomIndex(max: number) {
  const maxUniformByte = Math.floor(256 / max) * max;
  const byte = new Uint8Array(1);

  do {
    crypto.getRandomValues(byte);
  } while (byte[0] >= maxUniformByte);

  return byte[0] % max;
}

function formatRecoveryCode(compactCode: string) {
  return (
    compactCode
      .match(new RegExp(`.{1,${POS_RECOVERY_CODE_GROUP_SIZE}}`, "g"))
      ?.join("-") ?? compactCode
  );
}

function generateRecoveryCode() {
  const words = Array.from(
    { length: 2 },
    () => POS_RECOVERY_CODE_WORDS[randomIndex(POS_RECOVERY_CODE_WORDS.length)],
  );
  const number = randomIndex(100).toString().padStart(2, "0");

  return `${words.join("")}${number}`;
}

function normalizeRecoveryCode(code: string) {
  const compactCode = code
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");

  if (
    compactCode.length === POS_RECOVERY_CODE_LENGTH &&
    Array.from(compactCode).every((character) =>
      POS_RECOVERY_CODE_ALPHABET.includes(character),
    )
  ) {
    return formatRecoveryCode(compactCode);
  }

  return code
    .trim()
    .toLowerCase()
    .replace(/[-\s]+/g, "");
}

function getFailureAuditBucket(now: number) {
  return Math.floor(now / POS_RECOVERY_FAILURE_AUDIT_BUCKET_MS);
}

export async function hashPosRecoveryCode(args: {
  code: string;
  salt: string;
}) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      `${args.salt}:${normalizeRecoveryCode(args.code)}`,
    ),
  );

  return bytesToHex(digest);
}

async function findAthenaUserByEmail(ctx: PosRecoveryCtx, email: string) {
  const normalizedEmail = normalizeEmail(email);
  // Case-insensitive lookup mirrors the existing Athena auth-sync helper until
  // athenaUser gains a normalized-email index.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const users = await ctx.db.query("athenaUser").collect();
  const matches = users.filter(
    (user) => normalizeEmail(user.email) === normalizedEmail,
  );

  if (matches.length > 1) {
    throw new Error("Multiple Athena users match the POS recovery account.");
  }

  return matches[0] ?? null;
}

async function findAuthUserByEmail(ctx: PosRecoveryCtx, email: string) {
  const normalizedEmail = normalizeEmail(email);
  // Convex Auth's user table does not expose a stable generated email index in
  // this repo, so match the existing auth-sync fallback.
  // eslint-disable-next-line @convex-dev/no-collect-in-query
  const users = await ctx.db.query("users").collect();
  const matches = users.filter((user) => {
    const candidate = "email" in user ? user.email : undefined;
    return (
      typeof candidate === "string" &&
      normalizeEmail(candidate) === normalizedEmail
    );
  });

  if (matches.length > 1) {
    throw new Error("Multiple auth users match the POS recovery account.");
  }

  return matches[0] ?? null;
}

async function getCredentialForStore(
  ctx: PosRecoveryCtx,
  args: {
    posAccountId: Id<"athenaUser">;
    storeId: Id<"store">;
  },
) {
  return ctx.db
    .query("posRecoveryCredential")
    .withIndex("by_storeId_posAccountId", (q) =>
      q.eq("storeId", args.storeId).eq("posAccountId", args.posAccountId),
    )
    .first();
}

async function resolveRecoveryStore(
  ctx: PosRecoveryCtx,
  args: {
    orgUrlSlug?: string;
    storeId?: Id<"store">;
    storeUrlSlug?: string;
  },
) {
  if (args.storeId) {
    return ctx.db.get("store", args.storeId);
  }

  const orgSlug = args.orgUrlSlug?.trim();
  const storeSlug = args.storeUrlSlug?.trim();
  if (!orgSlug || !storeSlug) {
    return null;
  }

  const organization = await ctx.db
    .query("organization")
    .withIndex("by_slug", (q) => q.eq("slug", orgSlug))
    .first();
  if (!organization) {
    return null;
  }

  return ctx.db
    .query("store")
    .withIndex("by_organizationId_slug", (q) =>
      q.eq("organizationId", organization._id).eq("slug", storeSlug),
    )
    .first();
}

async function recordRecoveryCodeEvent(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    credential: Pick<
      PosRecoveryCredential,
      "_id" | "organizationId" | "posAccountId" | "storeId" | "status"
    >;
    eventType: string;
    metadataDedupeKeys?: string[];
    reason: string;
    metadata?: Record<string, unknown>;
  },
) {
  await recordOperationalEventWithCtx(ctx, {
    storeId: args.credential.storeId,
    organizationId: args.credential.organizationId,
    actorUserId: args.actorUserId,
    eventType: args.eventType,
    subjectType: "posRecoveryCredential",
    subjectId: args.credential._id,
    reason: args.reason,
    message: "POS recovery-code credential updated.",
    metadata: {
      eventDedupeNonce: randomHex(8),
      eventRecordedAt: Date.now(),
      posAccountId: args.credential.posAccountId,
      reason: args.reason,
      status: args.credential.status,
      ...args.metadata,
    },
    metadataDedupeKeys: args.metadataDedupeKeys ?? ["eventDedupeNonce"],
  });
}

async function requireFullAdminRecoveryAccess(
  ctx: PosRecoveryAccessCtx,
  storeId: Id<"store">,
) {
  const store = await ctx.db.get("store", storeId);
  if (!store) {
    throw new Error("Store not found.");
  }

  const actor = await requireAuthenticatedAthenaUserWithCtx(ctx);
  await requireOrganizationMemberRoleWithCtx(ctx, {
    allowedRoles: ["full_admin"],
    failureMessage: "Only full admins can manage POS recovery codes.",
    organizationId: store.organizationId,
    userId: actor._id,
  });

  return { actor, store };
}

async function requirePosRecoveryAccount(ctx: PosRecoveryCtx) {
  const account = await findAthenaUserByEmail(ctx, POS_RECOVERY_ACCOUNT_EMAIL);
  if (!account) {
    throw new Error("POS recovery account is not configured.");
  }
  return account;
}

async function requireUsablePosRecoveryAccount(
  ctx: PosRecoveryCtx,
  args: {
    account: Doc<"athenaUser">;
    organizationId: Id<"organization">;
  },
) {
  const membership = await ctx.db
    .query("organizationMember")
    .withIndex("by_organizationId_userId", (q) =>
      q
        .eq("organizationId", args.organizationId)
        .eq("userId", args.account._id),
    )
    .first();

  if (!membership || membership.role !== "pos_only") {
    throw new Error("POS recovery account must have POS-only access.");
  }

  const authUser = await findAuthUserByEmail(ctx, POS_RECOVERY_ACCOUNT_EMAIL);
  if (!authUser) {
    throw new Error("POS recovery account auth user is not configured.");
  }

  return { authUser, membership };
}

function publicCredentialStatus(credential: PosRecoveryCredential | null) {
  if (!credential) {
    return null;
  }

  return {
    _id: credential._id,
    createdAt: credential.createdAt,
    failedAttemptCount: credential.failedAttemptCount,
    lastFailedAt: credential.lastFailedAt,
    lastUsedAt: credential.lastUsedAt,
    lockedAt: credential.lockedAt,
    lockedUntil: credential.lockedUntil,
    plaintextCode: credential.plaintextCode,
    posAccountId: credential.posAccountId,
    revokedAt: credential.revokedAt,
    rotatedAt: credential.rotatedAt,
    rotatedByUserId: credential.rotatedByUserId,
    status: credential.status,
    storeId: credential.storeId,
  };
}

async function rotateCredentialWithCtx(
  ctx: MutationCtx,
  args: {
    actorUserId?: Id<"athenaUser">;
    reason: "created" | "rotated";
    storeId: Id<"store">;
  },
) {
  const store = await ctx.db.get("store", args.storeId);
  if (!store) {
    throw new Error("Store not found.");
  }
  const account = await requirePosRecoveryAccount(ctx);
  await requireUsablePosRecoveryAccount(ctx, {
    account,
    organizationId: store.organizationId,
  });
  const now = Date.now();
  const code = generateRecoveryCode();
  const codeSalt = randomHex(16);
  const codeHash = await hashPosRecoveryCode({ code, salt: codeSalt });
  const existing = await getCredentialForStore(ctx, {
    posAccountId: account._id,
    storeId: args.storeId,
  });

  if (existing) {
    await ctx.db.patch("posRecoveryCredential", existing._id, {
      codeHash,
      codeSalt,
      codeVersion: POS_RECOVERY_CODE_VERSION,
      failedAttemptCount: 0,
      failureAuditBucket: undefined,
      lastFailedAt: undefined,
      lockedAt: undefined,
      lockedUntil: undefined,
      plaintextCode: code,
      revokedAt: undefined,
      revokedByUserId: undefined,
      rotatedAt: now,
      rotatedByUserId: args.actorUserId,
      status: "active",
    });
    const credential = (await ctx.db.get(
      "posRecoveryCredential",
      existing._id,
    ))!;
    await recordRecoveryCodeEvent(ctx, {
      actorUserId: args.actorUserId,
      credential,
      eventType: "pos_recovery_code_rotated",
      reason: "rotated",
    });
    return { code, credential };
  }

  const credentialId = await ctx.db.insert("posRecoveryCredential", {
    codeHash,
    codeSalt,
    codeVersion: POS_RECOVERY_CODE_VERSION,
    createdAt: now,
    createdByUserId: args.actorUserId,
    failedAttemptCount: 0,
    organizationId: store.organizationId,
    plaintextCode: code,
    posAccountId: account._id,
    rotatedAt: now,
    rotatedByUserId: args.actorUserId,
    status: "active",
    storeId: args.storeId,
  });
  const credential = (await ctx.db.get("posRecoveryCredential", credentialId))!;
  await recordRecoveryCodeEvent(ctx, {
    actorUserId: args.actorUserId,
    credential,
    eventType: "pos_recovery_code_created",
    reason: args.reason,
  });

  return { code, credential };
}

async function verifyCredentialWithCtx(
  ctx: MutationCtx,
  args: {
    code: string;
    email: string;
    orgUrlSlug?: string;
    storeId?: Id<"store">;
    storeUrlSlug?: string;
  },
) {
  const submittedEmail = normalizeEmail(args.email);
  const store = await resolveRecoveryStore(ctx, args);
  const account = await findAthenaUserByEmail(ctx, POS_RECOVERY_ACCOUNT_EMAIL);

  if (!store || !account || submittedEmail !== POS_RECOVERY_ACCOUNT_EMAIL) {
    throw new Error(GENERIC_RECOVERY_FAILURE);
  }

  const membership = await ctx.db
    .query("organizationMember")
    .withIndex("by_organizationId_userId", (q) =>
      q.eq("organizationId", store.organizationId).eq("userId", account._id),
    )
    .first();

  if (!membership || membership.role !== "pos_only") {
    throw new Error(GENERIC_RECOVERY_FAILURE);
  }

  const credential = await getCredentialForStore(ctx, {
    posAccountId: account._id,
    storeId: store._id,
  });
  if (!credential) {
    throw new Error(GENERIC_RECOVERY_FAILURE);
  }

  const now = Date.now();
  if (
    credential.status === "revoked" ||
    (credential.lockedUntil && credential.lockedUntil > now)
  ) {
    const failureAuditBucket = getFailureAuditBucket(now);
    await recordRecoveryCodeEvent(ctx, {
      credential,
      eventType: "pos_recovery_code_login_failed",
      reason: credential.status === "revoked" ? "revoked" : "locked",
      metadata: { failureAuditBucket },
      metadataDedupeKeys: ["reason", "failureAuditBucket"],
    });
    throw new Error(GENERIC_RECOVERY_FAILURE);
  }

  const submittedHash = await hashPosRecoveryCode({
    code: args.code,
    salt: credential.codeSalt,
  });
  if (submittedHash !== credential.codeHash) {
    const failureAuditBucket = getFailureAuditBucket(now);
    const shouldRecordCredentialFailure =
      credential.failureAuditBucket !== failureAuditBucket;
    const patch = shouldRecordCredentialFailure
      ? {
          failedAttemptCount: credential.failedAttemptCount + 1,
          failureAuditBucket,
          lastFailedAt: now,
        }
      : null;
    if (patch) {
      await ctx.db.patch("posRecoveryCredential", credential._id, patch);
    }
    const nextCredential = patch ? { ...credential, ...patch } : credential;
    await recordRecoveryCodeEvent(ctx, {
      credential: nextCredential,
      eventType: "pos_recovery_code_login_failed",
      reason: "invalid_code",
      metadata: {
        failedAttemptCount: nextCredential.failedAttemptCount,
        failureAuditBucket,
      },
      metadataDedupeKeys: ["reason", "failureAuditBucket"],
    });
    throw new Error(GENERIC_RECOVERY_FAILURE);
  }

  const authUser = await findAuthUserByEmail(ctx, POS_RECOVERY_ACCOUNT_EMAIL);
  if (!authUser) {
    throw new Error(GENERIC_RECOVERY_FAILURE);
  }

  await ctx.db.patch("posRecoveryCredential", credential._id, {
    failedAttemptCount: 0,
    failureAuditBucket: undefined,
    lastFailedAt: undefined,
    lastUsedAt: now,
    lockedAt: undefined,
    lockedUntil: undefined,
    status: "active",
  });
  await recordRecoveryCodeEvent(ctx, {
    credential: { ...credential, status: "active" },
    eventType: "pos_recovery_code_login_succeeded",
    reason: "verified",
  });

  return { authUserId: authUser._id };
}

export const getRecoveryCodeStatus = query({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    await requireFullAdminRecoveryAccess(ctx, args.storeId);
    const account = await findAthenaUserByEmail(
      ctx,
      POS_RECOVERY_ACCOUNT_EMAIL,
    );
    if (!account) {
      return null;
    }
    return publicCredentialStatus(
      await getCredentialForStore(ctx, {
        posAccountId: account._id,
        storeId: args.storeId,
      }),
    );
  },
});

export const rotateRecoveryCode = mutation({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireFullAdminRecoveryAccess(ctx, args.storeId);
    const { code, credential } = await rotateCredentialWithCtx(ctx, {
      actorUserId: actor._id,
      reason: "rotated",
      storeId: args.storeId,
    });

    return { code, credential: publicCredentialStatus(credential) };
  },
});

export const revokeRecoveryCode = mutation({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireFullAdminRecoveryAccess(ctx, args.storeId);
    const account = await requirePosRecoveryAccount(ctx);
    const credential = await getCredentialForStore(ctx, {
      posAccountId: account._id,
      storeId: args.storeId,
    });
    if (!credential) {
      return null;
    }
    const now = Date.now();
    await ctx.db.patch("posRecoveryCredential", credential._id, {
      plaintextCode: undefined,
      revokedAt: now,
      revokedByUserId: actor._id,
      status: "revoked",
    });
    const nextCredential = {
      ...credential,
      plaintextCode: undefined,
      revokedAt: now,
      status: "revoked" as const,
    };
    await recordRecoveryCodeEvent(ctx, {
      actorUserId: actor._id,
      credential: nextCredential,
      eventType: "pos_recovery_code_revoked",
      reason: "revoked",
    });

    return publicCredentialStatus(nextCredential);
  },
});

export const unlockRecoveryCode = mutation({
  args: {
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { actor } = await requireFullAdminRecoveryAccess(ctx, args.storeId);
    const account = await requirePosRecoveryAccount(ctx);
    const credential = await getCredentialForStore(ctx, {
      posAccountId: account._id,
      storeId: args.storeId,
    });
    if (!credential || credential.status === "revoked") {
      return publicCredentialStatus(credential);
    }
    await ctx.db.patch("posRecoveryCredential", credential._id, {
      failedAttemptCount: 0,
      failureAuditBucket: undefined,
      lastFailedAt: undefined,
      lockedAt: undefined,
      lockedUntil: undefined,
      status: "active",
    });
    const nextCredential = { ...credential, status: "active" as const };
    await recordRecoveryCodeEvent(ctx, {
      actorUserId: actor._id,
      credential: nextCredential,
      eventType: "pos_recovery_code_unlocked",
      reason: "unlocked",
    });

    return publicCredentialStatus(nextCredential);
  },
});

export const verifyRecoveryCodeForAuthProvider = internalMutation({
  args: {
    code: v.string(),
    email: v.string(),
    orgUrlSlug: v.optional(v.string()),
    storeId: v.optional(v.id("store")),
    storeUrlSlug: v.optional(v.string()),
  },
  handler: verifyCredentialWithCtx,
});

export const createOrRotateRecoveryCodeForTest = internalMutation({
  args: {
    actorUserId: v.optional(v.id("athenaUser")),
    storeId: v.id("store"),
  },
  handler: async (ctx, args) => {
    const { code, credential } = await rotateCredentialWithCtx(ctx, {
      actorUserId: args.actorUserId,
      reason: "created",
      storeId: args.storeId,
    });
    return { code, credential: publicCredentialStatus(credential) };
  },
});
