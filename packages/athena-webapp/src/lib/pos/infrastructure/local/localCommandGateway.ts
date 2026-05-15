import type {
  PosPaymentDto,
  PosOpenDrawerInput,
} from "@/lib/pos/application/dto";
import { ok, userError, type CommandResult } from "~/shared/commandResult";

import { readProjectedLocalRegisterModel } from "./localRegisterReader";
import type {
  PosLocalAppendEventInput,
  PosLocalEventRecord,
  PosLocalStoreResult,
  PosProvisionedTerminalSeed,
} from "./posLocalStore";

type PosLocalCommandStore = {
  appendEvent(
    input: PosLocalAppendEventInput,
  ): Promise<PosLocalStoreResult<PosLocalEventRecord>>;
  listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  readProvisionedTerminalSeed?(): Promise<
    PosLocalStoreResult<PosProvisionedTerminalSeed | null>
  >;
};

type CreateLocalCommandGatewayOptions = {
  allowExplicitRegisterSessionWithoutProjection?: boolean;
  store: PosLocalCommandStore;
  clock?: () => number;
  createLocalId?: (kind: string) => string;
  onEventAppended?: () => void;
  staffProofToken?: string | ((staffProfileId: string) => string | undefined);
};

export type LocalOpenDrawerResult = CommandResult<{
  localRegisterSessionId: string;
  status: "open";
  terminalId: string;
  registerNumber?: string;
  openingFloat: number;
  expectedCash: number;
  openedAt: number;
  notes?: string;
}>;

export type LocalStartSessionResult = CommandResult<{
  localPosSessionId: string;
  expiresAt: number;
}>;

export function createLocalCommandGateway(
  options: CreateLocalCommandGatewayOptions,
): {
  appendCartItem(input: AppendLocalCartItemInput): Promise<boolean>;
  appendPaymentState(input: AppendLocalPaymentStateInput): Promise<boolean>;
  clearCart(input: ClearLocalCartInput): Promise<boolean>;
  completeTransaction(input: CompleteLocalTransactionInput): Promise<boolean>;
  openDrawer(input: PosOpenDrawerInput): Promise<LocalOpenDrawerResult>;
  reopenRegister(input: ReopenLocalRegisterInput): Promise<boolean>;
  seedRegisterSession(input: SeedLocalRegisterSessionInput): Promise<boolean>;
  startSession(input: LocalStartSessionInput): Promise<LocalStartSessionResult>;
  startCloseout(input: StartLocalCloseoutInput): Promise<boolean>;
} {
  const clock = options.clock ?? Date.now;
  const createLocalId =
    options.createLocalId ??
    ((kind: string) =>
      `${kind}-${clock()}-${Math.random().toString(36).slice(2)}`);

  async function readModel(scope?: { storeId?: string; terminalId?: string }) {
    const model = await readProjectedLocalRegisterModel({
      store: options.store,
      storeId: scope?.storeId,
      terminalId: scope?.terminalId,
      isOnline: false,
    });
    if (!model.ok) return model;

    return {
      ok: true as const,
      eventCount: model.value.sourceEvents.length,
      value: model.value,
    };
  }

  async function append(input: PosLocalAppendEventInput) {
    const result = await options.store.appendEvent(input);
    if (!result.ok) return toLocalUserError(result.error.message);
    options.onEventAppended?.();
    return null;
  }

  async function appendBoolean(input: PosLocalAppendEventInput) {
    return !(await append(input));
  }

  return {
    appendCartItem(input: AppendLocalCartItemInput) {
      return appendBoolean({
        type: "cart.item_added",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        staffProfileId: input.staffProfileId,
        payload: input.payload,
      });
    },

    appendPaymentState(input: AppendLocalPaymentStateInput) {
      return appendBoolean({
        type: "session.payments_updated",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        staffProfileId: input.staffProfileId,
        payload: {
          localPosSessionId: input.localPosSessionId,
          checkoutStateVersion: input.checkoutStateVersion,
          payments: input.payments.map(({ id, method, amount, timestamp }) => ({
            localPaymentId: id,
            method,
            amount,
            timestamp,
          })),
          stage: input.stage,
          paymentMethod: input.paymentMethod,
          amount: input.amount,
          previousAmount: input.previousAmount,
        },
      });
    },

    clearCart(input: ClearLocalCartInput) {
      return appendBoolean({
        type: "cart.cleared",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        staffProfileId: input.staffProfileId,
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId,
        ),
        payload: {
          localPosSessionId: input.localPosSessionId,
          reason: input.reason ?? null,
        },
      });
    },

    completeTransaction(input: CompleteLocalTransactionInput) {
      return appendBoolean({
        type: "transaction.completed",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        localTransactionId: input.localTransactionId,
        staffProfileId: input.staffProfileId,
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId,
        ),
        payload: input.payload,
      });
    },

    async openDrawer(
      input: PosOpenDrawerInput,
    ): Promise<LocalOpenDrawerResult> {
      const localRegisterSessionId = createLocalId("local-register-session");
      const openedAt = clock();
      const appendError = await append({
        type: "register.opened",
        terminalId: input.terminalId.toString(),
        storeId: input.storeId.toString(),
        registerNumber: input.registerNumber,
        localRegisterSessionId,
        staffProfileId: input.staffProfileId.toString(),
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId.toString(),
        ),
        payload: {
          localRegisterSessionId,
          openingFloat: input.openingFloat,
          expectedCash: input.openingFloat,
          notes: input.notes ?? null,
          status: "open",
        },
      });
      if (appendError) return appendError;

      return ok({
        localRegisterSessionId,
        status: "open",
        terminalId: input.terminalId.toString(),
        registerNumber: input.registerNumber,
        openingFloat: input.openingFloat,
        expectedCash: input.openingFloat,
        openedAt,
        notes: input.notes,
      });
    },

    reopenRegister(input: ReopenLocalRegisterInput) {
      return appendBoolean({
        type: "register.reopened",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        staffProfileId: input.staffProfileId,
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId,
        ),
        payload: {
          reason: input.reason,
        },
      });
    },

    seedRegisterSession(input: SeedLocalRegisterSessionInput) {
      return appendBoolean({
        type: "register.opened",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        staffProfileId: input.staffProfileId,
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId,
        ),
        payload: {
          localRegisterSessionId: input.localRegisterSessionId,
          openingFloat: input.openingFloat,
          expectedCash: input.expectedCash,
          notes: input.notes ?? null,
          status: input.status,
        },
      });
    },

    async startSession(
      input: LocalStartSessionInput,
    ): Promise<LocalStartSessionResult> {
      const model = await readModel({
        storeId: input.storeId.toString(),
        terminalId: input.terminalId.toString(),
      });
      if (!model.ok) return toLocalUserError(model.error.message);
      const explicitRegisterSessionId = input.localRegisterSessionId;
      const activeRegisterSession = model.value.activeRegisterSession;
      const registerSessionCanSell =
        model.value.canSell &&
        activeRegisterSession &&
        (!explicitRegisterSessionId ||
          activeRegisterSession.localRegisterSessionId ===
            explicitRegisterSessionId);
      const explicitlyTrustedBeforeProjection =
        options.allowExplicitRegisterSessionWithoutProjection &&
        explicitRegisterSessionId &&
        model.eventCount === 0;
      if (!registerSessionCanSell && !explicitlyTrustedBeforeProjection) {
        return toLocalUserError("Open the drawer before starting a sale.");
      }

      const expiresAt = clock() + SESSION_TTL_MS;
      const localRegisterSessionId =
        explicitRegisterSessionId ??
        activeRegisterSession?.localRegisterSessionId;
      if (!localRegisterSessionId) {
        return toLocalUserError("Open the drawer before starting a sale.");
      }
      if (
        model.value.activeSale?.localRegisterSessionId ===
        localRegisterSessionId
      ) {
        return ok({
          localPosSessionId: model.value.activeSale.localPosSessionId,
          expiresAt,
        });
      }

      const localPosSessionId =
        input.localPosSessionId ?? createLocalId("local-pos-session");
      const appendError = await append({
        type: "session.started",
        terminalId: input.terminalId.toString(),
        storeId: input.storeId.toString(),
        registerNumber: input.registerNumber,
        localRegisterSessionId,
        localPosSessionId,
        staffProfileId: input.staffProfileId?.toString(),
        payload: {
          localPosSessionId,
          localRegisterSessionId,
          status: "active",
        },
      });
      if (appendError) return appendError;

      return ok({
        localPosSessionId,
        expiresAt,
      });
    },

    startCloseout(input: StartLocalCloseoutInput) {
      return appendBoolean({
        type: "register.closeout_started",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        staffProfileId: input.staffProfileId,
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId,
        ),
        payload: {
          countedCash: input.countedCash,
          notes: input.notes ?? null,
        },
      });
    },

  };
}

const SESSION_TTL_MS = 12 * 60 * 60 * 1_000;

function resolveStaffProofToken(
  staffProofToken: CreateLocalCommandGatewayOptions["staffProofToken"],
  staffProfileId: string,
) {
  return typeof staffProofToken === "function"
    ? staffProofToken(staffProfileId)
    : staffProofToken;
}

function toLocalUserError(message: string) {
  return userError({
    code: "unavailable",
    message,
    retryable: true,
  });
}

type LocalCommandContext = {
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId: string;
  staffProfileId: string;
};

type LocalStartSessionInput = {
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  staffProfileId?: string;
  localPosSessionId?: string;
};

type LocalSaleCommandContext = LocalCommandContext & {
  localPosSessionId: string;
};

type AppendLocalCartItemInput = LocalSaleCommandContext & {
  payload: unknown;
};

type AppendLocalPaymentStateInput = LocalSaleCommandContext & {
  amount?: number;
  checkoutStateVersion: number;
  paymentMethod?: PosPaymentDto["method"];
  payments: PosPaymentDto[];
  previousAmount?: number;
  stage:
    | "paymentAdded"
    | "paymentUpdated"
    | "paymentRemoved"
    | "paymentsCleared";
};

type ClearLocalCartInput = LocalSaleCommandContext & {
  reason?: string | null;
};

type CompleteLocalTransactionInput = LocalSaleCommandContext & {
  localTransactionId: string;
  payload: unknown;
};

type ReopenLocalRegisterInput = LocalCommandContext & {
  reason: string;
};

type SeedLocalRegisterSessionInput = LocalCommandContext & {
  expectedCash: number;
  notes?: string | null;
  openingFloat: number;
  status: string;
};

type StartLocalCloseoutInput = LocalCommandContext & {
  countedCash: number;
  notes?: string | null;
};
