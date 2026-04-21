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

type CommandFailureStatus =
  | "cashierMismatch"
  | "inventoryUnavailable"
  | "notFound"
  | "sessionExpired"
  | "terminalUnavailable"
  | "validationFailed";

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
  cashierId?: Id<"cashier">;
  registerNumber?: string;
}

export interface HoldSessionArgs {
  sessionId: Id<"posSession">;
  cashierId: Id<"cashier">;
  holdReason?: string;
}

export interface ResumeSessionArgs {
  sessionId: Id<"posSession">;
  cashierId: Id<"cashier">;
  terminalId: Id<"posTerminal">;
}

export interface UpsertSessionItemArgs {
  sessionId: Id<"posSession">;
  productId: Id<"product">;
  productSkuId: Id<"productSku">;
  cashierId: Id<"cashier">;
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
  cashierId: Id<"cashier">;
  itemId: Id<"posSessionItem">;
}

export interface PosSessionCommandService {
  startSession(
    args: StartSessionArgs,
  ): Promise<
    PosSessionCommandOutcome<{
      sessionId: Id<"posSession">;
      expiresAt: number;
    }>
  >;
  holdSession(
    args: HoldSessionArgs,
  ): Promise<
    PosSessionCommandOutcome<{
      sessionId: Id<"posSession">;
      expiresAt: number;
    }>
  >;
  resumeSession(
    args: ResumeSessionArgs,
  ): Promise<
    PosSessionCommandOutcome<{
      sessionId: Id<"posSession">;
      expiresAt: number;
    }>
  >;
  upsertSessionItem(
    args: UpsertSessionItemArgs,
  ): Promise<
    PosSessionCommandOutcome<{
      itemId: Id<"posSessionItem">;
      expiresAt: number;
    }>
  >;
  removeSessionItem(
    args: RemoveSessionItemArgs,
  ): Promise<
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
};

export function createPosSessionCommandService(
  dependencies: SessionCommandDependencies,
): PosSessionCommandService {
  return {
    async startSession(args) {
      const now = dependencies.now();
      const registerNumber = args.registerNumber || "1";

      const existingTerminalSessions =
        await dependencies.repository.listActiveSessionsForTerminal({
          storeId: args.storeId,
          terminalId: args.terminalId,
        });

      const nonExpiredTerminalSessions = existingTerminalSessions.filter(
        (session) => !isSessionExpired(session, now),
      );

      const existingSession = nonExpiredTerminalSessions.find(
        (session) => session.cashierId === args.cashierId,
      );

      const cashierSessions = args.cashierId
        ? await dependencies.repository.listActiveSessionsForCashier({
            storeId: args.storeId,
            cashierId: args.cashierId,
          })
        : [];

      const existingSessionOnDifferentTerminal = cashierSessions.find(
        (session) =>
          session.terminalId !== args.terminalId && !isSessionExpired(session, now),
      );

      if (existingSessionOnDifferentTerminal) {
        return failure(
          "terminalUnavailable",
          "A session is active for this cashier on a different terminal",
        );
      }

      if (existingSession) {
        const existingItems = await dependencies.repository.listSessionItems(
          existingSession._id,
        );

        if (existingItems.length > 0) {
          await dependencies.repository.patchSession(existingSession._id, {
            status: "held",
            heldAt: now,
            updatedAt: now,
            holdReason: "Auto-held when new session started",
          });
        }

        return success({
          sessionId: existingSession._id,
          expiresAt: existingSession.expiresAt,
        });
      }

      const latestSessionNumber =
        await dependencies.repository.getLatestSessionNumber(args.storeId);
      const expiresAt = dependencies.calculateExpiration(now);
      const sessionId = await dependencies.repository.createSession({
        sessionNumber: buildNextSessionNumber(latestSessionNumber ?? undefined, "SES"),
        storeId: args.storeId,
        cashierId: args.cashierId,
        terminalId: args.terminalId,
        registerNumber,
        status: "active",
        createdAt: now,
        updatedAt: now,
        expiresAt,
      });

      return success({ sessionId, expiresAt });
    },

    async holdSession(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(args.sessionId);
      const validation = validateModifiableSession(session, args.cashierId, now);
      if (validation.status !== "ok") {
        return validation;
      }

      await dependencies.repository.patchSession(args.sessionId, {
        status: "held",
        heldAt: now,
        updatedAt: now,
        holdReason: args.holdReason,
      });

      return success({
        sessionId: args.sessionId,
        expiresAt: validation.data.expiresAt,
      });
    },

    async resumeSession(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(args.sessionId);
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
          cashierId: args.cashierId,
        });
      const activeSessionsOnOtherTerminals = cashierSessions.filter(
        (candidate) =>
          candidate.terminalId !== args.terminalId && !isSessionExpired(candidate, now),
      );

      if (activeSessionsOnOtherTerminals.length > 0) {
        return failure(
          "terminalUnavailable",
          "This cashier has an active session on another terminal",
        );
      }

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        status: "active",
        resumedAt: now,
        updatedAt: now,
        expiresAt,
      });

      return success({ sessionId: args.sessionId, expiresAt });
    },

    async upsertSessionItem(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(args.sessionId);
      const validation = validateActiveSession(session, args.cashierId, now);
      if (validation.status !== "ok") {
        return validation;
      }

      const existingItem = await dependencies.repository.findSessionItemBySku({
        sessionId: args.sessionId,
        productSkuId: args.productSkuId,
      });

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

      return success({ itemId, expiresAt });
    },

    async removeSessionItem(args) {
      const now = dependencies.now();
      const session = await dependencies.repository.getSessionById(args.sessionId);
      const validation = validateModifiableSession(session, args.cashierId, now);
      if (validation.status !== "ok") {
        return validation;
      }

      const item = await dependencies.repository.getSessionItemById(args.itemId);
      if (!item) {
        return failure("notFound", "Item not found in cart");
      }

      if (item.sessionId !== args.sessionId) {
        return failure("validationFailed", "Item does not belong to this session");
      }

      await dependencies.inventory.releaseHold(item.productSkuId, item.quantity);
      await dependencies.repository.deleteSessionItem(args.itemId);

      const expiresAt = dependencies.calculateExpiration(now);
      await dependencies.repository.patchSession(args.sessionId, {
        updatedAt: now,
        expiresAt,
      });

      return success({ expiresAt });
    },
  };
}

export function runStartSessionCommand(
  ctx: MutationCtx,
  args: StartSessionArgs,
) {
  return createDefaultSessionCommandService(ctx).startSession(args);
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

function isSessionExpired(session: Pick<Doc<"posSession">, "expiresAt" | "status">, now: number) {
  return session.status === "expired" || session.expiresAt < now;
}

function validateActiveSession(
  session: Doc<"posSession"> | null,
  cashierId: Id<"cashier">,
  now: number,
): PosSessionCommandOutcome<Doc<"posSession">> {
  if (!session) {
    return failure(
      "sessionExpired",
      "Your session has expired. Start a new one to proceed.",
    );
  }

  if (session.cashierId !== cashierId) {
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
  cashierId: Id<"cashier">,
  now: number,
): PosSessionCommandOutcome<Doc<"posSession">> {
  if (!session) {
    return failure("notFound", "Session not found");
  }

  if (session.cashierId !== cashierId) {
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
