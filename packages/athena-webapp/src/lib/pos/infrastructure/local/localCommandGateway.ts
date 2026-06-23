import type {
  PosPaymentDto,
  PosOpenDrawerInput,
} from "@/lib/pos/application/dto";
import { ok, userError, type CommandResult } from "~/shared/commandResult";
import {
  canOpenReplacementDrawerForLocalBlock,
  isDrawerAuthoritySaleBlocking,
} from "~/shared/registerSessionLifecyclePolicy";
import type { PosLocalSyncPendingCheckoutItemDefinedPayload } from "~/shared/posLocalSyncContract";

import { readProjectedLocalRegisterModel } from "./localRegisterReader";
import { hasSettledRegisterCloseout } from "./registerReadModel";
import { deriveLocalSaleBlocker } from "./saleBlockerPolicy";
import type {
  PosLocalAppendEventInput,
  PosDrawerAuthorityState,
  PosLocalEventRecord,
  PosLocalCloudMapping,
  PosLocalEventValidationMetadata,
  PosLocalStoreResult,
  PosTerminalIntegrityState,
  PosProvisionedTerminalSeed,
} from "./posLocalStore";

type PosLocalCommandStore = {
  appendEvent(
    input: PosLocalAppendEventInput,
  ): Promise<PosLocalStoreResult<PosLocalEventRecord>>;
  listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  listLocalCloudMappings?(): Promise<PosLocalStoreResult<PosLocalCloudMapping[]>>;
  readDrawerAuthorityState?(input: {
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>>;
  readProvisionedTerminalSeed?(): Promise<
    PosLocalStoreResult<PosProvisionedTerminalSeed | null>
  >;
  readTerminalIntegrityState?(input: {
    storeId: string;
    terminalId: string;
  }): Promise<PosLocalStoreResult<PosTerminalIntegrityState | null>>;
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

export type LocalStartCloseoutResult = CommandResult<{
  localEventId: string;
}>;

export function createLocalCommandGateway(
  options: CreateLocalCommandGatewayOptions,
): {
  appendCartItem(input: AppendLocalCartItemInput): Promise<boolean>;
  appendPaymentState(input: AppendLocalPaymentStateInput): Promise<boolean>;
  appendServiceLine(input: AppendLocalServiceLineInput): Promise<boolean>;
  clearCart(input: ClearLocalCartInput): Promise<boolean>;
  completeTransaction(input: CompleteLocalTransactionInput): Promise<boolean>;
  definePendingCheckoutItem(
    input: DefineLocalPendingCheckoutItemInput,
  ): Promise<boolean>;
  openDrawer(input: LocalOpenDrawerInput): Promise<LocalOpenDrawerResult>;
  reopenRegister(input: ReopenLocalRegisterInput): Promise<boolean>;
  seedRegisterSession(input: SeedLocalRegisterSessionInput): Promise<boolean>;
  startSession(input: LocalStartSessionInput): Promise<LocalStartSessionResult>;
  startCloseout(input: StartLocalCloseoutInput): Promise<LocalStartCloseoutResult>;
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

  async function appendNewDrawer(input: LocalOpenDrawerInput) {
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
      validationMetadata: input.validationMetadata,
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
      status: "open" as const,
      terminalId: input.terminalId.toString(),
      registerNumber: input.registerNumber,
      openingFloat: input.openingFloat,
      expectedCash: input.openingFloat,
      openedAt,
      notes: input.notes,
    });
  }

  async function readDrawerAuthorityBlock(input: {
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  }) {
    const drawerAuthority = options.store.readDrawerAuthorityState
      ? await options.store.readDrawerAuthorityState(input)
      : ({ ok: true, value: null } as const);
    if (!drawerAuthority.ok) return { ok: false as const };

    return {
      ok: true as const,
      blocked: isDrawerAuthoritySaleBlocking({
        activeRegisterSession: {
          localRegisterSessionId: input.localRegisterSessionId,
        },
        drawerAuthority: drawerAuthority.value,
      }),
    };
  }

  async function canAppendSaleAffectingEvent(input: {
    localRegisterSessionId?: string;
    staffProfileId?: string;
    storeId: string;
    terminalId: string;
  }) {
    if (!hasCommandIdentity(input)) return false;
    const model = await readModel(input);
    if (!model.ok) return false;
    if (model.value.canSell) {
      return (
        Boolean(input.localRegisterSessionId) &&
        model.value.activeRegisterSession?.localRegisterSessionId ===
          input.localRegisterSessionId
      );
    }
    if (model.value.saleBlockReason || model.value.activeRegisterSession) {
      return false;
    }
    if (!input.localRegisterSessionId) return false;

    const drawerAuthority = await readDrawerAuthorityBlock({
      localRegisterSessionId: input.localRegisterSessionId,
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
    return drawerAuthority.ok && !drawerAuthority.blocked;
  }

  async function canAppendRegisterReopen(input: ReopenLocalRegisterInput) {
    if (!hasCommandIdentity(input)) return false;
    const model = await readModel({
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
    if (!model.ok) return false;
    if (!model.value.activeRegisterSession) {
      if (
        !options.allowExplicitRegisterSessionWithoutProjection ||
        model.eventCount > 0
      ) {
        return false;
      }
      const drawerAuthority = await readDrawerAuthorityBlock({
        localRegisterSessionId: input.localRegisterSessionId,
        storeId: input.storeId,
        terminalId: input.terminalId,
      });
      return drawerAuthority.ok && !drawerAuthority.blocked;
    }

    const drawerAuthority = await readDrawerAuthorityBlock({
      localRegisterSessionId: input.localRegisterSessionId,
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
    if (!drawerAuthority.ok || drawerAuthority.blocked) return false;

    const blocker = deriveLocalSaleBlocker({
      activeRegisterSession: {
        canReopen:
          model.value.activeRegisterSession.localRegisterSessionId ===
          input.localRegisterSessionId,
        localRegisterSessionId:
          model.value.activeRegisterSession.localRegisterSessionId,
        status: model.value.activeRegisterSession.status,
      },
      hasLocalEventDestination: true,
      hasRequiredIdentities: true,
      terminalIntegrity:
        model.value.saleBlockReason === "terminal_integrity"
          ? { status: "requires_reprovision" }
          : { status: "healthy" },
    });
    return !blocker;
  }

  async function canSeedRegisterSession(input: SeedLocalRegisterSessionInput) {
    if (!hasCommandIdentity(input)) return false;
    const model = await readModel({
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
    if (!model.ok) return false;
    if (model.value.canSell) return true;
    if (model.value.saleBlockReason) return false;
    if (
      !options.allowExplicitRegisterSessionWithoutProjection ||
      model.eventCount > 0
    ) {
      return false;
    }

    const drawerAuthority = await readDrawerAuthorityBlock({
      localRegisterSessionId: input.localRegisterSessionId,
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
    return drawerAuthority.ok && !drawerAuthority.blocked;
  }

  async function appendWithResult(input: PosLocalAppendEventInput) {
    const result = await options.store.appendEvent(input);
    if (!result.ok) return toLocalUserError(result.error.message);
    options.onEventAppended?.();
    return ok({ event: result.value });
  }

  return {
    async appendCartItem(input: AppendLocalCartItemInput) {
      if (!(await canAppendSaleAffectingEvent(input))) return false;
      return appendBoolean({
        type: "cart.item_added",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        staffProfileId: input.staffProfileId,
        validationMetadata: input.validationMetadata,
        payload: input.payload,
      });
    },

    async definePendingCheckoutItem(input: DefineLocalPendingCheckoutItemInput) {
      if (!(await canAppendSaleAffectingEvent(input))) return false;
      return appendBoolean({
        type: "pending_checkout_item.defined",
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
        validationMetadata: input.validationMetadata,
        payload: input.payload,
      });
    },

    async appendServiceLine(input: AppendLocalServiceLineInput) {
      if (!(await canAppendSaleAffectingEvent(input))) return false;
      return appendBoolean({
        type: "cart.service_added",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        staffProfileId: input.staffProfileId,
        validationMetadata: input.validationMetadata,
        payload: {
          localPosSessionId: input.localPosSessionId,
          ...input.payload,
        },
      });
    },

    async appendPaymentState(input: AppendLocalPaymentStateInput) {
      if (!(await canAppendSaleAffectingEvent(input))) return false;
      return appendBoolean({
        type: "session.payments_updated",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        staffProfileId: input.staffProfileId,
        validationMetadata: input.validationMetadata,
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

    async clearCart(input: ClearLocalCartInput) {
      const model = await readModel({
        storeId: input.storeId,
        terminalId: input.terminalId,
      });
      if (!model.ok) return false;
      const hasPriorSaleActivity = hasLocalSaleActivity(
        model.value.sourceEvents,
        input,
      );
      if (
        hasPriorSaleActivity &&
        !(await canAppendSaleAffectingEvent(input))
      ) {
        return false;
      }

      return appendBoolean({
        type: "cart.cleared",
        terminalId: input.terminalId,
        storeId: input.storeId,
        registerNumber: input.registerNumber,
        localRegisterSessionId: input.localRegisterSessionId,
        localPosSessionId: input.localPosSessionId,
        staffProfileId: input.staffProfileId,
        validationMetadata: input.validationMetadata,
        ...(hasPriorSaleActivity
          ? {
              staffProofToken: resolveStaffProofToken(
                options.staffProofToken,
                input.staffProfileId,
              ),
            }
          : { initialSyncStatus: "synced" as const }),
        payload: {
          localPosSessionId: input.localPosSessionId,
          reason: input.reason ?? null,
        },
      });
    },

    async completeTransaction(input: CompleteLocalTransactionInput) {
      if (!(await canAppendSaleAffectingEvent(input))) return false;
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
        validationMetadata: input.validationMetadata,
        payload: input.payload,
      });
    },

    async openDrawer(
      input: LocalOpenDrawerInput,
    ): Promise<LocalOpenDrawerResult> {
      if (!hasCommandIdentity({ ...input, localRegisterSessionId: "pending" })) {
        return toLocalUserError(
          blockedSaleMessage(
            !input.staffProfileId
              ? "missing_identity"
              : "missing_event_destination",
          ),
        );
      }
      const existingModel = await readModel({
        storeId: input.storeId.toString(),
        terminalId: input.terminalId.toString(),
      });
      if (!existingModel.ok) {
        return toLocalUserError(existingModel.error.message);
      }
      const hasSettledCloseout = hasSettledRegisterCloseout({
        events: existingModel.value.sourceEvents,
        session: existingModel.value.activeRegisterSession,
      });
      const canOpenReplacementDrawer = canOpenReplacementDrawerForLocalBlock({
        activeRegisterSession: existingModel.value.activeRegisterSession,
        drawerAuthorityReason: existingModel.value.drawerAuthorityReason,
        hasSettledCloseout,
        saleBlockReason: existingModel.value.saleBlockReason,
      });
      if (
        existingModel.value.saleBlockReason &&
        !canOpenReplacementDrawer
      ) {
        return toLocalUserError(
          blockedSaleMessage(existingModel.value.saleBlockReason),
        );
      }

      const activeRegisterSession = existingModel.value.activeRegisterSession;
      if (
        activeRegisterSession &&
        isOpenLocalRegisterSessionStatus(activeRegisterSession.status)
      ) {
        if (canOpenReplacementDrawer && !existingModel.value.canSell) {
          return appendNewDrawer(input);
        }
        if (!existingModel.value.canSell) {
          return toLocalUserError(
            blockedSaleMessage(existingModel.value.saleBlockReason),
          );
        }
        if (
          activeRegisterSession.registerNumber &&
          input.registerNumber &&
          activeRegisterSession.registerNumber !== input.registerNumber
        ) {
          return userError({
            code: "conflict",
            message:
              "A local drawer is already open for another register on this terminal.",
          });
        }

        return ok({
          localRegisterSessionId: activeRegisterSession.localRegisterSessionId,
          status: "open",
          terminalId:
            activeRegisterSession.terminalId ?? input.terminalId.toString(),
          registerNumber:
            activeRegisterSession.registerNumber ?? input.registerNumber,
          openingFloat: activeRegisterSession.openingFloat,
          expectedCash: activeRegisterSession.expectedCash,
          openedAt: activeRegisterSession.openedAt,
          notes: activeRegisterSession.notes,
        });
      }

      return appendNewDrawer(input);
    },

    async reopenRegister(input: ReopenLocalRegisterInput) {
      if (!(await canAppendRegisterReopen(input))) return false;
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
        validationMetadata: input.validationMetadata,
        payload: {
          reason: input.reason,
        },
      });
    },

    async seedRegisterSession(input: SeedLocalRegisterSessionInput) {
      if (!(await canSeedRegisterSession(input))) return false;
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
        validationMetadata: input.validationMetadata,
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
      if (!hasCommandIdentity({ ...input, localRegisterSessionId: "pending" })) {
        return toLocalUserError(
          blockedSaleMessage(
            !input.staffProfileId
              ? "missing_identity"
              : "missing_event_destination",
          ),
        );
      }
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
        model.eventCount === 0 &&
        !model.value.saleBlockReason;
      if (explicitlyTrustedBeforeProjection) {
        const drawerAuthority = await readDrawerAuthorityBlock({
          localRegisterSessionId: explicitRegisterSessionId,
          storeId: input.storeId.toString(),
          terminalId: input.terminalId.toString(),
        });
        if (!drawerAuthority.ok || drawerAuthority.blocked) {
          return toLocalUserError(
            "Drawer setup needs repair before selling can continue.",
          );
        }
      }
      if (!registerSessionCanSell && !explicitlyTrustedBeforeProjection) {
        return toLocalUserError(
          blockedSaleMessage(model.value.saleBlockReason) ??
            "Open the drawer before starting a sale.",
        );
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
          localRegisterSessionId &&
        model.value.activeSale.staffProfileId ===
          input.staffProfileId?.toString()
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
        validationMetadata: input.validationMetadata,
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

    async startCloseout(input: StartLocalCloseoutInput) {
      if (!(await canAppendSaleAffectingEvent(input))) {
        return toLocalUserError(
          "Drawer setup needs repair before closeout can continue.",
        );
      }
      return appendWithResult({
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
        validationMetadata: input.validationMetadata,
        payload: {
          countedCash: input.countedCash,
          notes: input.notes ?? null,
        },
      }).then((result) =>
        result.kind === "ok"
          ? ok({
              localEventId: result.data.event.localEventId,
            })
          : result,
      );
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

function hasLocalSaleActivity(
  events: PosLocalEventRecord[],
  input: ClearLocalCartInput,
) {
  return events.some((event) => {
    if (
      event.localRegisterSessionId !== input.localRegisterSessionId ||
      event.localPosSessionId !== input.localPosSessionId
    ) {
      return false;
    }

    return (
      event.type === "cart.item_added" ||
      event.type === "cart.service_added" ||
      event.type === "session.payments_updated" ||
      event.type === "transaction.completed"
    );
  });
}

function isOpenLocalRegisterSessionStatus(status: string) {
  return status === "open" || status === "active";
}

function toLocalUserError(message: string) {
  return userError({
    code: "unavailable",
    message,
    retryable: true,
  });
}

function blockedSaleMessage(reason?: string) {
  if (reason === "terminal_integrity") {
    return "Terminal setup needs repair before selling can continue.";
  }
  if (reason === "drawer_authority") {
    return "Drawer setup needs repair before selling can continue.";
  }
  if (reason === "missing_event_destination") {
    return "Local sale recording is not ready on this terminal.";
  }
  if (reason === "missing_identity") {
    return "Staff sign-in required before selling can continue.";
  }
  if (reason === "drawer_closed") {
    return "Open the drawer before starting a sale.";
  }
  return "Open the drawer before starting a sale.";
}

type LocalCommandContext = {
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId: string;
  staffProfileId: string;
  validationMetadata?: PosLocalEventValidationMetadata;
};

function hasCommandIdentity(input: {
  localRegisterSessionId?: string;
  staffProfileId?: string;
  storeId?: string;
  terminalId?: string;
}) {
  return Boolean(
    input.localRegisterSessionId &&
      input.staffProfileId &&
      input.storeId &&
      input.terminalId,
  );
}

type LocalStartSessionInput = {
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  staffProfileId?: string;
  localPosSessionId?: string;
  validationMetadata?: PosLocalEventValidationMetadata;
};

type LocalOpenDrawerInput = PosOpenDrawerInput & {
  validationMetadata?: PosLocalEventValidationMetadata;
};

type LocalSaleCommandContext = LocalCommandContext & {
  localPosSessionId: string;
};

type AppendLocalCartItemInput = LocalSaleCommandContext & {
  payload: unknown;
};

type DefineLocalPendingCheckoutItemInput = LocalSaleCommandContext & {
  payload: PosLocalSyncPendingCheckoutItemDefinedPayload;
};

type AppendLocalServiceLineInput = LocalSaleCommandContext & {
  payload: Record<string, unknown>;
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
