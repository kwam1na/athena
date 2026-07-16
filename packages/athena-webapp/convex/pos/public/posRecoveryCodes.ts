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
import { ATHENA_AUTH_SESSION_TOTAL_DURATION_MS } from "../../authConfig";
import {
  requireAuthenticatedAthenaUserWithCtx,
  requireOrganizationMemberRoleWithCtx,
} from "../../lib/athenaUserAuth";
import {
  STORE_SERVICE_PRINCIPAL_STABLE_KEY,
  reconcileServicePrincipalAuthBinding,
} from "../../servicePrincipals/lifecycle";
import {
  POS_APPLICATION_CAPABILITY_ID,
  POS_SERVICE_PRINCIPAL_CONSUMER_ID,
  resolvePosApplicationCapability,
} from "../application/posServicePrincipal";
import { hashPosTerminalSyncSecret } from "../application/sync/terminalSyncSecret";
import {
  createPosRecoveryCodeVerifier,
  verifyPosRecoveryCodeVerifier,
} from "../application/security/posRecoveryCodeVerifier";
import {
  issueRevokedPosTerminalReconnectIntent,
  PosTerminalLifecycleError,
} from "../application/terminalLifecycle";

const POS_RECOVERY_ACCOUNT_EMAIL = "pos@wigclub.store";
const POS_RECOVERY_FAILURE_AUDIT_BUCKET_MS = 15 * 60 * 1000;
const POS_RECOVERY_FAILURE_WINDOW_MS = 15 * 60 * 1000;
const POS_RECOVERY_MAX_FAILURES_PER_WINDOW = 5;
const POS_RECOVERY_THROTTLE_LOCK_MS = 5 * 60 * 1000;
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
const POS_RECOVERY_EXCHANGE_TTL_MS = 5 * 60 * 1000;
const POS_RECOVERY_CORRELATION_KEY_PATTERN = /^[A-Za-z0-9_-]{16,160}$/;

type PosRecoveryCredential = Doc<"posRecoveryCredential">;
type PosRecoveryCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">;
type PosRecoveryAccessCtx =
  | Pick<QueryCtx, "auth" | "db">
  | Pick<MutationCtx, "auth" | "db">;

function failRecovery(): never {
  throw new Error(GENERIC_RECOVERY_FAILURE);
}

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

const posTerminalRecoveryDispositionValidator = v.union(
  v.object({
    disposition: v.literal("recovery_code_required"),
  }),
  v.object({
    disposition: v.literal("administrator_reconnect_required"),
    reconnectIntentToken: v.string(),
    expiresAt: v.number(),
  }),
);

export async function requestPosTerminalRecoveryDispositionWithCtx(
  ctx: MutationCtx,
  args: {
    browserFingerprintHash: string;
    terminalId: Id<"posTerminal">;
    terminalProof: string;
  },
  options: { now?: number } = {},
) {
  const browserFingerprintHash = args.browserFingerprintHash.trim();
  const terminalProof = args.terminalProof.trim();
  if (!browserFingerprintHash || !terminalProof) failRecovery();
  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (
    !terminal ||
    !terminal.syncSecretHash ||
    terminal.fingerprintHash !== browserFingerprintHash
  ) {
    failRecovery();
  }
  const currentProofHash = await hashPosTerminalSyncSecret(terminalProof);
  if (currentProofHash !== terminal.syncSecretHash) failRecovery();
  if (terminal.status === "active") {
    return { disposition: "recovery_code_required" as const };
  }
  if (terminal.status !== "revoked") failRecovery();

  const now = options.now ?? Date.now();
  const reconnectIntentToken = randomHex(32);
  const correlationId = `terminal-reconnect-request:${terminal._id}:${now}:${randomHex(8)}`;
  try {
    const issued = await issueRevokedPosTerminalReconnectIntent(ctx, {
      browserFingerprintHash,
      correlationId,
      currentProofHash,
      intentTokenHash: await hashPosTerminalSyncSecret(reconnectIntentToken),
      now,
      terminalId: terminal._id,
    });
    await recordOperationalEventWithCtx(ctx, {
      eventType: "pos_terminal_reconnect_intent_issued",
      reason: "administrator_reconnect_required",
      message: "A revoked checkout station requested administrator reconnection.",
      metadata: {
        expiresAt: issued.expiresAt,
        reconnectIntentId: issued.reconnectIntentId,
      },
      metadataDedupeKeys: ["reconnectIntentId"],
      organizationId: issued.organizationId,
      storeId: issued.storeId,
      subjectId: issued.terminalId,
      subjectType: "posTerminal",
      terminalId: issued.terminalId,
    });
    return {
      disposition: "administrator_reconnect_required" as const,
      reconnectIntentToken,
      expiresAt: issued.expiresAt,
    };
  } catch (error) {
    if (
      error instanceof PosTerminalLifecycleError &&
      error.code === "reconnect_intent_rate_limited"
    ) {
      const store = await ctx.db.get("store", terminal.storeId);
      if (store) {
        const rateBucket = Math.floor(now / (15 * 60 * 1_000));
        await recordOperationalEventWithCtx(ctx, {
          eventType: "pos_terminal_reconnect_intent_rate_limited",
          reason: "rate_limited",
          message: "Checkout station reconnection requests were rate limited.",
          metadata: { rateBucket },
          metadataDedupeKeys: ["rateBucket"],
          organizationId: store.organizationId,
          storeId: store._id,
          subjectId: terminal._id,
          subjectType: "posTerminal",
          terminalId: terminal._id,
        });
      }
    }
    failRecovery();
  }
}

export const requestPosTerminalRecoveryDisposition = mutation({
  args: {
    browserFingerprintHash: v.string(),
    terminalId: v.id("posTerminal"),
    terminalProof: v.string(),
  },
  returns: posTerminalRecoveryDispositionValidator,
  handler: (ctx, args) =>
    requestPosTerminalRecoveryDispositionWithCtx(ctx, args),
});

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
    legacyMigrationAt: credential.legacyMigrationAt,
    legacyMigrationStatus: credential.legacyMigrationStatus,
    posAccountId: credential.posAccountId,
    revokedAt: credential.revokedAt,
    rotatedAt: credential.rotatedAt,
    rotatedByUserId: credential.rotatedByUserId,
    rotationRequiredAt: credential.rotationRequiredAt,
    status: credential.status,
    storeId: credential.storeId,
    verifierKind: credential.verifierKind,
    keyedVerifierIterations: credential.keyedVerifierIterations,
    keyedVerifierPepperVersion: credential.keyedVerifierPepperVersion,
    keyedVerifierVersion: credential.keyedVerifierVersion,
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
  const keyedVerifier = await createPosRecoveryCodeVerifier({
    normalizedCode: normalizeRecoveryCode(code),
    saltHex: randomHex(16),
  });
  const existing = await getCredentialForStore(ctx, {
    posAccountId: account._id,
    storeId: args.storeId,
  });

  if (existing) {
    await ctx.db.patch("posRecoveryCredential", existing._id, {
      codeHash: undefined,
      codeSalt: undefined,
      codeVersion: undefined,
      credentialRevision: (existing.credentialRevision ?? 1) + 1,
      failedAttemptCount: 0,
      failureAuditBucket: undefined,
      failureWindowAttemptCount: undefined,
      failureWindowStartedAt: undefined,
      lastFailedAt: undefined,
      keyedVerifierDigest: keyedVerifier.digest,
      keyedVerifierIterations: keyedVerifier.iterations,
      keyedVerifierPepperVersion: keyedVerifier.pepperVersion,
      keyedVerifierSalt: keyedVerifier.saltHex,
      keyedVerifierVersion: keyedVerifier.verifierVersion,
      legacyMigrationAt: now,
      legacyMigrationStatus: "migrated",
      lockedAt: undefined,
      lockedUntil: undefined,
      plaintextCode: undefined,
      plaintextRemovedAt: now,
      revokedAt: undefined,
      revokedByUserId: undefined,
      rotationRequiredAt: undefined,
      rotatedAt: now,
      rotatedByUserId: args.actorUserId,
      status: "active",
      verifierKind: "deployment_keyed_pbkdf2_sha256",
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
    createdAt: now,
    createdByUserId: args.actorUserId,
    failedAttemptCount: 0,
    organizationId: store.organizationId,
    posAccountId: account._id,
    credentialRevision: 1,
    keyedVerifierDigest: keyedVerifier.digest,
    keyedVerifierIterations: keyedVerifier.iterations,
    keyedVerifierPepperVersion: keyedVerifier.pepperVersion,
    keyedVerifierSalt: keyedVerifier.saltHex,
    keyedVerifierVersion: keyedVerifier.verifierVersion,
    legacyMigrationAt: now,
    legacyMigrationStatus: "migrated",
    plaintextRemovedAt: now,
    rotatedAt: now,
    rotatedByUserId: args.actorUserId,
    status: "active",
    storeId: args.storeId,
    verifierKind: "deployment_keyed_pbkdf2_sha256",
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

type PrepareRecoveryArgs = {
  code: string;
  recoveryCorrelationKey: string;
  terminalId: Id<"posTerminal">;
  terminalProof: string;
};

async function getCanonicalStoreServicePrincipal(
  ctx: MutationCtx,
  args: { organizationId: Id<"organization">; storeId: Id<"store"> },
) {
  const principals = await ctx.db
    .query("servicePrincipal")
    .withIndex(
      "by_organizationId_and_storeId_and_stableKey",
      (query) =>
        query
          .eq("organizationId", args.organizationId)
          .eq("storeId", args.storeId)
          .eq("stableKey", STORE_SERVICE_PRINCIPAL_STABLE_KEY),
    )
    .take(2);
  if (principals.length !== 1 || principals[0].status !== "active") {
    failRecovery();
  }
  return principals[0];
}

async function getCurrentStoreRecoveryCredential(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organization">;
    servicePrincipalId: Id<"servicePrincipal">;
    storeId: Id<"store">;
  },
) {
  const credentials = await ctx.db
    .query("posRecoveryCredential")
    .withIndex("by_storeId", (query) => query.eq("storeId", args.storeId))
    .take(2);
  if (credentials.length !== 1) failRecovery();
  const credential = credentials[0];
  if (
    credential.organizationId !== args.organizationId ||
    (credential.servicePrincipalId !== undefined &&
      credential.servicePrincipalId !== args.servicePrincipalId)
  ) {
    failRecovery();
  }
  return credential;
}

async function verifyCurrentRecoveryCredential(
  ctx: MutationCtx,
  args: {
    code: string;
    credential: PosRecoveryCredential;
    now: number;
  },
) {
  const { credential, now } = args;
  if (
    credential.status !== "active" ||
    (credential.lockedUntil !== undefined && credential.lockedUntil > now)
  ) {
    const failureAuditBucket = getFailureAuditBucket(now);
    await recordRecoveryCodeEvent(ctx, {
      credential,
      eventType: "pos_recovery_code_login_failed",
      reason: credential.status === "revoked" ? "revoked" : "locked",
      metadata: { failureAuditBucket },
      metadataDedupeKeys: ["reason", "failureAuditBucket"],
    });
    failRecovery();
  }

  if (
    credential.verifierKind !== "deployment_keyed_pbkdf2_sha256" ||
    credential.keyedVerifierDigest === undefined ||
    credential.keyedVerifierIterations === undefined ||
    credential.keyedVerifierPepperVersion === undefined ||
    credential.keyedVerifierSalt === undefined ||
    credential.keyedVerifierVersion === undefined
  ) {
    // Exact-session recovery is an enforced store lane. A fast legacy
    // verifier cannot authorize it, even when its old hash happens to match.
    failRecovery();
  }
  const matches = await verifyPosRecoveryCodeVerifier({
    digest: credential.keyedVerifierDigest,
    iterations: credential.keyedVerifierIterations,
    normalizedCode: normalizeRecoveryCode(args.code),
    pepperVersion: credential.keyedVerifierPepperVersion,
    saltHex: credential.keyedVerifierSalt,
    verifierVersion: credential.keyedVerifierVersion,
  });
  if (matches) return;

  const failureAuditBucket = getFailureAuditBucket(now);
  const withinWindow =
    credential.failureWindowStartedAt !== undefined &&
    now - credential.failureWindowStartedAt < POS_RECOVERY_FAILURE_WINDOW_MS;
  const failureWindowAttemptCount = withinWindow
    ? (credential.failureWindowAttemptCount ?? 0) + 1
    : 1;
  const locked =
    failureWindowAttemptCount >= POS_RECOVERY_MAX_FAILURES_PER_WINDOW;
  const patch = {
    failedAttemptCount: credential.failedAttemptCount + 1,
    failureAuditBucket,
    failureWindowAttemptCount,
    failureWindowStartedAt: withinWindow
      ? credential.failureWindowStartedAt
      : now,
    lastFailedAt: now,
    ...(locked
      ? {
          lockedAt: now,
          lockedUntil: now + POS_RECOVERY_THROTTLE_LOCK_MS,
          status: "locked" as const,
        }
      : {}),
  };
  await ctx.db.patch("posRecoveryCredential", credential._id, patch);
  if (credential.failureAuditBucket !== failureAuditBucket || locked) {
    const nextCredential = { ...credential, ...patch };
    await recordRecoveryCodeEvent(ctx, {
      credential: nextCredential,
      eventType: "pos_recovery_code_login_failed",
      reason: locked ? "throttled" : "invalid_code",
      metadata: {
        failedAttemptCount: nextCredential.failedAttemptCount,
        failureAuditBucket,
        failureWindowAttemptCount,
      },
      metadataDedupeKeys: ["reason", "failureAuditBucket"],
    });
  }
  failRecovery();
}

async function getOrCreateStableAuthBinding(
  ctx: MutationCtx,
  args: {
    correlationId: string;
    now: number;
    organizationId: Id<"organization">;
    servicePrincipalId: Id<"servicePrincipal">;
    storeId: Id<"store">;
  },
) {
  const bindings = await ctx.db
    .query("servicePrincipalAuthBinding")
    .withIndex("by_servicePrincipalId", (query) =>
      query.eq("servicePrincipalId", args.servicePrincipalId),
    )
    .take(2);
  if (bindings.length > 1) failRecovery();
  const existing = bindings[0];
  if (existing) {
    if (
      existing.status !== "active" ||
      existing.organizationId !== args.organizationId ||
      existing.storeId !== args.storeId
    ) {
      failRecovery();
    }
    return existing;
  }

  const authUserId = await ctx.db.insert("users", {});
  const result = await reconcileServicePrincipalAuthBinding(ctx as never, {
    authUserId,
    correlationId: args.correlationId,
    now: args.now,
    organizationId: args.organizationId,
    servicePrincipalId: args.servicePrincipalId,
    storeId: args.storeId,
  });
  const created = await ctx.db.get(
    "servicePrincipalAuthBinding",
    result.servicePrincipalAuthBindingId,
  );
  if (!created) failRecovery();
  return created;
}

export async function prepareRecoveryForAuthProviderWithCtx(
  ctx: MutationCtx,
  args: PrepareRecoveryArgs,
) {
  const recoveryCorrelationKey = args.recoveryCorrelationKey.trim();
  const terminalProof = args.terminalProof.trim();
  if (
    !terminalProof ||
    !POS_RECOVERY_CORRELATION_KEY_PATTERN.test(recoveryCorrelationKey)
  ) {
    failRecovery();
  }

  // Authenticate the terminal before loading or mutating the shared recovery
  // credential so terminal-ID/proof spraying cannot affect its failure lane.
  const terminal = await ctx.db.get("posTerminal", args.terminalId);
  if (!terminal || terminal.status !== "active" || !terminal.syncSecretHash) {
    failRecovery();
  }
  const submittedProofHash = await hashPosTerminalSyncSecret(terminalProof);
  if (submittedProofHash !== terminal.syncSecretHash) failRecovery();

  const store = await ctx.db.get("store", terminal.storeId);
  if (
    !store ||
    (terminal.organizationId !== undefined &&
      terminal.organizationId !== store.organizationId)
  ) {
    failRecovery();
  }

  const now = Date.now();
  const principal = await getCanonicalStoreServicePrincipal(ctx, {
    organizationId: store.organizationId,
    storeId: store._id,
  });
  const grant = await resolvePosApplicationCapability(ctx as never, {
    now,
    organizationId: store.organizationId,
    servicePrincipalId: principal._id,
    storeId: store._id,
  });
  const credential = await getCurrentStoreRecoveryCredential(ctx, {
    organizationId: store.organizationId,
    servicePrincipalId: principal._id,
    storeId: store._id,
  });
  await verifyCurrentRecoveryCredential(ctx, {
    code: args.code,
    credential,
    now,
  });

  const credentialRevision = credential.credentialRevision ?? 1;
  const terminalLifecycleRevision = terminal.lifecycleRevision ?? 1;
  const terminalProofRevision = terminal.proofRevision ?? 1;
  const existingExchanges = await ctx.db
    .query("posRecoveryExchange")
    .withIndex("by_recoveryCorrelationKey", (query) =>
      query.eq("recoveryCorrelationKey", recoveryCorrelationKey),
    )
    .take(2);
  if (existingExchanges.length > 1) failRecovery();
  const existingExchange = existingExchanges[0];
  if (existingExchange) {
    const authSession = await ctx.db.get(
      "authSessions",
      existingExchange.authSessionId,
    );
    if (
      existingExchange.status !== "prepared" ||
      existingExchange.expiresAt <= now ||
      existingExchange.organizationId !== store.organizationId ||
      existingExchange.storeId !== store._id ||
      existingExchange.terminalId !== terminal._id ||
      existingExchange.servicePrincipalId !== principal._id ||
      existingExchange.posRecoveryCredentialId !== credential._id ||
      existingExchange.capabilityGrantId !== grant.grantId ||
      existingExchange.principalLifecycleRevision !==
        principal.lifecycleRevision ||
      existingExchange.capabilityRevision !== grant.revision ||
      existingExchange.credentialRevision !== credentialRevision ||
      existingExchange.terminalLifecycleRevision !==
        terminalLifecycleRevision ||
      existingExchange.terminalProofRevision !== terminalProofRevision ||
      !authSession ||
      authSession.userId !== existingExchange.authUserId ||
      authSession.expirationTime <= now
    ) {
      failRecovery();
    }
    return {
      authSessionId: existingExchange.authSessionId,
      authUserId: existingExchange.authUserId,
    };
  }

  const authBinding = await getOrCreateStableAuthBinding(ctx, {
    correlationId: recoveryCorrelationKey,
    now,
    organizationId: store.organizationId,
    servicePrincipalId: principal._id,
    storeId: store._id,
  });
  const authSessionId = await ctx.db.insert("authSessions", {
    expirationTime: now + ATHENA_AUTH_SESSION_TOTAL_DURATION_MS,
    userId: authBinding.authUserId,
  });
  await ctx.db.insert("posRecoveryExchange", {
    organizationId: store.organizationId,
    storeId: store._id,
    servicePrincipalId: principal._id,
    servicePrincipalAuthBindingId: authBinding._id,
    authUserId: authBinding.authUserId,
    authSessionId,
    terminalId: terminal._id,
    posRecoveryCredentialId: credential._id,
    capabilityGrantId: grant.grantId,
    recoveryCorrelationKey,
    consumerId: POS_SERVICE_PRINCIPAL_CONSUMER_ID,
    capabilityId: POS_APPLICATION_CAPABILITY_ID,
    status: "prepared",
    revision: 1,
    principalLifecycleRevision: principal.lifecycleRevision,
    capabilityRevision: grant.revision,
    credentialRevision,
    terminalLifecycleRevision,
    terminalProofRevision,
    preparedAt: now,
    updatedAt: now,
    expiresAt: now + POS_RECOVERY_EXCHANGE_TTL_MS,
    lastCorrelationId: recoveryCorrelationKey,
  });
  await ctx.db.patch("posRecoveryCredential", credential._id, {
    credentialRevision,
    failedAttemptCount: 0,
    failureAuditBucket: undefined,
    failureWindowAttemptCount: undefined,
    failureWindowStartedAt: undefined,
    lastCorrelationId: recoveryCorrelationKey,
    lastFailedAt: undefined,
    lastUsedAt: now,
    lockedAt: undefined,
    lockedUntil: undefined,
    servicePrincipalId: principal._id,
    status: "active",
    verifierKind: "deployment_keyed_pbkdf2_sha256",
  });
  await recordRecoveryCodeEvent(ctx, {
    credential: { ...credential, status: "active" },
    eventType: "pos_recovery_code_login_succeeded",
    reason: "prepared_exact_session",
    metadata: {
      recoveryCorrelationKey,
      terminalId: terminal._id,
    },
    metadataDedupeKeys: ["recoveryCorrelationKey"],
  });

  return { authSessionId, authUserId: authBinding.authUserId };
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

  const isKeyedVerifier =
    credential.verifierKind === "deployment_keyed_pbkdf2_sha256" &&
    credential.keyedVerifierDigest !== undefined &&
    credential.keyedVerifierIterations !== undefined &&
    credential.keyedVerifierPepperVersion !== undefined &&
    credential.keyedVerifierSalt !== undefined &&
    credential.keyedVerifierVersion !== undefined;
  const matches = isKeyedVerifier
    ? await verifyPosRecoveryCodeVerifier({
        digest: credential.keyedVerifierDigest!,
        iterations: credential.keyedVerifierIterations!,
        normalizedCode: normalizeRecoveryCode(args.code),
        pepperVersion: credential.keyedVerifierPepperVersion!,
        saltHex: credential.keyedVerifierSalt!,
        verifierVersion: credential.keyedVerifierVersion!,
      })
    : credential.codeHash !== undefined && credential.codeSalt !== undefined
      ? (await hashPosRecoveryCode({
          code: args.code,
          salt: credential.codeSalt,
        })) === credential.codeHash
      : false;
  if (!matches) {
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
    failureWindowAttemptCount: undefined,
    failureWindowStartedAt: undefined,
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
      credentialRevision: (credential.credentialRevision ?? 1) + 1,
      plaintextCode: undefined,
      plaintextRemovedAt: credential.plaintextRemovedAt ?? now,
      revokedAt: now,
      revokedByUserId: actor._id,
      status: "revoked",
    });
    const nextCredential = {
      ...credential,
      credentialRevision: (credential.credentialRevision ?? 1) + 1,
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
      failureWindowAttemptCount: undefined,
      failureWindowStartedAt: undefined,
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

export async function migrateLegacyRecoveryCredentialWithCtx(
  ctx: MutationCtx,
  args: {
    credentialId: Id<"posRecoveryCredential">;
    now?: number;
  },
) {
  const credential = await ctx.db.get(
    "posRecoveryCredential",
    args.credentialId,
  );
  if (!credential) {
    return { disposition: "missing" as const };
  }
  if (credential.verifierKind === "deployment_keyed_pbkdf2_sha256") {
    return { disposition: "already_keyed" as const };
  }

  const now = args.now ?? Date.now();
  if (!credential.plaintextCode) {
    await ctx.db.patch("posRecoveryCredential", credential._id, {
      legacyMigrationAt: now,
      legacyMigrationStatus: "rotation_required",
      rotationRequiredAt: now,
    });
    return { disposition: "rotation_required" as const };
  }

  const verifier = await createPosRecoveryCodeVerifier({
    normalizedCode: normalizeRecoveryCode(credential.plaintextCode),
    saltHex: randomHex(16),
  });
  await ctx.db.patch("posRecoveryCredential", credential._id, {
    codeHash: undefined,
    codeSalt: undefined,
    codeVersion: undefined,
    credentialRevision: (credential.credentialRevision ?? 1) + 1,
    keyedVerifierDigest: verifier.digest,
    keyedVerifierIterations: verifier.iterations,
    keyedVerifierPepperVersion: verifier.pepperVersion,
    keyedVerifierSalt: verifier.saltHex,
    keyedVerifierVersion: verifier.verifierVersion,
    legacyMigrationAt: now,
    legacyMigrationStatus: "migrated",
    plaintextCode: undefined,
    plaintextRemovedAt: now,
    rotationRequiredAt: undefined,
    verifierKind: "deployment_keyed_pbkdf2_sha256",
  });
  return { disposition: "migrated" as const };
}

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

export const prepareRecoveryForAuthProvider = internalMutation({
  args: {
    code: v.string(),
    recoveryCorrelationKey: v.string(),
    terminalId: v.id("posTerminal"),
    terminalProof: v.string(),
  },
  handler: prepareRecoveryForAuthProviderWithCtx,
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

export const migrateLegacyRecoveryCredential = internalMutation({
  args: {
    credentialId: v.id("posRecoveryCredential"),
  },
  handler: migrateLegacyRecoveryCredentialWithCtx,
});
