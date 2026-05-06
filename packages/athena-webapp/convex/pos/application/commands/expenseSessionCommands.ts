import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

import { calculateExpenseSessionExpiration } from "../../../inventory/helpers/expenseSessionExpiration";
import {
  createExpenseSessionCommandRepository,
  type ExpenseSessionCommandRepository,
} from "../../infrastructure/repositories/expenseSessionCommandRepository";
import { isPosUsableRegisterSessionStatus } from "../../../../shared/registerSessionStatus";
import {
  createExpenseSessionTraceRecorder,
  type ExpenseSessionTraceRecorder,
  type ExpenseSessionTraceStage,
} from "./expenseSessionTracing";

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

export type ExpenseSessionCommandOutcome<TData> =
  | {
      status: "ok";
      data: TData;
    }
  | {
      status: CommandFailureStatus;
      message: string;
    };

export interface StartExpenseSessionArgs {
  storeId: Id<"store">;
  terminalId: Id<"posTerminal">;
  staffProfileId: Id<"staffProfile">;
  registerNumber?: string;
  registerSessionId?: Id<"registerSession">;
}

export interface ResumeExpenseSessionArgs {
  sessionId: Id<"expenseSession">;
  staffProfileId: Id<"staffProfile">;
  terminalId: Id<"posTerminal">;
}

export interface BindExpenseSessionToRegisterSessionArgs {
  sessionId: Id<"expenseSession">;
  staffProfileId: Id<"staffProfile">;
  registerSessionId: Id<"registerSession">;
}

export interface UpsertExpenseSessionItemArgs {
  sessionId: Id<"expenseSession">;
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
}

export interface RemoveExpenseSessionItemArgs {
  sessionId: Id<"expenseSession">;
  staffProfileId: Id<"staffProfile">;
  itemId: Id<"expenseSessionItem">;
}

export interface ClearExpenseSessionItemsArgs {
  sessionId: Id<"expenseSession">;
}

export interface ExpenseSessionCommandService {
  startSession(args: StartExpenseSessionArgs): Promise<
    ExpenseSessionCommandOutcome<{
      sessionId: Id<"expenseSession">;
      expiresAt: number;
    }>
  >;
  resumeSession(args: ResumeExpenseSessionArgs): Promise<
    ExpenseSessionCommandOutcome<{
      sessionId: Id<"expenseSession">;
      expiresAt: number;
    }>
  >;
  bindSessionToRegisterSession(
    args: BindExpenseSessionToRegisterSessionArgs,
  ): Promise<
    ExpenseSessionCommandOutcome<{
      sessionId: Id<"expenseSession">;
      expiresAt: number;
    }>
  >;
  upsertSessionItem(args: UpsertExpenseSessionItemArgs): Promise<
    ExpenseSessionCommandOutcome<{
      itemId: Id<"expenseSessionItem">;
      expiresAt: number;
    }>
  >;
  removeSessionItem(args: RemoveExpenseSessionItemArgs): Promise<
    ExpenseSessionCommandOutcome<{
      expiresAt: number;
    }>
  >;
  clearSessionItems(args: ClearExpenseSessionItemsArgs): Promise<
    ExpenseSessionCommandOutcome<{
      sessionId: Id<"expenseSession">;
    }>
  >;
}

type ExpenseSessionCommandDependencies = {
  now: () => number;
  calculateExpiration: (baseTime: number) => number;
  repository: ExpenseSessionCommandRepository;
  inventory: ExpenseInventoryHoldGateway;
  traceRecorder?: ExpenseSessionTraceRecorder;
};

interface ExpenseInventoryHoldGatewayResult {
  success: boolean;
  message?: string;
  available?: number;
}

interface ExpenseInventoryHoldGateway {
  acquireHold(
    skuId: Id<"productSku">,
    quantity: number,
  ): Promise<ExpenseInventoryHoldGatewayResult>;
  adjustHold(
    skuId: Id<"productSku">,
    oldQuantity: number,
    newQuantity: number,
  ): Promise<ExpenseInventoryHoldGatewayResult>;
  releaseHold(
    skuId: Id<"productSku">,
    quantity: number,
  ): Promise<ExpenseInventoryHoldGatewayResult>;
}

export function createExpenseSessionCommandService(
  dependencies: ExpenseSessionCommandDependencies,
): ExpenseSessionCommandService {
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

      const staffSessions =
        await dependencies.repository.listActiveSessionsForStaffProfile({
          storeId: args.storeId,
          staffProfileId: args.staffProfileId,
        });

      const existingSessionOnDifferentTerminal = staffSessions.find(
        (session) =>
          session.terminalId !== args.terminalId &&
          !isSessionExpired(session, now),
      );

      if (existingSessionOnDifferentTerminal) {
        return failure(
          "terminalUnavailable",
          "A session is active for this staff profile on a different terminal",
        );
      }

      if (existingSession) {
        const existingItems = await dependencies.repository.listSessionItems(
          existingSession._id,
        );
        const sessionPatch: Partial<
          Omit<Doc<"expenseSession">, "_id" | "_creationTime">
        > = {};

        if (existingItems.length > 0) {
          Object.assign(sessionPatch, {
            status: "held",
            heldAt: now,
            updatedAt: now,
          });
        }

        if (Object.keys(sessionPatch).length > 0) {
          await dependencies.repository.patchSession(
            existingSession._id,
            sessionPatch,
          );
        }

        return success({
          sessionId: existingSession._id,
          expiresAt: existingSession.expiresAt,
        });
      }

      const latestSessionNumber =
        await dependencies.repository.getLatestSessionNumber(args.storeId);
      const expiresAt = dependencies.calculateExpiration(now);
      const sessionNumber = buildNextSessionNumber(
        latestSessionNumber ?? undefined,
        "EXP",
      );
      const sessionId = await dependencies.repository.createSession({
        sessionNumber,
        storeId: args.storeId,
        staffProfileId: args.staffProfileId,
        terminalId: args.terminalId,
        registerNumber,
        status: "active",
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });

      await recordSessionTrace(dependencies, {
        sessionId,
        stage: "started",
      });

      return success({ sessionId, expiresAt });
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

      const staffSessions =
        await dependencies.repository.listActiveSessionsForStaffProfile({
          storeId: session.storeId,
          staffProfileId: args.staffProfileId,
        });
      const activeSessionsOnOtherTerminals = staffSessions.filter(
        (candidate) =>
          candidate.terminalId !== args.terminalId &&
          !isSessionExpired(candidate, now),
      );

      if (activeSessionsOnOtherTerminals.length > 0) {
        return failure(
          "terminalUnavailable",
          "This staff profile has an active session on another terminal",
        );
      }

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        status: "active",
        resumedAt: now,
        updatedAt: now,
        expiresAt,
      });

      await recordSessionTrace(dependencies, {
        sessionId: args.sessionId,
        stage: "resumed",
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
          failureMessage:
            "Open the cash drawer before recovering this expense session.",
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
          "This expense session is already assigned to a different cash drawer.",
        );
      }

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        registerSessionId: registerSessionBinding.data.registerSessionId,
        updatedAt: now,
        expiresAt,
      });

      await recordSessionTrace(dependencies, {
        sessionId: args.sessionId,
        stage: "registerBound",
        occurredAt: now,
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

      const existingItem = await dependencies.repository.findSessionItemBySku({
        sessionId: args.sessionId,
        productSkuId: args.productSkuId,
      });

      let itemId: Id<"expenseSessionItem">;
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
        await recordSessionTrace(dependencies, {
          sessionId: args.sessionId,
          stage: "itemQuantityUpdated",
          occurredAt: now,
          itemName: args.productName,
          quantity: args.quantity,
          previousQuantity: existingItem.quantity,
        });
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
          createdAt: now,
          updatedAt: now,
        });
        await recordSessionTrace(dependencies, {
          sessionId: args.sessionId,
          stage: "itemAdded",
          occurredAt: now,
          itemName: args.productName,
          quantity: args.quantity,
        });
      }

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

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

      const releaseResult = await dependencies.inventory.releaseHold(
        item.productSkuId,
        item.quantity,
      );
      if (!releaseResult.success) {
        return failure(
          "inventoryUnavailable",
          releaseResult.message || "Failed to release inventory hold",
        );
      }

      await dependencies.repository.deleteSessionItem(args.itemId);

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      await recordSessionTrace(dependencies, {
        sessionId: args.sessionId,
        stage: "itemRemoved",
        occurredAt: now,
        itemName: item.productName,
        quantity: item.quantity,
      });

      return success({ expiresAt });
    },

    async clearSessionItems(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      if (!session) {
        return failure("notFound", "Session not found");
      }

      const items = await dependencies.repository.listSessionItems(
        args.sessionId,
      );
      const heldQuantities = new Map<Id<"productSku">, number>();
      for (const item of items) {
        heldQuantities.set(
          item.productSkuId,
          (heldQuantities.get(item.productSkuId) ?? 0) + item.quantity,
        );
      }

      for (const [skuId, quantity] of heldQuantities.entries()) {
        const releaseResult = await dependencies.inventory.releaseHold(
          skuId,
          quantity,
        );
        if (!releaseResult.success) {
          return failure(
            "inventoryUnavailable",
            releaseResult.message || "Failed to release inventory hold",
          );
        }
      }

      for (const item of items) {
        await dependencies.repository.deleteSessionItem(item._id);
      }

      await recordSessionTrace(dependencies, {
        sessionId: args.sessionId,
        stage: "cartCleared",
        occurredAt: now,
        itemCount: items.length,
      });

      return success({ sessionId: args.sessionId });
    },
  };
}

async function recordSessionTrace(
  dependencies: ExpenseSessionCommandDependencies,
  args: {
    sessionId: Id<"expenseSession">;
    stage: ExpenseSessionTraceStage;
    occurredAt?: number;
    itemName?: string;
    quantity?: number;
    previousQuantity?: number;
    itemCount?: number;
  },
) {
  if (!dependencies.traceRecorder) {
    return;
  }

  const session = await dependencies.repository.getSessionById(args.sessionId);
  if (!session) {
    return;
  }

  const traceResult = await dependencies.traceRecorder.record({
    stage: args.stage,
    session,
    occurredAt: args.occurredAt,
    itemName: args.itemName,
    quantity: args.quantity,
    previousQuantity: args.previousQuantity,
    itemCount: args.itemCount,
  });

  if (traceResult.traceCreated && !session.workflowTraceId) {
    await dependencies.repository.patchSession(args.sessionId, {
      workflowTraceId: traceResult.traceId,
    });
  }
}

export function runStartExpenseSessionCommand(
  ctx: MutationCtx,
  args: StartExpenseSessionArgs,
) {
  return (async () => {
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    const terminalRegisterNumber = normalizeRegisterNumber(
      terminal?.registerNumber,
    );
    const nextRegisterNumber =
      terminalRegisterNumber ?? normalizeRegisterNumber(args.registerNumber);

    return createDefaultExpenseSessionCommandService(ctx).startSession({
      ...args,
      registerNumber: nextRegisterNumber,
    });
  })();
}

export function runResumeExpenseSessionCommand(
  ctx: MutationCtx,
  args: ResumeExpenseSessionArgs,
) {
  return createDefaultExpenseSessionCommandService(ctx).resumeSession(args);
}

export function runBindExpenseSessionToRegisterSessionCommand(
  ctx: MutationCtx,
  args: BindExpenseSessionToRegisterSessionArgs,
) {
  return createDefaultExpenseSessionCommandService(
    ctx,
  ).bindSessionToRegisterSession(args);
}

export function runUpsertExpenseSessionItemCommand(
  ctx: MutationCtx,
  args: UpsertExpenseSessionItemArgs,
) {
  return createDefaultExpenseSessionCommandService(ctx).upsertSessionItem(args);
}

export function runRemoveExpenseSessionItemCommand(
  ctx: MutationCtx,
  args: RemoveExpenseSessionItemArgs,
) {
  return createDefaultExpenseSessionCommandService(ctx).removeSessionItem(args);
}

export function runClearExpenseSessionItemsCommand(
  ctx: MutationCtx,
  args: ClearExpenseSessionItemsArgs,
) {
  return createDefaultExpenseSessionCommandService(ctx).clearSessionItems(args);
}

function createDefaultExpenseSessionCommandService(
  ctx: MutationCtx,
): ExpenseSessionCommandService {
  return createExpenseSessionCommandService({
    now: () => Date.now(),
    calculateExpiration: calculateExpenseSessionExpiration,
    repository: createExpenseSessionCommandRepository(ctx),
    inventory: createExpenseInventoryHoldGateway(ctx),
    traceRecorder: createExpenseSessionTraceRecorder(ctx),
  });
}

function createExpenseInventoryHoldGateway(
  ctx: MutationCtx,
): ExpenseInventoryHoldGateway {
  return {
    acquireHold(skuId, quantity) {
      return acquireExpenseQuantityPatchHold(ctx, skuId, quantity);
    },
    adjustHold(skuId, oldQuantity, newQuantity) {
      return adjustExpenseQuantityPatchHold(
        ctx,
        skuId,
        oldQuantity,
        newQuantity,
      );
    },
    releaseHold(skuId, quantity) {
      return releaseExpenseQuantityPatchHold(ctx, skuId, quantity);
    },
  };
}

async function acquireExpenseQuantityPatchHold(
  ctx: MutationCtx,
  skuId: Id<"productSku">,
  quantity: number,
): Promise<ExpenseInventoryHoldGatewayResult> {
  const sku = await ctx.db.get("productSku", skuId);
  if (!sku || typeof sku.quantityAvailable !== "number") {
    return { success: false, message: "Product not found" };
  }

  if (sku.quantityAvailable < quantity) {
    return {
      success: false,
      message: `Only ${sku.quantityAvailable} unit${sku.quantityAvailable !== 1 ? "s" : ""} available`,
      available: sku.quantityAvailable,
    };
  }

  await ctx.db.patch("productSku", skuId, {
    quantityAvailable: sku.quantityAvailable - quantity,
  });
  return { success: true };
}

async function releaseExpenseQuantityPatchHold(
  ctx: MutationCtx,
  skuId: Id<"productSku">,
  quantity: number,
): Promise<ExpenseInventoryHoldGatewayResult> {
  const sku = await ctx.db.get("productSku", skuId);
  if (!sku || typeof sku.quantityAvailable !== "number") {
    return { success: true };
  }

  await ctx.db.patch("productSku", skuId, {
    quantityAvailable: sku.quantityAvailable + quantity,
  });
  return { success: true };
}

async function adjustExpenseQuantityPatchHold(
  ctx: MutationCtx,
  skuId: Id<"productSku">,
  oldQuantity: number,
  newQuantity: number,
): Promise<ExpenseInventoryHoldGatewayResult> {
  const quantityChange = newQuantity - oldQuantity;
  if (quantityChange === 0) {
    return { success: true };
  }

  if (quantityChange > 0) {
    return acquireExpenseQuantityPatchHold(ctx, skuId, quantityChange);
  }

  return releaseExpenseQuantityPatchHold(ctx, skuId, Math.abs(quantityChange));
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
  dependencies: ExpenseSessionCommandDependencies,
  args: {
    storeId: Id<"store">;
    terminalId: Id<"posTerminal">;
    registerNumber?: string;
    preferredRegisterSessionId?: Id<"registerSession">;
    failureMessage: string;
  },
): Promise<
  ExpenseSessionCommandOutcome<{ registerSessionId: Id<"registerSession"> }>
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

function isSessionExpired(
  session: Pick<Doc<"expenseSession">, "expiresAt" | "status">,
  now: number,
) {
  return session.status === "expired" || session.expiresAt < now;
}

function validateActiveSession(
  session: Doc<"expenseSession"> | null,
  staffProfileId: Id<"staffProfile">,
  now: number,
): ExpenseSessionCommandOutcome<Doc<"expenseSession">> {
  if (!session) {
    return failure(
      "sessionExpired",
      "Your session has expired. Start a new one to proceed.",
    );
  }

  if (session.staffProfileId !== staffProfileId) {
    return failure(
      "cashierMismatch",
      "This session is not associated with your staff profile.",
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
  session: Doc<"expenseSession"> | null,
  staffProfileId: Id<"staffProfile">,
  now: number,
): ExpenseSessionCommandOutcome<Doc<"expenseSession">> {
  if (!session) {
    return failure("notFound", "Session not found");
  }

  if (session.staffProfileId !== staffProfileId) {
    return failure(
      "cashierMismatch",
      "This session is not associated with your staff profile.",
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

function success<TData>(data: TData): ExpenseSessionCommandOutcome<TData> {
  return {
    status: "ok",
    data,
  };
}

function failure<TData>(
  status: CommandFailureStatus,
  message: string,
): ExpenseSessionCommandOutcome<TData> {
  return {
    status,
    message,
  };
}
