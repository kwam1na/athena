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
import { applyInventoryEffectWithCtx } from "../../../reporting/inventory/effects";
import { resolveReportingOperatingPeriodWithCtx } from "../../../reporting/operatingPeriods";

type CommandFailureStatus =
  | "cashierMismatch"
  | "inventoryUnavailable"
  | "notFound"
  | "sessionExpired"
  | "terminalUnavailable"
  | "validationFailed";

type InventoryImportProvisionalSkuId = Id<"inventoryImportProvisionalSku">;

function normalizeRegisterNumber(value?: string): string | undefined {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function expenseSessionItemSourceKey(item: {
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
  linkedPendingTrustedItemIds?: Set<Id<"posPendingCheckoutItem">>;
}) {
  if (item.inventoryImportProvisionalSkuId) {
    return `provisional_import:${item.inventoryImportProvisionalSkuId}`;
  }
  if (
    item.pendingCheckoutItemId &&
    !item.linkedPendingTrustedItemIds?.has(item.pendingCheckoutItemId)
  ) {
    return `pending_checkout:${item.pendingCheckoutItemId}`;
  }
  return "trusted_inventory";
}

function expenseSessionItemHasTrustedAvailabilityHold(item: {
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
  inventoryHoldApplied?: boolean;
}) {
  return (
    expenseSessionItemSourceKey(item) === "trusted_inventory" &&
    item.inventoryHoldApplied !== false
  );
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
  pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
  inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
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

function pendingCheckoutItemMatchesExpenseLine(
  pendingItem: Doc<"posPendingCheckoutItem"> | null,
  args: {
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  return (
    pendingItem?.storeId === args.storeId &&
    (pendingItem.status === "pending_review" ||
      pendingItem.status === "flagged") &&
    pendingItem.provisionalProductId === args.productId &&
    pendingItem.provisionalProductSkuId === args.productSkuId
  );
}

function linkedPendingCheckoutItemMatchesTrustedExpenseLine(
  pendingItem: Doc<"posPendingCheckoutItem"> | null,
  args: {
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
) {
  return (
    pendingItem?.storeId === args.storeId &&
    pendingItem.status === "linked_to_catalog" &&
    pendingItem.approvedProductId === args.productId &&
    pendingItem.approvedProductSkuId === args.productSkuId
  );
}

async function validateExpensePendingCheckoutLine(
  dependencies: ExpenseSessionCommandDependencies,
  args: {
    pendingCheckoutItemId?: Id<"posPendingCheckoutItem">;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
): Promise<ExpenseSessionCommandOutcome<{ isPendingCheckoutLine: boolean }>> {
  if (!args.pendingCheckoutItemId) {
    return success({ isPendingCheckoutLine: false });
  }

  const pendingItem = await dependencies.repository.getPendingCheckoutItem(
    args.pendingCheckoutItemId,
  );
  if (linkedPendingCheckoutItemMatchesTrustedExpenseLine(pendingItem, args)) {
    return success({ isPendingCheckoutLine: false });
  }

  if (!pendingCheckoutItemMatchesExpenseLine(pendingItem, args)) {
    return failure(
      "validationFailed",
      "This pending checkout item no longer matches the expense line. Add it again before continuing.",
    );
  }

  return success({ isPendingCheckoutLine: true });
}

async function validateExpenseProvisionalImportLine(
  dependencies: ExpenseSessionCommandDependencies,
  args: {
    inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
    productId: Id<"product">;
    productSkuId: Id<"productSku">;
    storeId: Id<"store">;
  },
): Promise<
  ExpenseSessionCommandOutcome<{
    inventoryImportProvisionalSkuId?: InventoryImportProvisionalSkuId;
    isProvisionalImportLine: boolean;
  }>
> {
  if (!args.inventoryImportProvisionalSkuId) {
    return success({ isProvisionalImportLine: false });
  }

  const provisionalSku =
    await dependencies.repository.getActiveProvisionalImportSkuForStoreSku({
      storeId: args.storeId,
      productId: args.productId,
      productSkuId: args.productSkuId,
      provisionalSkuId: args.inventoryImportProvisionalSkuId,
    });

  if (!provisionalSku) {
    return failure(
      "validationFailed",
      "This provisional import item is no longer active for this expense line. Refresh the register catalog before continuing.",
    );
  }

  return success({
    inventoryImportProvisionalSkuId: provisionalSku._id,
    isProvisionalImportLine: true,
  });
}

interface ExpenseInventoryHoldGatewayResult {
  success: boolean;
  message?: string;
  available?: number;
  holdApplied?: boolean;
}

interface ExpenseInventoryHoldGateway {
  acquireHold(
    args: ExpenseInventoryHoldEffectArgs,
  ): Promise<ExpenseInventoryHoldGatewayResult>;
  adjustHold(
    args: ExpenseInventoryHoldEffectArgs & {
      oldQuantity: number;
    },
  ): Promise<ExpenseInventoryHoldGatewayResult>;
  releaseHold(
    args: ExpenseInventoryHoldEffectArgs,
  ): Promise<ExpenseInventoryHoldGatewayResult>;
}

type ExpenseInventoryHoldEffectArgs = {
  actorStaffProfileId: Id<"staffProfile">;
  businessEventKey: string;
  occurredAt: number;
  quantity: number;
  sessionId: Id<"expenseSession">;
  sourceLineId: string;
  skuId: Id<"productSku">;
  storeId: Id<"store">;
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

      const recoverableTerminalSessions = existingTerminalSessions.filter(
        (session) => !isSessionExpired(session),
      );

      const existingSession = recoverableTerminalSessions.find(
        (session) => session.staffProfileId === args.staffProfileId,
      );

      const staffSessions =
        await dependencies.repository.listActiveSessionsForStaffProfile({
          storeId: args.storeId,
          staffProfileId: args.staffProfileId,
        });

      const existingSessionOnDifferentTerminal = staffSessions.find(
        (session) =>
          session.terminalId !== args.terminalId && !isSessionExpired(session),
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

      if (isSessionExpired(session)) {
        return failure(
          "sessionExpired",
          "This session is no longer active. Start a new one to proceed.",
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
          !isSessionExpired(candidate),
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
      const validation = validateActiveSession(session, args.staffProfileId);
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
      const validation = validateActiveSession(session, args.staffProfileId);
      if (validation.status !== "ok") {
        return validation;
      }

      if (args.pendingCheckoutItemId && args.inventoryImportProvisionalSkuId) {
        return failure(
          "validationFailed",
          "This expense line has conflicting inventory sources. Remove the item and add it again before continuing.",
        );
      }

      const pendingValidation = await validateExpensePendingCheckoutLine(
        dependencies,
        {
          pendingCheckoutItemId: args.pendingCheckoutItemId,
          productId: args.productId,
          productSkuId: args.productSkuId,
          storeId: validation.data.storeId,
        },
      );
      if (pendingValidation.status !== "ok") {
        return pendingValidation;
      }
      const isPendingCheckoutLine =
        pendingValidation.data.isPendingCheckoutLine;
      const pendingCheckoutItemIdForSession = args.pendingCheckoutItemId;

      const provisionalImportValidation =
        await validateExpenseProvisionalImportLine(dependencies, {
          inventoryImportProvisionalSkuId: args.inventoryImportProvisionalSkuId,
          productId: args.productId,
          productSkuId: args.productSkuId,
          storeId: validation.data.storeId,
        });
      if (provisionalImportValidation.status !== "ok") {
        return provisionalImportValidation;
      }
      const isProvisionalImportLine =
        provisionalImportValidation.data.isProvisionalImportLine;
      const sameSkuItems = (
        await dependencies.repository.listSessionItems(args.sessionId)
      ).filter((item) => item.productSkuId === args.productSkuId);
      const linkedPendingTrustedItemIds = new Set<
        Id<"posPendingCheckoutItem">
      >();
      if (!isPendingCheckoutLine && args.pendingCheckoutItemId) {
        linkedPendingTrustedItemIds.add(args.pendingCheckoutItemId);
      }
      await Promise.all(
        sameSkuItems.map(async (item) => {
          if (!item.pendingCheckoutItemId) return;
          const pendingItem =
            await dependencies.repository.getPendingCheckoutItem(
              item.pendingCheckoutItemId,
            );
          if (
            linkedPendingCheckoutItemMatchesTrustedExpenseLine(pendingItem, {
              productId: args.productId,
              productSkuId: args.productSkuId,
              storeId: validation.data.storeId,
            })
          ) {
            linkedPendingTrustedItemIds.add(item.pendingCheckoutItemId);
          }
        }),
      );
      const nextLineSourceKey = expenseSessionItemSourceKey({
        inventoryImportProvisionalSkuId:
          provisionalImportValidation.data.inventoryImportProvisionalSkuId,
        pendingCheckoutItemId: pendingCheckoutItemIdForSession,
        linkedPendingTrustedItemIds,
      });
      const existingItem = sameSkuItems.find(
        (item) =>
          expenseSessionItemSourceKey({
            ...item,
            linkedPendingTrustedItemIds,
          }) === nextLineSourceKey,
      );
      const conflictingSourceItem = sameSkuItems.find((item) => {
        const existingSourceKey = expenseSessionItemSourceKey({
          ...item,
          linkedPendingTrustedItemIds,
        });
        if (existingSourceKey === nextLineSourceKey) return false;
        return !(
          existingSourceKey.startsWith("provisional_import:") &&
          nextLineSourceKey.startsWith("provisional_import:")
        );
      });
      if (conflictingSourceItem?.pendingCheckoutItemId) {
        return failure(
          "validationFailed",
          "This pending checkout item no longer matches the expense line. Add it again before continuing.",
        );
      }
      if (conflictingSourceItem) {
        return failure(
          "validationFailed",
          "This expense line already uses a different inventory source. Remove the item and add it again before continuing.",
        );
      }

      let itemId: Id<"expenseSessionItem">;
      if (existingItem) {
        let nextInventoryHoldApplied = existingItem.inventoryHoldApplied;
        if (expenseSessionItemHasTrustedAvailabilityHold(existingItem)) {
          const adjustResult = await dependencies.inventory.adjustHold({
            actorStaffProfileId: args.staffProfileId,
            businessEventKey: `expense_session:${args.sessionId}:item:${existingItem._id}:adjust:${existingItem.updatedAt}`,
            occurredAt: now,
            oldQuantity: existingItem.quantity,
            quantity: args.quantity,
            sessionId: args.sessionId,
            sourceLineId: String(existingItem._id),
            skuId: args.productSkuId,
            storeId: validation.data.storeId,
          });
          if (!adjustResult.success) {
            return failure(
              "inventoryUnavailable",
              adjustResult.message || "Failed to adjust inventory",
            );
          }
          if (adjustResult.holdApplied === false) {
            return failure(
              "inventoryUnavailable",
              adjustResult.message || "Failed to adjust inventory",
            );
          }
          nextInventoryHoldApplied = true;
        }

        await dependencies.repository.patchSessionItem(existingItem._id, {
          quantity: args.quantity,
          price: args.price,
          barcode: args.barcode,
          color: args.color,
          pendingCheckoutItemId: pendingCheckoutItemIdForSession,
          inventoryImportProvisionalSkuId:
            provisionalImportValidation.data.inventoryImportProvisionalSkuId,
          inventoryHoldApplied:
            isPendingCheckoutLine || isProvisionalImportLine
              ? false
              : nextInventoryHoldApplied,
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
        let inventoryHoldApplied = false;
        if (!isPendingCheckoutLine && !isProvisionalImportLine) {
          const holdResult = await dependencies.inventory.acquireHold({
            actorStaffProfileId: args.staffProfileId,
            businessEventKey: `expense_session:${args.sessionId}:sku:${args.productSkuId}:acquire:${validation.data.updatedAt}`,
            occurredAt: now,
            quantity: args.quantity,
            sessionId: args.sessionId,
            sourceLineId: nextLineSourceKey,
            skuId: args.productSkuId,
            storeId: validation.data.storeId,
          });
          if (!holdResult.success) {
            return failure(
              "inventoryUnavailable",
              holdResult.message || "Failed to acquire inventory hold",
            );
          }
          if (!holdResult.holdApplied) {
            return failure(
              "inventoryUnavailable",
              holdResult.message || "Failed to acquire inventory hold",
            );
          }
          inventoryHoldApplied = true;
        }

        itemId = await dependencies.repository.createSessionItem({
          sessionId: args.sessionId,
          storeId: validation.data.storeId,
          productId: args.productId,
          productSkuId: args.productSkuId,
          pendingCheckoutItemId: pendingCheckoutItemIdForSession,
          inventoryImportProvisionalSkuId:
            provisionalImportValidation.data.inventoryImportProvisionalSkuId,
          inventoryHoldApplied,
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

      if (expenseSessionItemHasTrustedAvailabilityHold(item)) {
        const releaseResult = await dependencies.inventory.releaseHold({
          actorStaffProfileId: args.staffProfileId,
          businessEventKey: `expense_session:${args.sessionId}:item:${item._id}:release`,
          occurredAt: now,
          quantity: item.quantity,
          sessionId: args.sessionId,
          sourceLineId: String(item._id),
          skuId: item.productSkuId,
          storeId: validation.data.storeId,
        });
        if (!releaseResult.success) {
          return failure(
            "inventoryUnavailable",
            releaseResult.message || "Failed to release inventory hold",
          );
        }
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
        if (!expenseSessionItemHasTrustedAvailabilityHold(item)) {
          continue;
        }

        heldQuantities.set(
          item.productSkuId,
          (heldQuantities.get(item.productSkuId) ?? 0) + item.quantity,
        );
      }

      for (const [skuId, quantity] of heldQuantities.entries()) {
        const sourceLineIds = items
          .filter(
            (item) =>
              item.productSkuId === skuId &&
              expenseSessionItemHasTrustedAvailabilityHold(item),
          )
          .map((item) => String(item._id))
          .sort();
        const releaseResult = await dependencies.inventory.releaseHold({
          actorStaffProfileId: session.staffProfileId,
          businessEventKey: `expense_session:${args.sessionId}:clear:${skuId}:${sourceLineIds.join(",")}`,
          occurredAt: now,
          quantity,
          sessionId: args.sessionId,
          sourceLineId: sourceLineIds.join(","),
          skuId,
          storeId: session.storeId,
        });
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
    acquireHold(args) {
      return acquireExpenseQuantityEffectHold(ctx, args);
    },
    adjustHold(args) {
      return adjustExpenseQuantityEffectHold(ctx, args);
    },
    releaseHold(args) {
      return releaseExpenseQuantityEffectHold(ctx, args);
    },
  };
}

async function applyExpenseAvailabilityEffect(
  ctx: MutationCtx,
  args: ExpenseInventoryHoldEffectArgs & {
    activityType: "reservation_acquired" | "reservation_released";
    sellableQuantityDelta: number;
  },
) {
  const sku = await ctx.db.get("productSku", args.skuId);
  if (!sku || typeof sku.quantityAvailable !== "number") {
    return false;
  }
  const store = await ctx.db.get("store", args.storeId);
  if (!store || sku.storeId !== args.storeId) {
    return false;
  }
  const reportingPeriod = await resolveReportingOperatingPeriodWithCtx(ctx, {
    occurrenceAt: args.occurredAt,
    storeId: args.storeId,
  });
  const nextSellable = Math.min(
    sku.inventoryCount,
    sku.quantityAvailable + args.sellableQuantityDelta,
  );
  await applyInventoryEffectWithCtx(ctx, {
    activityStatus:
      args.activityType === "reservation_acquired" ? "active" : "released",
    activityType: args.activityType,
    actorStaffProfileId: args.actorStaffProfileId,
    businessEventKey: args.businessEventKey,
    compatibilityBalance: {
      onHandQuantity: sku.inventoryCount,
      sellableQuantity: nextSellable,
    },
    completeness: reportingPeriod.kind === "resolved" ? "complete" : "partial",
    contentFingerprint: `expense-hold:v1:${args.businessEventKey}:${args.sellableQuantityDelta}`,
    effectType: "adjustment",
    movementType: "reservation",
    occurrenceAt: args.occurredAt,
    ...(reportingPeriod.kind === "resolved"
      ? {
          operatingDate: reportingPeriod.operatingDate,
          scheduleVersionId:
            reportingPeriod.scheduleVersionId as Id<"storeSchedule">,
        }
      : {}),
    organizationId: store.organizationId,
    physicalQuantityDelta: 0,
    productId: sku.productId,
    productSkuId: args.skuId,
    reasonCode:
      args.activityType === "reservation_acquired"
        ? "expense_inventory_hold_acquired"
        : "expense_inventory_hold_released",
    recordedAt: args.occurredAt,
    sellableQuantityDelta: args.sellableQuantityDelta,
    sourceDomain: "pos",
    sourceId: String(args.sessionId),
    sourceLineId: args.sourceLineId,
    sourceType: "expense_session",
    storeId: args.storeId,
    valuation: { kind: "availability_only" },
  });
  return true;
}

async function acquireExpenseQuantityEffectHold(
  ctx: MutationCtx,
  args: ExpenseInventoryHoldEffectArgs,
): Promise<ExpenseInventoryHoldGatewayResult> {
  const sku = await ctx.db.get("productSku", args.skuId);
  if (!sku || typeof sku.quantityAvailable !== "number") {
    return { success: false, message: "Product not found" };
  }
  if (sku.quantityAvailable < args.quantity) {
    return {
      success: true,
      holdApplied: false,
      available: sku.quantityAvailable,
      message: `Only ${sku.quantityAvailable} unit${sku.quantityAvailable !== 1 ? "s" : ""} available`,
    };
  }
  const applied = await applyExpenseAvailabilityEffect(ctx, {
    ...args,
    activityType: "reservation_acquired",
    sellableQuantityDelta: -args.quantity,
  });
  if (!applied) return { success: false, message: "Product not found" };
  return { success: true, holdApplied: true };
}

async function releaseExpenseQuantityEffectHold(
  ctx: MutationCtx,
  args: ExpenseInventoryHoldEffectArgs,
): Promise<ExpenseInventoryHoldGatewayResult> {
  const applied = await applyExpenseAvailabilityEffect(ctx, {
    ...args,
    activityType: "reservation_released",
    sellableQuantityDelta: args.quantity,
  });
  return applied
    ? { success: true, holdApplied: true }
    : { success: true, holdApplied: false };
}

async function adjustExpenseQuantityEffectHold(
  ctx: MutationCtx,
  args: ExpenseInventoryHoldEffectArgs & { oldQuantity: number },
): Promise<ExpenseInventoryHoldGatewayResult> {
  const quantityChange = args.quantity - args.oldQuantity;
  if (quantityChange === 0) {
    return { success: true, holdApplied: true };
  }

  if (quantityChange > 0) {
    return acquireExpenseQuantityEffectHold(ctx, {
      ...args,
      quantity: quantityChange,
    });
  }

  return releaseExpenseQuantityEffectHold(ctx, {
    ...args,
    quantity: Math.abs(quantityChange),
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

function isSessionExpired(
  session: Pick<Doc<"expenseSession">, "expiresAt" | "status">,
) {
  return session.status === "expired";
}

function validateActiveSession(
  session: Doc<"expenseSession"> | null,
  staffProfileId: Id<"staffProfile">,
): ExpenseSessionCommandOutcome<Doc<"expenseSession">> {
  if (!session) {
    return failure("sessionExpired", "Session not found.");
  }

  if (session.staffProfileId !== staffProfileId) {
    return failure(
      "cashierMismatch",
      "This session is not associated with your staff profile.",
    );
  }

  if (isSessionExpired(session)) {
    return failure(
      "sessionExpired",
      "This session is no longer active. Start a new one to proceed.",
    );
  }

  if (session.status !== "active") {
    const statusMessages: Record<string, string> = {
      completed:
        "This session has been completed and cannot be modified. Start a new one to proceed",
      void: "This session has been voided and cannot be modified. Start a new one to proceed",
      held: "Can only add items to active sessions. Please resume or create a new session",
      expired: "This session is no longer active. Start a new one to proceed",
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

  if (isSessionExpired(session)) {
    return failure(
      "sessionExpired",
      "This session is no longer active. Start a new one to proceed.",
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
