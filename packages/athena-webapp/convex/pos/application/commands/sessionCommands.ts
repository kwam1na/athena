import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

import { calculateSessionExpiration } from "../../../inventory/helpers/sessionExpiration";
import {
  createInventoryHoldGateway,
  type PosInventoryHoldGateway,
} from "../../infrastructure/integrations/inventoryHoldGateway";
import {
  createSessionCommandRepository,
  type SessionCommandRepository,
} from "../../infrastructure/repositories/sessionCommandRepository";
import {
  createPosSessionTraceRecorder,
  type PosSessionTraceRecorder,
  type PosSessionTraceStage,
  type PosSessionTraceableSession,
} from "./posSessionTracing";
import { isPosUsableRegisterSessionStatus } from "../../../../shared/registerSessionStatus";

type CommandFailureStatus =
  | "cashierMismatch"
  | "inventoryUnavailable"
  | "notFound"
  | "sessionExpired"
  | "terminalUnavailable"
  | "validationFailed";

function normalizeRegisterNumber(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

export type PosSessionCommandOutcome<TData> =
  | {
      status: "ok";
      data: TData;
    }
  | {
      status: CommandFailureStatus;
      message: string;
    };

export interface StartSessionArgs {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  staffProfileId?: Id<"staffProfile">;
  registerNumber?: string;
  registerSessionId?: Id<"registerSession">;
}

export interface HoldSessionArgs {
  sessionId: Id<"posSession">;
  staffProfileId: Id<"staffProfile">;
  holdReason?: string;
}

export interface ResumeSessionArgs {
  sessionId: Id<"posSession">;
  staffProfileId: Id<"staffProfile">;
  terminalId: Id<"posTerminal">;
}

export interface BindSessionToRegisterSessionArgs {
  sessionId: Id<"posSession">;
  staffProfileId: Id<"staffProfile">;
  registerSessionId: Id<"registerSession">;
}

export interface UpsertSessionItemArgs {
  sessionId: Id<"posSession">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  staffProfileId: Id<"staffProfile">;
  productSku: string;
  barcode?: string;
  productName: string;
  price: number;
  quantity: number;
  image?: string;
  size?: string;
  length?: number;
  color?: string;
  areProcessingFeesAbsorbed?: boolean;
}

export interface RemoveSessionItemArgs {
  sessionId: Id<"posSession">;
  staffProfileId: Id<"staffProfile">;
  itemId: Id<"posSessionItem">;
}

export interface PosSessionCommandService {
  startSession(args: StartSessionArgs): Promise<
    PosSessionCommandOutcome<{
      sessionId: Id<"posSession">;
      expiresAt: number;
    }>
  >;
  holdSession(args: HoldSessionArgs): Promise<
    PosSessionCommandOutcome<{
      sessionId: Id<"posSession">;
      expiresAt: number;
    }>
  >;
  resumeSession(args: ResumeSessionArgs): Promise<
    PosSessionCommandOutcome<{
      sessionId: Id<"posSession">;
      expiresAt: number;
    }>
  >;
  bindSessionToRegisterSession(args: BindSessionToRegisterSessionArgs): Promise<
    PosSessionCommandOutcome<{
      sessionId: Id<"posSession">;
      expiresAt: number;
    }>
  >;
  upsertSessionItem(args: UpsertSessionItemArgs): Promise<
    PosSessionCommandOutcome<{
      itemId: Id<"posSessionItem">;
      expiresAt: number;
    }>
  >;
  removeSessionItem(args: RemoveSessionItemArgs): Promise<
    PosSessionCommandOutcome<{
      expiresAt: number;
    }>
  >;
}

type SessionCommandDependencies = {
  now: () => number;
  calculateExpiration: (baseTime: number) => number;
  repository: SessionCommandRepository;
  inventory: PosInventoryHoldGateway;
  tracing?: PosSessionTraceRecorder;
};

export function createPosSessionCommandService(
  dependencies: SessionCommandDependencies,
): PosSessionCommandService {
  return {
    async startSession(args) {
      const now = dependencies.now();
      const registerNumber = normalizeRegisterNumber(args.registerNumber);

      const existingTerminalSessions =
        await dependencies.repository.listActiveSessionsForTerminal({
          storeId: args.storeId,
          terminalId: args.terminalId,
        });

      const nonExpiredTerminalSessions = existingTerminalSessions.filter(
        (session) => !isSessionExpired(session, now),
      );

      const existingSession = nonExpiredTerminalSessions.find(
        (session) => session.staffProfileId === args.staffProfileId,
      );

      const cashierSessions = args.staffProfileId
        ? await dependencies.repository.listActiveSessionsForCashier({
            storeId: args.storeId,
            staffProfileId: args.staffProfileId,
          })
        : [];

      const existingSessionOnDifferentTerminal = cashierSessions.find(
        (session) =>
          session.terminalId !== args.terminalId &&
          !isSessionExpired(session, now),
      );

      if (existingSessionOnDifferentTerminal) {
        return failure(
          "terminalUnavailable",
          "A session is active for this cashier on a different terminal",
        );
      }

      if (existingSession) {
        const registerSessionBinding = await resolveRegisterSessionBinding(
          dependencies,
          {
            storeId: existingSession.storeId,
            terminalId: existingSession.terminalId,
            registerNumber: existingSession.registerNumber ?? registerNumber,
            preferredRegisterSessionId:
              existingSession.registerSessionId ?? args.registerSessionId,
            failureMessage: "Open the cash drawer before starting a sale.",
          },
        );
        if (registerSessionBinding.status !== "ok") {
          return registerSessionBinding;
        }

        const existingItems = await dependencies.repository.listSessionItems(
          existingSession._id,
        );
        const sessionPatch: Partial<
          Omit<Doc<"posSession">, "_id" | "_creationTime">
        > = {};

        if (
          existingSession.registerSessionId !==
          registerSessionBinding.data.registerSessionId
        ) {
          sessionPatch.registerSessionId =
            registerSessionBinding.data.registerSessionId;
          sessionPatch.updatedAt = now;
        }

        if (existingItems.length > 0) {
          Object.assign(sessionPatch, {
            status: "held",
            heldAt: now,
            updatedAt: now,
            holdReason: "Auto-held when new session started",
          });
        }

        if (Object.keys(sessionPatch).length > 0) {
          await dependencies.repository.patchSession(
            existingSession._id,
            sessionPatch,
          );
        }

        const updatedSession = {
          ...existingSession,
          ...sessionPatch,
        };
        if (existingItems.length > 0) {
          await recordSessionLifecycleBestEffort(dependencies, {
            stage: "autoHeld",
            session: updatedSession,
            occurredAt: now,
            holdReason: "Auto-held when new session started",
          });
        }

        return success({
          sessionId: existingSession._id,
          expiresAt: existingSession.expiresAt,
        });
      }

      if (!registerNumber) {
        return failure(
          "validationFailed",
          "A register number is required to start a new session.",
        );
      }

      const registerSessionBinding = await resolveRegisterSessionBinding(
        dependencies,
        {
          storeId: args.storeId,
          terminalId: args.terminalId,
          registerNumber,
          preferredRegisterSessionId: args.registerSessionId,
          failureMessage: "Open the cash drawer before starting a sale.",
        },
      );
      if (registerSessionBinding.status !== "ok") {
        return registerSessionBinding;
      }

      const latestSessionNumber =
        await dependencies.repository.getLatestSessionNumber(args.storeId);
      const expiresAt = dependencies.calculateExpiration(now);
      const sessionNumber = buildNextSessionNumber(
        latestSessionNumber ?? undefined,
        "SES",
      );
      const sessionId = await dependencies.repository.createSession({
        sessionNumber,
        storeId: args.storeId,
        staffProfileId: args.staffProfileId,
        terminalId: args.terminalId,
        registerNumber,
        registerSessionId: registerSessionBinding.data.registerSessionId,
        status: "active",
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });

      await recordSessionLifecycleBestEffort(dependencies, {
        stage: "started",
        session: {
          _id: sessionId,
          sessionNumber,
          storeId: args.storeId,
          staffProfileId: args.staffProfileId,
          terminalId: args.terminalId,
          registerNumber,
          registerSessionId: registerSessionBinding.data.registerSessionId,
          status: "active",
          createdAt: now,
          updatedAt: now,
          expiresAt,
        },
        occurredAt: now,
      });

      return success({ sessionId, expiresAt });
    },

    async holdSession(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      const validation = validateModifiableSession(
        session,
        args.staffProfileId,
        now,
      );
      if (validation.status !== "ok") {
        return validation;
      }

      await dependencies.repository.patchSession(args.sessionId, {
        status: "held",
        heldAt: now,
        updatedAt: now,
        holdReason: args.holdReason,
      });

      await recordSessionLifecycleBestEffort(dependencies, {
        stage: "held",
        session: {
          ...validation.data,
          status: "held",
          heldAt: now,
          updatedAt: now,
          holdReason: args.holdReason,
        },
        occurredAt: now,
        holdReason: args.holdReason,
      });

      return success({
        sessionId: args.sessionId,
        expiresAt: validation.data.expiresAt,
      });
    },

    async resumeSession(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      if (!session) {
        return failure("notFound", "Session not found");
      }

      if (isSessionExpired(session, now)) {
        return failure(
          "sessionExpired",
          "This session has expired. Start a new one to proceed.",
        );
      }

      const cashierSessions =
        await dependencies.repository.listActiveSessionsForCashier({
          storeId: session.storeId,
          staffProfileId: args.staffProfileId,
        });
      const activeSessionsOnOtherTerminals = cashierSessions.filter(
        (candidate) =>
          candidate.terminalId !== args.terminalId &&
          !isSessionExpired(candidate, now),
      );

      if (activeSessionsOnOtherTerminals.length > 0) {
        return failure(
          "terminalUnavailable",
          "This cashier has an active session on another terminal",
        );
      }

      const registerSessionBinding = await resolveRegisterSessionBinding(
        dependencies,
        {
          storeId: session.storeId,
          terminalId: session.terminalId,
          registerNumber: session.registerNumber,
          preferredRegisterSessionId: session.registerSessionId,
          failureMessage: "Open the cash drawer before resuming this sale.",
        },
      );
      if (registerSessionBinding.status !== "ok") {
        return registerSessionBinding;
      }

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        status: "active",
        resumedAt: now,
        updatedAt: now,
        expiresAt,
        registerSessionId: registerSessionBinding.data.registerSessionId,
      });

      await recordSessionLifecycleBestEffort(dependencies, {
        stage: "resumed",
        session: {
          ...session,
          registerSessionId: registerSessionBinding.data.registerSessionId,
          status: "active",
          resumedAt: now,
          updatedAt: now,
        },
        occurredAt: now,
      });

      return success({ sessionId: args.sessionId, expiresAt });
    },

    async bindSessionToRegisterSession(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      const validation = validateActiveSession(
        session,
        args.staffProfileId,
        now,
      );
      if (validation.status !== "ok") {
        return validation;
      }

      const registerSessionBinding = await resolveRegisterSessionBinding(
        dependencies,
        {
          storeId: validation.data.storeId,
          terminalId: validation.data.terminalId,
          registerNumber: validation.data.registerNumber,
          preferredRegisterSessionId: args.registerSessionId,
          failureMessage: "Open the cash drawer before recovering this sale.",
        },
      );
      if (registerSessionBinding.status !== "ok") {
        return registerSessionBinding;
      }

      if (
        validation.data.registerSessionId &&
        validation.data.registerSessionId ===
          registerSessionBinding.data.registerSessionId
      ) {
        return success({
          sessionId: args.sessionId,
          expiresAt: validation.data.expiresAt,
        });
      }

      if (validation.data.registerSessionId) {
        return failure(
          "validationFailed",
          "This sale is already assigned to a different cash drawer.",
        );
      }

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        registerSessionId: registerSessionBinding.data.registerSessionId,
        updatedAt: now,
        expiresAt,
      });

      return success({ sessionId: args.sessionId, expiresAt });
    },

    async upsertSessionItem(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      const validation = validateActiveSession(
        session,
        args.staffProfileId,
        now,
      );
      if (validation.status !== "ok") {
        return validation;
      }

      const drawerValidation = await validateActiveSessionRegisterBinding(
        dependencies,
        validation.data,
        "Open the cash drawer before modifying this sale.",
      );
      if (drawerValidation.status !== "ok") {
        return drawerValidation;
      }

      const existingItem = await dependencies.repository.findSessionItemBySku({
        sessionId: args.sessionId,
        productSkuId: args.productSkuId,
      });
      const previousQuantity = existingItem?.quantity;

      let itemId: Id<"posSessionItem">;
      if (existingItem) {
        const adjustResult = await dependencies.inventory.adjustHold(
          args.productSkuId,
          existingItem.quantity,
          args.quantity,
        );
        if (!adjustResult.success) {
          return failure(
            "inventoryUnavailable",
            adjustResult.message || "Failed to adjust inventory",
          );
        }

        await dependencies.repository.patchSessionItem(existingItem._id, {
          quantity: args.quantity,
          price: args.price,
          barcode: args.barcode,
          color: args.color,
          updatedAt: now,
        });
        itemId = existingItem._id;
      } else {
        const holdResult = await dependencies.inventory.acquireHold(
          args.productSkuId,
          args.quantity,
        );
        if (!holdResult.success) {
          return failure(
            "inventoryUnavailable",
            holdResult.message || "Failed to acquire inventory hold",
          );
        }

        itemId = await dependencies.repository.createSessionItem({
          sessionId: args.sessionId,
          storeId: validation.data.storeId,
          productId: args.productId,
          productSkuId: args.productSkuId,
          productSku: args.productSku,
          barcode: args.barcode,
          productName: args.productName,
          price: args.price,
          quantity: args.quantity,
          image: args.image,
          size: args.size,
          length: args.length,
          color: args.color,
          areProcessingFeesAbsorbed: args.areProcessingFeesAbsorbed,
          createdAt: now,
          updatedAt: now,
        });
      }

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      if (!existingItem || previousQuantity !== args.quantity) {
        await recordSessionLifecycleBestEffort(dependencies, {
          stage: existingItem ? "itemQuantityUpdated" : "itemAdded",
          session: {
            ...validation.data,
            updatedAt: now,
            expiresAt,
          },
          occurredAt: now,
          itemName: args.productName,
          quantity: args.quantity,
          previousQuantity,
        });
      }

      return success({ itemId, expiresAt });
    },

    async removeSessionItem(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      const validation = validateModifiableSession(
        session,
        args.staffProfileId,
        now,
      );
      if (validation.status !== "ok") {
        return validation;
      }

      const drawerValidation = await validateActiveSessionRegisterBinding(
        dependencies,
        validation.data,
        "Open the cash drawer before modifying this sale.",
      );
      if (drawerValidation.status !== "ok") {
        return drawerValidation;
      }

      const item = await dependencies.repository.getSessionItemById(
        args.itemId,
      );
      if (!item) {
        return failure("notFound", "Item not found in cart");
      }

      if (item.sessionId !== args.sessionId) {
        return failure(
          "validationFailed",
          "Item does not belong to this session",
        );
      }

      await dependencies.inventory.releaseHold(
        item.productSkuId,
        item.quantity,
      );
      await dependencies.repository.deleteSessionItem(args.itemId);

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      await recordSessionLifecycleBestEffort(dependencies, {
        stage: "itemRemoved",
        session: {
          ...validation.data,
          updatedAt: now,
          expiresAt,
        },
        occurredAt: now,
        itemName: item.productName,
        quantity: item.quantity,
      });

      return success({ expiresAt });
    },
  };
}

export function runStartSessionCommand(
  ctx: MutationCtx,
  args: StartSessionArgs,
) {
  return (async () => {
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    const terminalRegisterNumber = normalizeRegisterNumber(terminal?.registerNumber);
    const nextRegisterNumber =
      terminalRegisterNumber ?? normalizeRegisterNumber(args.registerNumber);

    return createDefaultSessionCommandService(ctx).startSession({
      ...args,
      registerNumber: nextRegisterNumber,
    });
  })();
}

export function runHoldSessionCommand(ctx: MutationCtx, args: HoldSessionArgs) {
  return createDefaultSessionCommandService(ctx).holdSession(args);
}

export function runResumeSessionCommand(
  ctx: MutationCtx,
  args: ResumeSessionArgs,
) {
  return createDefaultSessionCommandService(ctx).resumeSession(args);
}

export function runBindSessionToRegisterSessionCommand(
  ctx: MutationCtx,
  args: BindSessionToRegisterSessionArgs,
) {
  return createDefaultSessionCommandService(ctx).bindSessionToRegisterSession(
    args,
  );
}

export function runUpsertSessionItemCommand(
  ctx: MutationCtx,
  args: UpsertSessionItemArgs,
) {
  return createDefaultSessionCommandService(ctx).upsertSessionItem(args);
}

export function runRemoveSessionItemCommand(
  ctx: MutationCtx,
  args: RemoveSessionItemArgs,
) {
  return createDefaultSessionCommandService(ctx).removeSessionItem(args);
}

function createDefaultSessionCommandService(
  ctx: MutationCtx,
): PosSessionCommandService {
  return createPosSessionCommandService({
    now: () => Date.now(),
    calculateExpiration: calculateSessionExpiration,
    repository: createSessionCommandRepository(ctx),
    inventory: createInventoryHoldGateway(ctx),
    tracing: createPosSessionTraceRecorder(ctx),
  });
}

async function recordSessionLifecycleBestEffort(
  dependencies: SessionCommandDependencies,
  args: {
    stage: PosSessionTraceStage;
    session: PosSessionTraceableSession;
    occurredAt?: number;
    transactionId?: Id<"posTransaction">;
    holdReason?: string;
    voidReason?: string;
    itemName?: string;
    quantity?: number;
    previousQuantity?: number;
  },
) {
  if (!dependencies.tracing) {
    return;
  }

  try {
    const traceResult = await dependencies.tracing.record(args);
    if (!args.session.workflowTraceId && traceResult.traceCreated) {
      await dependencies.repository.patchSession(args.session._id, {
        workflowTraceId: traceResult.traceId,
      });
    }
  } catch (error) {
    console.error(
      `[workflow-trace] pos.session.lifecycle.${args.stage}`,
      error,
    );
  }
}

function buildNextSessionNumber(
  latestSessionNumber: string | undefined,
  prefix: string,
) {
  const lastSequence = latestSessionNumber
    ? Number.parseInt(latestSessionNumber.split("-").at(-1) ?? "0", 10)
    : 0;
  const nextSequence = Number.isFinite(lastSequence) ? lastSequence + 1 : 1;
  return `${prefix}-${String(nextSequence).padStart(3, "0")}`;
}

function isActiveRegisterSession(
  registerSession: Pick<Doc<"registerSession">, "status">,
) {
  return isPosUsableRegisterSessionStatus(registerSession.status);
}

function registerSessionMatchesIdentity(
  registerSession: Pick<
    Doc<"registerSession">,
    "registerNumber" | "terminalId"
  >,
  identity: {
    terminalId?: Id<"posTerminal">;
    registerNumber?: string;
  },
) {
  if (!identity.terminalId || !registerSession.terminalId) {
    return false;
  }

  if (identity.terminalId !== registerSession.terminalId) {
    return false;
  }

  if (identity.registerNumber) {
    if (!registerSession.registerNumber) {
      return false;
    }

    return identity.registerNumber === registerSession.registerNumber;
  }

  return true;
}

async function resolveRegisterSessionBinding(
  dependencies: SessionCommandDependencies,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    registerNumber?: string;
    preferredRegisterSessionId?: Id<"registerSession">;
    failureMessage: string;
  },
): Promise<
  PosSessionCommandOutcome<{ registerSessionId: Id<"registerSession"> }>
> {
  const registerSession = args.preferredRegisterSessionId
    ? await dependencies.repository.getRegisterSessionById(
        args.preferredRegisterSessionId,
      )
    : await dependencies.repository.getOpenRegisterSessionForIdentity({
        storeId: args.storeId,
        terminalId: args.terminalId,
        registerNumber: args.registerNumber,
      });

  if (
    !registerSession ||
    registerSession.storeId !== args.storeId ||
    !isActiveRegisterSession(registerSession) ||
    !registerSessionMatchesIdentity(registerSession, args)
  ) {
    return failure("validationFailed", args.failureMessage);
  }

  return success({
    registerSessionId: registerSession._id,
  });
}

async function validateActiveSessionRegisterBinding(
  dependencies: SessionCommandDependencies,
  session: Doc<"posSession">,
  failureMessage: string,
): Promise<
  PosSessionCommandOutcome<{ registerSessionId: Id<"registerSession"> }>
> {
  if (!session.registerSessionId) {
    return failure("validationFailed", failureMessage);
  }

  return resolveRegisterSessionBinding(dependencies, {
    storeId: session.storeId,
    terminalId: session.terminalId,
    registerNumber: session.registerNumber,
    preferredRegisterSessionId: session.registerSessionId,
    failureMessage,
  });
}

function isSessionExpired(
  session: Pick<Doc<"posSession">, "expiresAt" | "status">,
  now: number,
) {
  return session.status === "expired" || session.expiresAt < now;
}

function validateActiveSession(
  session: Doc<"posSession"> | null,
  staffProfileId: Id<"staffProfile">,
  now: number,
): PosSessionCommandOutcome<Doc<"posSession">> {
  if (!session) {
    return failure(
      "sessionExpired",
      "Your session has expired. Start a new one to proceed.",
    );
  }

  if (session.staffProfileId !== staffProfileId) {
    return failure(
      "cashierMismatch",
      "This session is not associated with your cashier.",
    );
  }

  if (isSessionExpired(session, now)) {
    return failure(
      "sessionExpired",
      "This session has expired. Start a new one to proceed.",
    );
  }

  if (session.status !== "active") {
    const statusMessages: Record<string, string> = {
      completed:
        "This session has been completed and cannot be modified. Start a new one to proceed",
      void: "This session has been voided and cannot be modified. Start a new one to proceed",
      held: "Can only add items to active sessions. Please resume or create a new session",
      expired: "This session has expired. Start a new one to proceed",
    };

    return failure(
      "validationFailed",
      statusMessages[session.status] || "Session is not active.",
    );
  }

  return success(session);
}

function validateModifiableSession(
  session: Doc<"posSession"> | null,
  staffProfileId: Id<"staffProfile">,
  now: number,
): PosSessionCommandOutcome<Doc<"posSession">> {
  if (!session) {
    return failure("notFound", "Session not found");
  }

  if (session.staffProfileId !== staffProfileId) {
    return failure(
      "cashierMismatch",
      "This session is not associated with your cashier.",
    );
  }

  if (isSessionExpired(session, now)) {
    return failure(
      "sessionExpired",
      "This session has expired. Start a new one to proceed.",
    );
  }

  if (session.status === "completed" || session.status === "void") {
    return failure(
      "validationFailed",
      `Cannot modify ${session.status} session. This is for audit integrity.`,
    );
  }

  return success(session);
}

function success<TData>(data: TData): PosSessionCommandOutcome<TData> {
  return {
    status: "ok",
    data,
  };
}

function failure<TData>(
  status: CommandFailureStatus,
  message: string,
): PosSessionCommandOutcome<TData> {
  return {
    status,
    message,
  };
}
