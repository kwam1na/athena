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
import {
  hasSettledRegisterCloseout,
  type PosLocalRegisterReadModel,
} from "./registerReadModel";
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
  PosRegisterCatalogRevision,
} from "@/lib/pos/application/posLocalStoreTypes";
import type { PosRegisterCatalogRowDto } from "@/lib/pos/application/dto";

type PosLocalCommandStore = {
  appendEvent(
    input: PosLocalAppendEventInput,
  ): Promise<PosLocalStoreResult<PosLocalEventRecord>>;
  listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>>;
  listLocalCloudMappings?(): Promise<
    PosLocalStoreResult<PosLocalCloudMapping[]>
  >;
  writeLocalCloudMapping?(
    mapping: PosLocalCloudMapping,
  ): Promise<PosLocalStoreResult<PosLocalCloudMapping>>;
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
  allowRegisterSessionSeedAfterSettledHistory?: boolean;
  allowRegisterSessionSeedFromRuntimeDirective?: boolean;
  authorityPersistenceFailed?: boolean | (() => boolean);
  store: PosLocalCommandStore;
  clock?: () => number;
  createLocalId?: (kind: string) => string;
  captureRegisterCatalogPin?: (scope: {
    storeId: string;
    terminalId: string;
  }) => CapturedRegisterCatalogPin | null | undefined;
  onEventAppended?: () => void;
  staffProofToken?: string | ((staffProfileId: string) => string | undefined);
};

type CapturedRegisterCatalogPin = {
  ownerId?: string;
  revision: PosRegisterCatalogRevision;
  rows: PosRegisterCatalogRowDto[];
  settleActionGuard?: () => void;
};

type RegisterSessionSeedDecision = "append" | "already_seeded" | "blocked";

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

export type LocalStartStoreDayResult = CommandResult<{
  localEventId: string;
  operatingDate: string;
  status: "started";
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
  startStoreDay(
    input: LocalStartStoreDayInput,
  ): Promise<LocalStartStoreDayResult>;
  startCloseout(
    input: StartLocalCloseoutInput,
  ): Promise<LocalStartCloseoutResult>;
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

  function captureCatalogPin(input: { storeId: string; terminalId: string }) {
    return options.captureRegisterCatalogPin?.({
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
  }

  function settleCatalogPinGuard(catalogPin?: CapturedRegisterCatalogPin | null) {
    catalogPin?.settleActionGuard?.();
  }

  async function append(
    input: PosLocalAppendEventInput,
    catalogPin?: CapturedRegisterCatalogPin | null,
  ) {
    try {
      const result = await options.store.appendEvent({
        ...input,
        ...(catalogPin
          ? {
              catalogPin: {
                ...(catalogPin.ownerId ? { ownerId: catalogPin.ownerId } : {}),
                revision: catalogPin.revision,
                rows: catalogPin.rows,
              },
            }
          : {}),
      });
      if (!result.ok) return toLocalUserError(result.error.message);
      options.onEventAppended?.();
      return null;
    } finally {
      settleCatalogPinGuard(catalogPin);
    }
  }

  async function appendBoolean(
    input: PosLocalAppendEventInput,
    catalogPin?: CapturedRegisterCatalogPin | null,
  ) {
    return !(await append(input, catalogPin));
  }

  async function appendNewDrawer(
    input: LocalOpenDrawerInput,
    catalogPin?: CapturedRegisterCatalogPin | null,
  ) {
    const localRegisterSessionId = createLocalId("local-register-session");
    const openedAt = clock();
    const appendError = await append(
      {
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
      },
      catalogPin,
    );
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

  async function resolveRegisterSessionSeedDecision(
    input: SeedLocalRegisterSessionInput,
  ): Promise<RegisterSessionSeedDecision> {
    if (!hasCommandIdentity(input)) return "blocked";
    const model = await readModel({
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
    if (!model.ok) return "blocked";
    if (model.value.canSell) {
      return model.value.activeRegisterSession?.localRegisterSessionId ===
        input.localRegisterSessionId
        ? "already_seeded"
        : "blocked";
    }
    const hasSettledCloseoutSession =
      model.value.activeRegisterSession?.status === "closing" &&
      hasSettledRegisterCloseout({
        events: model.value.sourceEvents,
        session: model.value.activeRegisterSession,
      });
    const canSeedAfterSettledHistory =
      options.allowRegisterSessionSeedAfterSettledHistory &&
      (!model.value.activeRegisterSession || hasSettledCloseoutSession);
    const canSeedFromRuntimeDirective =
      options.allowRegisterSessionSeedFromRuntimeDirective &&
      input.runtimeDirectiveRepair === true &&
      model.value.saleBlockReason !== "terminal_integrity";
    const canSeedAfterExistingHistory =
      canSeedAfterSettledHistory || canSeedFromRuntimeDirective;
    if (model.value.saleBlockReason && !canSeedAfterExistingHistory) {
      return "blocked";
    }
    if (
      !options.allowExplicitRegisterSessionWithoutProjection ||
      (model.eventCount > 0 && !canSeedAfterExistingHistory)
    ) {
      return "blocked";
    }

    const drawerAuthority = await readDrawerAuthorityBlock({
      localRegisterSessionId: input.localRegisterSessionId,
      storeId: input.storeId,
      terminalId: input.terminalId,
    });
    return drawerAuthority.ok && !drawerAuthority.blocked
      ? "append"
      : "blocked";
  }

  async function appendWithResult(
    input: PosLocalAppendEventInput,
    catalogPin?: CapturedRegisterCatalogPin | null,
  ) {
    const result = await options.store.appendEvent({
      ...input,
      ...(catalogPin ? { catalogPin } : {}),
    });
    if (!result.ok) return toLocalUserError(result.error.message);
    options.onEventAppended?.();
    return ok({ event: result.value });
  }

  async function writeSeedRegisterSessionMapping(
    input: SeedLocalRegisterSessionInput,
  ) {
    if (
      !input.cloudRegisterSessionId ||
      !options.store.writeLocalCloudMapping
    ) {
      return true;
    }

    const result = await options.store.writeLocalCloudMapping({
      entity: "registerSession",
      localId: input.localRegisterSessionId,
      cloudId: input.cloudRegisterSessionId,
      mappedAt: clock(),
    });
    return result.ok;
  }

  function isAuthorityPersistenceFailed() {
    return typeof options.authorityPersistenceFailed === "function"
      ? options.authorityPersistenceFailed()
      : options.authorityPersistenceFailed === true;
  }

  function authorityPersistenceUserError() {
    return toLocalUserError(
      "Drawer status could not be saved locally. Retry before continuing.",
    );
  }

  return {
    async appendCartItem(input: AppendLocalCartItemInput) {
      const catalogPin = captureCatalogPin(input);
      if (isAuthorityPersistenceFailed()) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      if (!(await canAppendSaleAffectingEvent(input))) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      return appendBoolean(
        {
          type: "cart.item_added",
          terminalId: input.terminalId,
          storeId: input.storeId,
          registerNumber: input.registerNumber,
          localRegisterSessionId: input.localRegisterSessionId,
          localPosSessionId: input.localPosSessionId,
          staffProfileId: input.staffProfileId,
          validationMetadata: input.validationMetadata,
          payload: input.payload,
        },
        catalogPin,
      );
    },

    async definePendingCheckoutItem(
      input: DefineLocalPendingCheckoutItemInput,
    ) {
      const catalogPin = captureCatalogPin(input);
      if (isAuthorityPersistenceFailed()) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      if (!(await canAppendSaleAffectingEvent(input))) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      return appendBoolean(
        {
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
        },
        catalogPin,
      );
    },

    async appendServiceLine(input: AppendLocalServiceLineInput) {
      const catalogPin = captureCatalogPin(input);
      if (isAuthorityPersistenceFailed()) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      if (!(await canAppendSaleAffectingEvent(input))) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      return appendBoolean(
        {
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
        },
        catalogPin,
      );
    },

    async appendPaymentState(input: AppendLocalPaymentStateInput) {
      const catalogPin = captureCatalogPin(input);
      if (isAuthorityPersistenceFailed()) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      if (!(await canAppendSaleAffectingEvent(input))) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      return appendBoolean(
        {
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
            payments: input.payments.map(
              ({ id, method, amount, timestamp }) => ({
                localPaymentId: id,
                method,
                amount,
                timestamp,
              }),
            ),
            stage: input.stage,
            paymentMethod: input.paymentMethod,
            amount: input.amount,
            previousAmount: input.previousAmount,
          },
        },
        catalogPin,
      );
    },

    async clearCart(input: ClearLocalCartInput) {
      const catalogPin = captureCatalogPin(input);
      const model = await readModel({
        storeId: input.storeId,
        terminalId: input.terminalId,
      });
      if (!model.ok) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      const hasPriorSaleActivity = hasLocalSaleActivity(
        model.value.sourceEvents,
        input,
      );
      if (
        hasPriorSaleActivity &&
        !(await canAppendSaleAffectingEvent(input)) &&
        !canClearExactCloudClosedDrawer(model.value, input)
      ) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }

      return appendBoolean(
        {
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
        },
        catalogPin,
      );
    },

    async completeTransaction(input: CompleteLocalTransactionInput) {
      const catalogPin = captureCatalogPin(input);
      if (isAuthorityPersistenceFailed()) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      if (!(await canAppendSaleAffectingEvent(input))) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      return appendBoolean(
        {
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
        },
        catalogPin,
      );
    },

    async openDrawer(
      input: LocalOpenDrawerInput,
    ): Promise<LocalOpenDrawerResult> {
      const catalogPin = captureCatalogPin({
        storeId: input.storeId.toString(),
        terminalId: input.terminalId.toString(),
      });
      try {
        if (isAuthorityPersistenceFailed()) {
          return authorityPersistenceUserError();
        }
      if (
        !hasCommandIdentity({ ...input, localRegisterSessionId: "pending" })
      ) {
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
      if (existingModel.value.saleBlockReason && !canOpenReplacementDrawer) {
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
          return await appendNewDrawer(input, catalogPin);
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

        return await appendNewDrawer(input, catalogPin);
      } finally {
        settleCatalogPinGuard(catalogPin);
      }
    },

    async reopenRegister(input: ReopenLocalRegisterInput) {
      const catalogPin = captureCatalogPin(input);
      if (isAuthorityPersistenceFailed()) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      if (!(await canAppendRegisterReopen(input))) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      return appendBoolean(
        {
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
        },
        catalogPin,
      );
    },

    async seedRegisterSession(input: SeedLocalRegisterSessionInput) {
      const catalogPin = captureCatalogPin(input);
      if (isAuthorityPersistenceFailed()) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      const seedDecision = await resolveRegisterSessionSeedDecision(input);
      if (seedDecision === "blocked") {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      if (seedDecision === "already_seeded") {
        const result = await writeSeedRegisterSessionMapping(input);
        settleCatalogPinGuard(catalogPin);
        return result;
      }
      if (!(await writeSeedRegisterSessionMapping(input))) {
        settleCatalogPinGuard(catalogPin);
        return false;
      }
      return appendBoolean(
        {
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
          initialSyncStatus: "synced",
          payload: {
            localRegisterSessionId: input.localRegisterSessionId,
            openingFloat: input.openingFloat,
            expectedCash: input.expectedCash,
            notes: input.notes ?? null,
            status: input.status,
          },
        },
        catalogPin,
      );
    },

    async startSession(
      input: LocalStartSessionInput,
    ): Promise<LocalStartSessionResult> {
      const catalogPin = captureCatalogPin({
        storeId: input.storeId.toString(),
        terminalId: input.terminalId.toString(),
      });
      try {
        if (isAuthorityPersistenceFailed()) {
          return authorityPersistenceUserError();
        }
      if (
        !hasCommandIdentity({ ...input, localRegisterSessionId: "pending" })
      ) {
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
      const appendError = await append(
        {
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
        },
        catalogPin,
      );
      if (appendError) return appendError;

        return ok({
          localPosSessionId,
          expiresAt,
        });
      } finally {
        settleCatalogPinGuard(catalogPin);
      }
    },

    async startStoreDay(input: LocalStartStoreDayInput) {
      if (
        !input.activeRoles.some(
          (role) => role === "cashier" || role === "manager",
        )
      ) {
        return userError({
          code: "authorization_failed",
          message:
            "Cashier or manager access is required to start the store day.",
        });
      }
      const result = await appendWithResult({
        type: "store_day.started",
        terminalId: input.terminalId,
        storeId: input.storeId,
        // Store-day start is durable before a drawer exists. The sync pipeline
        // still uses this legacy field as its cursor identity, so keep the
        // store-day stream separate from every register-session stream.
        localRegisterSessionId: `store-day:${input.operatingDate}`,
        staffProfileId: input.staffProfileId,
        staffProofToken: resolveStaffProofToken(
          options.staffProofToken,
          input.staffProfileId,
        ),
        validationMetadata: input.validationMetadata,
        payload: {
          endAt: input.endAt,
          operatingDate: input.operatingDate,
          startAt: input.startAt,
        },
      });
      return result.kind === "ok"
        ? ok({
            localEventId: result.data.event.localEventId,
            operatingDate: input.operatingDate,
            status: "started" as const,
          })
        : result;
    },

    async startCloseout(input: StartLocalCloseoutInput) {
      const catalogPin = captureCatalogPin(input);
      try {
        if (isAuthorityPersistenceFailed()) {
          return authorityPersistenceUserError();
        }
        if (!(await canAppendSaleAffectingEvent(input))) {
          return toLocalUserError(
            "Drawer setup needs repair before closeout can continue.",
          );
        }
        return await appendWithResult(
          {
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
        },
          catalogPin,
        ).then((result) =>
          result.kind === "ok"
            ? ok({
                localEventId: result.data.event.localEventId,
              })
            : result,
        );
      } finally {
        settleCatalogPinGuard(catalogPin);
      }
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

function canClearExactCloudClosedDrawer(
  model: PosLocalRegisterReadModel,
  input: ClearLocalCartInput,
) {
  return (
    hasCommandIdentity(input) &&
    model.drawerAuthorityReason === "cloud_closed" &&
    model.activeRegisterSession?.localRegisterSessionId ===
      input.localRegisterSessionId &&
    model.activeSale?.localPosSessionId === input.localPosSessionId &&
    model.activeSale.localRegisterSessionId === input.localRegisterSessionId
  );
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
    "paymentAdded" | "paymentUpdated" | "paymentRemoved" | "paymentsCleared";
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
  cloudRegisterSessionId?: string;
  expectedCash: number;
  notes?: string | null;
  openingFloat: number;
  runtimeDirectiveRepair?: boolean;
  status: string;
};

type StartLocalCloseoutInput = LocalCommandContext & {
  countedCash: number;
  notes?: string | null;
};

type LocalStartStoreDayInput = {
  activeRoles: string[];
  endAt: number;
  operatingDate: string;
  staffProfileId: string;
  startAt: number;
  storeId: string;
  terminalId: string;
  validationMetadata?: PosLocalEventValidationMetadata;
};
