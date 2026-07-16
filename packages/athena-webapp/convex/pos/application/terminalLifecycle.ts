import type { Id } from "../../_generated/dataModel";
import type { MutationCtx } from "../../_generated/server";

export type PosTerminalLifecycleErrorCode =
  | "fingerprint_duplicated"
  | "reconnect_intent_invalid"
  | "reconnect_intent_rate_limited"
  | "terminal_binding_duplicated"
  | "terminal_inactive"
  | "terminal_missing"
  | "terminal_proof_invalid"
  | "terminal_scope_invalid";

export class PosTerminalLifecycleError extends Error {
  readonly code: PosTerminalLifecycleErrorCode;

  constructor(code: PosTerminalLifecycleErrorCode) {
    super(code);
    this.name = "PosTerminalLifecycleError";
    this.code = code;
  }
}

function fail(code: PosTerminalLifecycleErrorCode): never {
  throw new PosTerminalLifecycleError(code);
}

function revisions(terminal: {
  lifecycleRevision?: number;
  proofRevision?: number;
}) {
  return {
    lifecycleRevision: terminal.lifecycleRevision ?? 1,
    proofRevision: terminal.proofRevision ?? 1,
  };
}

export const POS_TERMINAL_RECONNECT_INTENT_TTL_MS = 5 * 60 * 1_000;
const POS_TERMINAL_RECONNECT_RATE_WINDOW_MS = 15 * 60 * 1_000;
const POS_TERMINAL_RECONNECT_MAX_ISSUES_PER_WINDOW = 3;

export async function issueRevokedPosTerminalReconnectIntent(
  ctx: Pick<MutationCtx, "db">,
  input: {
    browserFingerprintHash: string;
    correlationId: string;
    currentProofHash: string;
    intentTokenHash: string;
    now: number;
    terminalId: Id<"posTerminal">;
  },
) {
  const terminal = await ctx.db.get("posTerminal", input.terminalId);
  if (
    !terminal ||
    terminal.status !== "revoked" ||
    !terminal.syncSecretHash ||
    terminal.syncSecretHash !== input.currentProofHash ||
    terminal.fingerprintHash !== input.browserFingerprintHash
  ) {
    fail("reconnect_intent_invalid");
  }
  const store = await ctx.db.get("store", terminal.storeId);
  if (
    !store ||
    (terminal.organizationId !== undefined &&
      terminal.organizationId !== store.organizationId)
  ) {
    fail("reconnect_intent_invalid");
  }
  const recent = await ctx.db
    .query("posTerminalReconnectIntent")
    .withIndex("by_terminalId_and_issuedAt", (query) =>
      query
        .eq("terminalId", terminal._id)
        .gte("issuedAt", input.now - POS_TERMINAL_RECONNECT_RATE_WINDOW_MS),
    )
    .take(POS_TERMINAL_RECONNECT_MAX_ISSUES_PER_WINDOW);
  if (recent.length >= POS_TERMINAL_RECONNECT_MAX_ISSUES_PER_WINDOW) {
    fail("reconnect_intent_rate_limited");
  }
  const pending = await ctx.db
    .query("posTerminalReconnectIntent")
    .withIndex("by_terminalId_and_status", (query) =>
      query.eq("terminalId", terminal._id).eq("status", "pending"),
    )
    .take(10);
  if (pending.length === 10) fail("reconnect_intent_rate_limited");
  for (const intent of pending) {
    await ctx.db.patch("posTerminalReconnectIntent", intent._id, {
      status: intent.expiresAt <= input.now ? "expired" : "revoked",
      ...(intent.expiresAt <= input.now
        ? { expiredAt: input.now }
        : { revokedAt: input.now }),
      updatedAt: input.now,
      lastCorrelationId: input.correlationId,
    });
  }
  const current = revisions(terminal);
  const expiresAt = input.now + POS_TERMINAL_RECONNECT_INTENT_TTL_MS;
  const reconnectIntentId = await ctx.db.insert("posTerminalReconnectIntent", {
    organizationId: store.organizationId,
    storeId: store._id,
    terminalId: terminal._id,
    intentTokenHash: input.intentTokenHash,
    browserFingerprintHash: input.browserFingerprintHash,
    status: "pending",
    terminalLifecycleRevision: current.lifecycleRevision,
    terminalProofRevision: current.proofRevision,
    issuedAt: input.now,
    updatedAt: input.now,
    expiresAt,
    lastCorrelationId: input.correlationId,
  });
  return {
    expiresAt,
    organizationId: store.organizationId,
    reconnectIntentId,
    storeId: store._id,
    terminalId: terminal._id,
  };
}

export async function resolvePosTerminalReconnectIntent(
  ctx: Pick<MutationCtx, "db">,
  input: {
    browserFingerprintHash: string;
    intentTokenHash: string;
    now: number;
  },
) {
  const intents = await ctx.db
    .query("posTerminalReconnectIntent")
    .withIndex("by_intentTokenHash", (query) =>
      query.eq("intentTokenHash", input.intentTokenHash),
    )
    .take(2);
  if (intents.length !== 1) fail("reconnect_intent_invalid");
  const intent = intents[0];
  const terminal = await ctx.db.get("posTerminal", intent.terminalId);
  const store = await ctx.db.get("store", intent.storeId);
  if (!terminal || !store) fail("reconnect_intent_invalid");
  const current = revisions(terminal);
  if (
    intent.status !== "pending" ||
    input.now >= intent.expiresAt ||
    intent.browserFingerprintHash !== input.browserFingerprintHash ||
    terminal.status !== "revoked" ||
    terminal.storeId !== intent.storeId ||
    terminal.fingerprintHash !== input.browserFingerprintHash ||
    store.organizationId !== intent.organizationId ||
    (terminal.organizationId !== undefined &&
      terminal.organizationId !== intent.organizationId) ||
    intent.terminalLifecycleRevision !== current.lifecycleRevision ||
    intent.terminalProofRevision !== current.proofRevision
  ) {
    fail("reconnect_intent_invalid");
  }
  return { intent, store, terminal };
}

export async function findActiveTerminalFingerprintConflict(
  ctx: Pick<MutationCtx, "db">,
  input: {
    fingerprintHash: string;
    targetStoreId: Id<"store">;
  },
) {
  const matches = await ctx.db
    .query("posTerminal")
    .withIndex("by_fingerprintHash", (query) =>
      query.eq("fingerprintHash", input.fingerprintHash),
    )
    .take(3);
  if (matches.length > 2) fail("fingerprint_duplicated");
  const active = matches.filter((terminal) => terminal.status === "active");
  if (active.length > 1) fail("fingerprint_duplicated");
  return active[0] ?? null;
}

async function requireTerminal(
  ctx: Pick<MutationCtx, "db">,
  input: { storeId: Id<"store">; terminalId: Id<"posTerminal"> },
) {
  const terminal = await ctx.db.get("posTerminal", input.terminalId);
  if (!terminal) fail("terminal_missing");
  if (terminal.storeId !== input.storeId) fail("terminal_scope_invalid");
  return terminal;
}

async function revokeActiveTerminalBinding(
  ctx: Pick<MutationCtx, "db">,
  input: {
    correlationId: string;
    now: number;
    terminalId: Id<"posTerminal">;
  },
) {
  const bindings = await ctx.db
    .query("posApplicationSessionBinding")
    .withIndex("by_terminalId_and_status", (query) =>
      query.eq("terminalId", input.terminalId).eq("status", "active"),
    )
    .take(2);
  if (bindings.length > 1) fail("terminal_binding_duplicated");
  if (!bindings[0]) return;
  await ctx.db.patch("posApplicationSessionBinding", bindings[0]._id, {
    status: "revoked",
    revision: bindings[0].revision + 1,
    revokedAt: input.now,
    updatedAt: input.now,
    lastCorrelationId: input.correlationId,
  });
}

export async function rotatePosTerminalProof(
  ctx: Pick<MutationCtx, "db">,
  input: {
    correlationId: string;
    currentProofHash: string;
    fingerprintHash: string;
    nextProofHash: string;
    now: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const terminal = await requireTerminal(ctx, input);
  if (terminal.status !== "active") fail("terminal_inactive");
  if (
    terminal.fingerprintHash !== input.fingerprintHash ||
    !terminal.syncSecretHash ||
    terminal.syncSecretHash !== input.currentProofHash
  ) {
    fail("terminal_proof_invalid");
  }
  const current = revisions(terminal);
  const proofRevision = current.proofRevision + 1;
  await ctx.db.patch("posTerminal", terminal._id, {
    syncSecretHash: input.nextProofHash,
    proofRevision,
    proofRotatedAt: input.now,
    lastCorrelationId: input.correlationId,
  });
  await revokeActiveTerminalBinding(ctx, input);
  return {
    lifecycleRevision: current.lifecycleRevision,
    proofRevision,
    storeId: terminal.storeId,
    terminalId: terminal._id,
  };
}

export async function disconnectPosTerminal(
  ctx: Pick<MutationCtx, "db">,
  input: {
    correlationId: string;
    disconnectedByUserId: Id<"athenaUser">;
    now: number;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const terminal = await requireTerminal(ctx, input);
  const current = revisions(terminal);
  if (terminal.status === "revoked") {
    return {
      lifecycleRevision: current.lifecycleRevision,
      proofRevision: current.proofRevision,
      status: terminal.status,
      storeId: terminal.storeId,
      terminalId: terminal._id,
    };
  }
  const lifecycleRevision = current.lifecycleRevision + 1;
  const proofRevision = current.proofRevision + 1;
  await revokeActiveTerminalBinding(ctx, input);
  await ctx.db.patch("posTerminal", terminal._id, {
    status: "revoked",
    lifecycleRevision,
    proofRevision,
    disconnectedAt: input.now,
    disconnectedByUserId: input.disconnectedByUserId,
    lastCorrelationId: input.correlationId,
  });
  return {
    lifecycleRevision,
    proofRevision,
    status: "revoked" as const,
    storeId: terminal.storeId,
    terminalId: terminal._id,
  };
}

export async function reactivatePosTerminal(
  ctx: Pick<MutationCtx, "db">,
  input: {
    browserFingerprintHash: string;
    correlationId: string;
    intentTokenHash: string;
    nextProofHash: string;
    now: number;
    reactivatedByUserId: Id<"athenaUser">;
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const terminal = await requireTerminal(ctx, input);
  if (terminal.status === "active") fail("reconnect_intent_invalid");
  const intents = await ctx.db
    .query("posTerminalReconnectIntent")
    .withIndex("by_intentTokenHash", (query) =>
      query.eq("intentTokenHash", input.intentTokenHash),
    )
    .take(2);
  if (intents.length !== 1) fail("reconnect_intent_invalid");
  const intent = intents[0];
  const current = revisions(terminal);
  if (
    intent.status !== "pending" ||
    input.now >= intent.expiresAt ||
    intent.storeId !== input.storeId ||
    intent.terminalId !== input.terminalId ||
    intent.browserFingerprintHash !== input.browserFingerprintHash ||
    terminal.fingerprintHash !== input.browserFingerprintHash ||
    intent.terminalLifecycleRevision !== current.lifecycleRevision ||
    intent.terminalProofRevision !== current.proofRevision
  ) {
    fail("reconnect_intent_invalid");
  }
  const lifecycleRevision = current.lifecycleRevision + 1;
  const proofRevision = current.proofRevision + 1;
  await ctx.db.patch("posTerminalReconnectIntent", intent._id, {
    status: "consumed",
    consumedAt: input.now,
    consumedByUserId: input.reactivatedByUserId,
    updatedAt: input.now,
    lastCorrelationId: input.correlationId,
  });
  await ctx.db.patch("posTerminal", terminal._id, {
    status: "active",
    syncSecretHash: input.nextProofHash,
    lifecycleRevision,
    proofRevision,
    proofRotatedAt: input.now,
    reactivatedAt: input.now,
    reactivatedByUserId: input.reactivatedByUserId,
    lastCorrelationId: input.correlationId,
  });
  return {
    fingerprintHash: terminal.fingerprintHash,
    lifecycleRevision,
    proofRevision,
    status: "active" as const,
    storeId: terminal.storeId,
    terminalId: terminal._id,
  };
}

export async function reassignPosTerminal(
  ctx: Pick<MutationCtx, "db">,
  input: {
    correlationId: string;
    currentProofHash: string;
    fingerprintHash: string;
    nextProofHash: string;
    now: number;
    organizationId: Id<"organization">;
    reassignedByUserId: Id<"athenaUser">;
    sourceStoreId: Id<"store">;
    targetStoreId: Id<"store">;
    terminalId: Id<"posTerminal">;
  },
) {
  const terminal = await requireTerminal(ctx, {
    storeId: input.sourceStoreId,
    terminalId: input.terminalId,
  });
  const [sourceStore, targetStore, fingerprintConflict] = await Promise.all([
    ctx.db.get("store", input.sourceStoreId),
    ctx.db.get("store", input.targetStoreId),
    findActiveTerminalFingerprintConflict(ctx, {
      fingerprintHash: input.fingerprintHash,
      targetStoreId: input.targetStoreId,
    }),
  ]);
  if (
    !sourceStore ||
    !targetStore ||
    sourceStore.organizationId !== input.organizationId ||
    targetStore.organizationId !== input.organizationId
  ) {
    fail("terminal_scope_invalid");
  }
  if (
    terminal.status !== "active" ||
    terminal.fingerprintHash !== input.fingerprintHash ||
    !terminal.syncSecretHash ||
    terminal.syncSecretHash !== input.currentProofHash
  ) {
    fail("terminal_proof_invalid");
  }
  if (fingerprintConflict && fingerprintConflict._id !== terminal._id) {
    fail("fingerprint_duplicated");
  }
  const current = revisions(terminal);
  const lifecycleRevision = current.lifecycleRevision + 1;
  const proofRevision = current.proofRevision + 1;
  await revokeActiveTerminalBinding(ctx, {
    correlationId: input.correlationId,
    now: input.now,
    terminalId: input.terminalId,
  });
  await ctx.db.patch("posTerminal", terminal._id, {
    organizationId: input.organizationId,
    storeId: input.targetStoreId,
    syncSecretHash: input.nextProofHash,
    lifecycleRevision,
    proofRevision,
    proofRotatedAt: input.now,
    registeredByUserId: input.reassignedByUserId,
    lastCorrelationId: input.correlationId,
  });
  return {
    fingerprintHash: terminal.fingerprintHash,
    lifecycleRevision,
    proofRevision,
    status: terminal.status,
    storeId: input.targetStoreId,
    terminalId: terminal._id,
  };
}
