import type { Doc, Id } from "../../../_generated/dataModel";
import type { MutationCtx } from "../../../_generated/server";

import { calculateExpenseSessionExpiration } from "../../../inventory/helpers/expenseSessionExpiration";
import {
  createInventoryHoldGateway,
  type PosInventoryHoldGateway,
} from "../../infrastructure/integrations/inventoryHoldGateway";
import {
  createExpenseSessionCommandRepository,
  type ExpenseSessionCommandRepository,
} from "../../infrastructure/repositories/expenseSessionCommandRepository";
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
  inventory: PosInventoryHoldGateway;
};

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
        const registerSessionBinding = await resolveRegisterSessionBinding(
          dependencies,
          {
            storeId: existingSession.storeId,
            terminalId: existingSession.terminalId,
            registerNumber: existingSession.registerNumber ?? registerNumber,
            preferredRegisterSessionId:
              existingSession.registerSessionId ?? args.registerSessionId,
            failureMessage: "Open the cash drawer before starting an expense session.",
          },
        );
        if (registerSessionBinding.status !== "ok") {
          return registerSessionBinding;
        }

        const existingItems = await dependencies.repository.listSessionItems(
          existingSession._id,
        );
        const sessionPatch: Partial<
          Omit<Doc<"expenseSession">, "_id" | "_creationTime">
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

      if (!registerNumber) {
        return failure(
          "validationFailed",
          "A register number is required to create an expense session.",
        );
      }

      const registerSessionBinding = await resolveRegisterSessionBinding(
        dependencies,
        {
          storeId: args.storeId,
          terminalId: args.terminalId,
          registerNumber,
          preferredRegisterSessionId: args.registerSessionId,
          failureMessage: "Open the cash drawer before starting an expense session.",
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
        "EXP",
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

      const registerSessionBinding = await resolveRegisterSessionBinding(
        dependencies,
        {
          storeId: session.storeId,
          terminalId: session.terminalId,
          registerNumber: session.registerNumber,
          preferredRegisterSessionId: session.registerSessionId,
          failureMessage: "Open the cash drawer before resuming this expense session.",
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

      return success({ sessionId: args.sessionId, expiresAt });
    },

    async bindSessionToRegisterSession(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      const validation = validateActiveSession(session, args.staffProfileId, now);
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
          failureMessage: "Open the cash drawer before recovering this expense session.",
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

      return success({ sessionId: args.sessionId, expiresAt });
    },

    async upsertSessionItem(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      const validation = validateActiveSession(session, args.staffProfileId, now);
      if (validation.status !== "ok") {
        return validation;
      }

      const drawerValidation = await validateActiveSessionRegisterBinding(
        dependencies,
        validation.data,
        "Open the cash drawer before modifying this expense session.",
      );
      if (drawerValidation.status !== "ok") {
        return drawerValidation;
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

      const drawerValidation = await validateActiveSessionRegisterBinding(
        dependencies,
        validation.data,
        "Open the cash drawer before modifying this expense session.",
      );
      if (drawerValidation.status !== "ok") {
        return drawerValidation;
      }

      const item = await dependencies.repository.getSessionItemById(args.itemId);
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

      return success({ expiresAt });
    },

    async clearSessionItems(args) {
      const session = await dependencies.repository.getSessionById(
        args.sessionId,
      );
      if (!session) {
        return failure("notFound", "Session not found");
      }

      const drawerValidation = await validateActiveSessionRegisterBinding(
        dependencies,
        session,
        "Open the cash drawer before clearing this expense session.",
      );
      if (drawerValidation.status !== "ok") {
        return drawerValidation;
      }

      const items = await dependencies.repository.listSessionItems(args.sessionId);
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

      return success({ sessionId: args.sessionId });
    },
  };
}

export function runStartExpenseSessionCommand(
  ctx: MutationCtx,
  args: StartExpenseSessionArgs,
) {
  return (async () => {
    const terminal = await ctx.db.get("posTerminal", args.terminalId);
    const terminalRegisterNumber = normalizeRegisterNumber(terminal?.registerNumber);
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
  return createDefaultExpenseSessionCommandService(ctx).bindSessionToRegisterSession(
    args,
  );
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
    inventory: createInventoryHoldGateway(ctx),
  });
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

async function validateActiveSessionRegisterBinding(
  dependencies: ExpenseSessionCommandDependencies,
  session: Doc<"expenseSession">,
  failureMessage: string,
): Promise<
  ExpenseSessionCommandOutcome<{ registerSessionId: Id<"registerSession"> }>
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
