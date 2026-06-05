import type {
  LocalPinVerifierMetadata,
  WrappedLocalStaffProof,
} from "@/lib/security/localPinVerifier";
import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogRowDto,
  PosServiceCatalogRowDto,
} from "@/lib/pos/application/dto";

export const POS_LOCAL_STORE_SCHEMA_VERSION = 8;

export type PosLocalEntityKind =
  | "registerSession"
  | "posSession"
  | "posTransaction";

export type PosLocalEventType =
  | "terminal.seeded"
  | "register.opened"
  | "session.started"
  | "session.payments_updated"
  | "cart.cleared"
  | "cart.item_added"
  | "cart.service_added"
  | "cart.service_removed"
  | "transaction.completed"
  | "register.closeout_started"
  | "register.reopened"
  | "cash.movement_recorded";

export type PosLocalSyncEventStatus =
  | "pending"
  | "syncing"
  | "synced"
  | "needs_review"
  | "failed";

export type PosLocalEventValidationFlag =
  | "app-session-unverified"
  | "cloud-validation-uncertain";

export type PosLocalEventUploadDeferral =
  | "app-session-validated";

export interface PosLocalEventValidationMetadata {
  flags: PosLocalEventValidationFlag[];
  observedAt?: number;
  uploadDeferredUntil?: PosLocalEventUploadDeferral;
}

export function canUploadPosLocalEventType(type: PosLocalEventType): boolean {
  return (
    type === "register.opened" ||
    type === "transaction.completed" ||
    type === "cart.cleared" ||
    type === "register.closeout_started" ||
    type === "register.reopened"
  );
}

export interface PosProvisionedTerminalSeed {
  terminalId: string;
  cloudTerminalId: string;
  syncSecretHash: string;
  storeId: string;
  orgUrlSlug?: string;
  registerNumber?: string;
  displayName: string;
  provisionedAt: number;
  schemaVersion: number;
  storeUrlSlug?: string;
}

export interface PosLocalEventRecord {
  localEventId: string;
  schemaVersion: number;
  sequence: number;
  uploadSequence?: number;
  type: PosLocalEventType;
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  localPosSessionId?: string;
  localTransactionId?: string;
  staffProfileId?: string;
  staffProofToken?: string;
  validationMetadata?: PosLocalEventValidationMetadata;
  payload: unknown;
  createdAt: number;
  sync: {
    status: PosLocalSyncEventStatus;
    cloudEventId?: string;
    error?: string;
    uploaded?: boolean;
  };
}

export interface PosLocalCloudMapping {
  entity: PosLocalEntityKind;
  localId: string;
  cloudId: string;
  mappedAt: number;
}

export type PosTerminalIntegrityStatus =
  | "healthy"
  | "repairing"
  | "requires_reprovision"
  | "reset_required";

export type PosTerminalIntegrityReason =
  | "authorization_failed"
  | "repair_rejected"
  | "seed_write_failed"
  | "terminal_revoked"
  | "ownership_conflict"
  | "store_access_missing"
  | "unknown";

export interface PosTerminalIntegrityState {
  cloudTerminalId?: string;
  message?: string;
  observedAt: number;
  reason?: PosTerminalIntegrityReason;
  registerNumber?: string;
  status: PosTerminalIntegrityStatus;
  storeId: string;
  terminalId: string;
}

export type PosDrawerAuthorityStatus = "healthy" | "blocked";

export type PosDrawerAuthorityBlockReason =
  | "cloud_closed"
  | "lifecycle_rejected"
  | "authority_unknown";

export interface PosDrawerAuthorityState {
  cloudRegisterSessionId?: string;
  localRegisterSessionId: string;
  message?: string;
  observedAt: number;
  reason?: PosDrawerAuthorityBlockReason;
  registerNumber?: string;
  status: PosDrawerAuthorityStatus;
  storeId: string;
  terminalId: string;
}

export type PosLocalStoreDayReadinessStatus =
  | "started"
  | "not_started"
  | "closed"
  | "reopened"
  | "unknown";

export interface PosLocalStoreDayReadiness {
  storeId: string;
  operatingDate: string;
  status: PosLocalStoreDayReadinessStatus;
  source: "daily_opening" | "daily_close" | "local";
  updatedAt: number;
  closeLifecycleStatus?: "active" | "reopened" | "superseded";
}

export type PosLocalStaffAuthorityRecord = {
  activeRoles: Array<"cashier" | "manager">;
  credentialId: string;
  credentialVersion: number;
  displayName?: string | null;
  expiresAt: number;
  issuedAt: number;
  organizationId: string;
  refreshedAt: number;
  staffProfileId: string;
  status: "active" | "revoked";
  storeId: string;
  terminalId: string;
  username: string;
  verifier: LocalPinVerifierMetadata;
  wrappedPosLocalStaffProof?: WrappedLocalStaffProof;
};

export type PosLocalStaffAuthorityReadiness =
  | "missing"
  | "expired"
  | "ready";

export type PosLocalActiveCashierPresenceRecord = {
  activeRoles: Array<"cashier" | "manager">;
  credentialId: string;
  credentialVersion: number;
  displayName?: string | null;
  expiresAt: number;
  lastValidatedAt: number;
  offlineFreshUntil: number;
  operatingDate: string;
  organizationId: string;
  signedInAt: number;
  staffProfileId: string;
  storeId: string;
  terminalId: string;
  username: string;
  wrappedPosLocalStaffProof: WrappedLocalStaffProof;
};

export type PosLocalCashierPresenceScope = {
  operatingDate: string;
  organizationId: string;
  storeId: string;
  terminalId: string;
};

export type PosLocalCashierPresenceDiagnostic = Omit<
  PosLocalActiveCashierPresenceRecord,
  "wrappedPosLocalStaffProof"
> & {
  proof: {
    expiresAt: number;
    status: "present";
  };
};

export interface PosLocalRegisterCatalogSnapshot {
  refreshedAt: number;
  rows: PosRegisterCatalogRowDto[];
  schemaVersion: number;
  storeId: string;
}

export interface PosLocalRegisterServiceCatalogSnapshot {
  refreshedAt: number;
  rows: PosServiceCatalogRowDto[];
  schemaVersion: number;
  storeId: string;
}

export interface PosLocalRegisterAvailabilitySnapshot {
  refreshedAt: number;
  rows: PosRegisterCatalogAvailabilityRowDto[];
  schemaVersion: number;
  storeId: string;
}

export type PosLocalStoreErrorCode =
  | "unsupported_schema_version"
  | "write_failed";

export type PosLocalStoreResult<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      error: {
        code: PosLocalStoreErrorCode;
        message: string;
      };
    };

export type PosLocalObjectStoreName =
  | "authority"
  | "meta"
  | "terminalSeed"
  | "events"
  | "mappings"
  | "readiness"
  | "cashierPresence"
  | "staffAuthority"
  | "registerCatalog"
  | "registerServiceCatalog"
  | "registerAvailability";

export interface PosLocalStoreTransaction {
  get<T>(
    storeName: PosLocalObjectStoreName,
    key: string,
  ): Promise<T | undefined>;
  getAll<T>(storeName: PosLocalObjectStoreName): Promise<T[]>;
  put<T>(
    storeName: PosLocalObjectStoreName,
    key: string,
    value: T,
  ): Promise<void>;
  delete(storeName: PosLocalObjectStoreName, key: string): Promise<void>;
}

export interface PosLocalStorageAdapter {
  transaction<T>(
    mode: "readonly" | "readwrite",
    storeNames: PosLocalObjectStoreName[],
    callback: (transaction: PosLocalStoreTransaction) => Promise<T>,
  ): Promise<T>;
}

type PosLocalStoreOptions = {
  adapter: PosLocalStorageAdapter;
  clock?: () => number;
  createLocalId?: (kind: string) => string;
};

export type PosLocalAppendEventInput = {
  type: PosLocalEventType;
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  localPosSessionId?: string;
  localTransactionId?: string;
  staffProfileId?: string;
  staffProofToken?: string;
  validationMetadata?: PosLocalEventValidationMetadata;
  initialSyncStatus?: PosLocalSyncEventStatus;
  payload: unknown;
};

const META_SCHEMA_VERSION_KEY = "schemaVersion";
const META_SEQUENCE_KEY = "sequence";
const META_UPLOAD_SEQUENCE_PREFIX = "uploadSequence:";
const TERMINAL_SEED_KEY = "current";
const TERMINAL_INTEGRITY_PREFIX = "terminalIntegrity:";
const DRAWER_AUTHORITY_PREFIX = "drawerAuthority:";

class PosLocalStoreSchemaError extends Error {
  readonly code = "unsupported_schema_version" as const;

  constructor(schemaVersion: number) {
    super(
      `POS local store schema version ${schemaVersion} is newer than supported version ${POS_LOCAL_STORE_SCHEMA_VERSION}.`,
    );
  }
}

export function createPosLocalStore(options: PosLocalStoreOptions) {
  const clock = options.clock ?? Date.now;
  const createLocalId =
    options.createLocalId ??
    ((kind: string) =>
      `${kind}-${clock()}-${Math.random().toString(36).slice(2)}`);

  async function ensureSupportedSchema(
    transaction: PosLocalStoreTransaction,
    mode: "readonly" | "readwrite",
  ) {
    const schemaVersion = await transaction.get<number>(
      "meta",
      META_SCHEMA_VERSION_KEY,
    );

    if (schemaVersion && schemaVersion > POS_LOCAL_STORE_SCHEMA_VERSION) {
      throw new PosLocalStoreSchemaError(schemaVersion);
    }

    if (!schemaVersion && mode === "readwrite") {
      await transaction.put(
        "meta",
        META_SCHEMA_VERSION_KEY,
        POS_LOCAL_STORE_SCHEMA_VERSION,
      );
    }
  }

  function toFailure<T>(error: unknown): PosLocalStoreResult<T> {
    if (error instanceof PosLocalStoreSchemaError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    return {
      ok: false,
      error: {
        code: "write_failed",
        message: "POS local store could not write the local event.",
      },
    };
  }

  async function appendEventInTransaction(
    transaction: PosLocalStoreTransaction,
    input: PosLocalAppendEventInput,
  ): Promise<PosLocalEventRecord> {
    const currentSequence =
      (await transaction.get<number>("meta", META_SEQUENCE_KEY)) ?? 0;
    const nextSequence = currentSequence + 1;
    const uploadSequence = await allocateUploadSequenceInTransaction(
      transaction,
      input,
    );
    const validationMetadata = normalizeEventValidationMetadata(
      input.validationMetadata,
    );
    const event: PosLocalEventRecord = {
      localEventId: createLocalId("event"),
      schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
      sequence: nextSequence,
      ...(uploadSequence ? { uploadSequence } : {}),
      type: input.type,
      terminalId: input.terminalId,
      storeId: input.storeId,
      ...(input.registerNumber ? { registerNumber: input.registerNumber } : {}),
      ...(input.localRegisterSessionId
        ? { localRegisterSessionId: input.localRegisterSessionId }
        : {}),
      ...(input.localPosSessionId
        ? { localPosSessionId: input.localPosSessionId }
        : {}),
      ...(input.localTransactionId
        ? { localTransactionId: input.localTransactionId }
        : {}),
      ...(input.staffProfileId ? { staffProfileId: input.staffProfileId } : {}),
      ...(shouldPersistStaffProofToken(input)
        ? { staffProofToken: input.staffProofToken }
        : {}),
      ...(validationMetadata ? { validationMetadata } : {}),
      payload: input.payload,
      createdAt: clock(),
      sync: { status: input.initialSyncStatus ?? getInitialSyncStatus(input.type) },
    };

    await transaction.put("events", String(nextSequence), event);
    await transaction.put("meta", META_SEQUENCE_KEY, nextSequence);
    return event;
  }

  async function allocateUploadSequenceInTransaction(
    transaction: PosLocalStoreTransaction,
    input: PosLocalAppendEventInput,
  ): Promise<number | undefined> {
    if (!shouldAllocateUploadSequence(input)) {
      return undefined;
    }

    const localRegisterSessionId = input.localRegisterSessionId;
    if (!localRegisterSessionId) {
      return undefined;
    }

    const key = uploadSequenceKey(localRegisterSessionId);
    const currentUploadSequence =
      (await transaction.get<number>("meta", key)) ?? 0;
    const nextUploadSequence = currentUploadSequence + 1;
    await transaction.put("meta", key, nextUploadSequence);
    return nextUploadSequence;
  }

  function shouldAllocateUploadSequence(input: PosLocalAppendEventInput): boolean {
    return Boolean(
      input.localRegisterSessionId &&
        input.initialSyncStatus !== "synced" &&
        canUploadPosLocalEventType(input.type),
    );
  }

  function getInitialSyncStatus(type: PosLocalEventType): PosLocalSyncEventStatus {
    return canUploadPosLocalEventType(type) ? "pending" : "synced";
  }

  function shouldPersistStaffProofToken(input: PosLocalAppendEventInput) {
    return Boolean(input.staffProofToken && shouldAllocateUploadSequence(input));
  }

  return {
    async writeProvisionedTerminalSeed(
      seed: PosProvisionedTerminalSeed,
    ): Promise<PosLocalStoreResult<PosProvisionedTerminalSeed>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "terminalSeed"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            await transaction.put("terminalSeed", TERMINAL_SEED_KEY, seed);
            return seed;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeProvisionedTerminalSeedAndClearTerminalIntegrity(input: {
      seed: PosProvisionedTerminalSeed;
      terminalIntegrity: { storeId: string; terminalId: string };
    }): Promise<PosLocalStoreResult<PosProvisionedTerminalSeed>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "terminalSeed", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const states = await transaction.getAll<unknown>("authority");
            for (const state of states) {
              if (
                isTerminalIntegrityState(state) &&
                state.storeId === input.terminalIntegrity.storeId &&
                (state.terminalId === input.terminalIntegrity.terminalId ||
                  state.cloudTerminalId === input.terminalIntegrity.terminalId)
              ) {
                await transaction.delete(
                  "authority",
                  terminalIntegrityKey(state.storeId, state.terminalId),
                );
              }
            }
            await transaction.put("terminalSeed", TERMINAL_SEED_KEY, input.seed);
            return input.seed;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readProvisionedTerminalSeed(): Promise<
      PosLocalStoreResult<PosProvisionedTerminalSeed | null>
    > {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "terminalSeed"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return (
              (await transaction.get<PosProvisionedTerminalSeed>(
                "terminalSeed",
                TERMINAL_SEED_KEY,
              )) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeTerminalIntegrityState(
      state: PosTerminalIntegrityState,
    ): Promise<PosLocalStoreResult<PosTerminalIntegrityState>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const normalized = normalizeTerminalIntegrityState(state);
            await transaction.put(
              "authority",
              terminalIntegrityKey(normalized.storeId, normalized.terminalId),
              normalized,
            );
            return normalized;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readTerminalIntegrityState(input: {
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosTerminalIntegrityState | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            const states = await transaction.getAll<unknown>("authority");
            return (
              states
                .filter(isTerminalIntegrityState)
                .filter(
                  (state) =>
                    state.storeId === input.storeId &&
                    (state.terminalId === input.terminalId ||
                      state.cloudTerminalId === input.terminalId),
                )
                .sort((left, right) => right.observedAt - left.observedAt)
                .at(0) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async clearTerminalIntegrityState(input: {
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<null>> {
      try {
        await options.adapter.transaction(
          "readwrite",
          ["meta", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const states = await transaction.getAll<unknown>("authority");
            for (const state of states) {
              if (
                isTerminalIntegrityState(state) &&
                state.storeId === input.storeId &&
                (state.terminalId === input.terminalId ||
                  state.cloudTerminalId === input.terminalId)
              ) {
                await transaction.delete(
                  "authority",
                  terminalIntegrityKey(state.storeId, state.terminalId),
                );
              }
            }
          },
        );

        return { ok: true, value: null };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeDrawerAuthorityState(
      state: PosDrawerAuthorityState,
    ): Promise<PosLocalStoreResult<PosDrawerAuthorityState>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const normalized = normalizeDrawerAuthorityState(state);
            await transaction.put(
              "authority",
              drawerAuthorityKey(normalized),
              normalized,
            );
            return normalized;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readDrawerAuthorityState(input: {
      localRegisterSessionId: string;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosDrawerAuthorityState | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            const states = await transaction.getAll<unknown>("authority");
            return (
              states
                .filter(isDrawerAuthorityState)
                .filter(
                  (state) =>
                    state.storeId === input.storeId &&
                    state.terminalId === input.terminalId &&
                    state.localRegisterSessionId ===
                      input.localRegisterSessionId,
                )
                .sort((left, right) => right.observedAt - left.observedAt)
                .at(0) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async clearDrawerAuthorityState(input: {
      localRegisterSessionId: string;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<null>> {
      try {
        await options.adapter.transaction(
          "readwrite",
          ["meta", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const states = await transaction.getAll<unknown>("authority");
            for (const state of states) {
              if (
                isDrawerAuthorityState(state) &&
                state.storeId === input.storeId &&
                state.terminalId === input.terminalId &&
                state.localRegisterSessionId === input.localRegisterSessionId
              ) {
                await transaction.delete("authority", drawerAuthorityKey(state));
              }
            }
          },
        );

        return { ok: true, value: null };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeStoreDayReadiness(
      readiness: PosLocalStoreDayReadiness,
    ): Promise<PosLocalStoreResult<PosLocalStoreDayReadiness>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "readiness"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            await transaction.put(
              "readiness",
              readinessKey(readiness.storeId, readiness.operatingDate),
              readiness,
            );
            return readiness;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readStoreDayReadiness(input: {
      storeId: string;
      operatingDate: string;
    }): Promise<PosLocalStoreResult<PosLocalStoreDayReadiness | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "readiness"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return (
              (await transaction.get<PosLocalStoreDayReadiness>(
                "readiness",
                readinessKey(input.storeId, input.operatingDate),
              )) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeCashierPresence(
      presence: PosLocalActiveCashierPresenceRecord,
    ): Promise<PosLocalStoreResult<PosLocalActiveCashierPresenceRecord>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "cashierPresence"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const normalized = normalizeCashierPresenceRecord(presence);
            await transaction.put(
              "cashierPresence",
              cashierPresenceKey(normalized),
              normalized,
            );
            return normalized;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readCashierPresence(
      input: PosLocalCashierPresenceScope & { now?: number },
    ): Promise<PosLocalStoreResult<PosLocalActiveCashierPresenceRecord | null>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "cashierPresence"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const key = cashierPresenceKey(input);
            const record =
              (await transaction.get<unknown>("cashierPresence", key)) ?? null;

            if (
              !isCashierPresenceRecord(record) ||
              !matchesCashierPresenceScope(record, input)
            ) {
              return null;
            }

            if (isExpiredCashierPresence(record, input.now ?? clock())) {
              await transaction.delete("cashierPresence", key);
              return null;
            }

            return record;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async clearCashierPresence(
      input: PosLocalCashierPresenceScope,
    ): Promise<PosLocalStoreResult<null>> {
      try {
        await options.adapter.transaction(
          "readwrite",
          ["meta", "cashierPresence"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            await transaction.delete(
              "cashierPresence",
              cashierPresenceKey(input),
            );
          },
        );

        return { ok: true, value: null };
      } catch (error) {
        return toFailure(error);
      }
    },

    async invalidateCashierPresenceForTerminal(input: {
      organizationId?: string;
      storeId?: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<number>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "cashierPresence"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const records =
              await transaction.getAll<unknown>("cashierPresence");
            let cleared = 0;
            for (const record of records) {
              if (
                isCashierPresenceRecord(record) &&
                record.terminalId === input.terminalId &&
                (!input.storeId || record.storeId === input.storeId) &&
                (!input.organizationId ||
                  record.organizationId === input.organizationId)
              ) {
                await transaction.delete(
                  "cashierPresence",
                  cashierPresenceKey(record),
                );
                cleared += 1;
              }
            }
            return cleared;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async replaceStaffAuthoritySnapshot(input: {
      records: PosLocalStaffAuthorityRecord[];
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityRecord[]>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "staffAuthority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const existing =
              await transaction.getAll<unknown>("staffAuthority");
            const existingByKey = new Map(
              existing
                .filter(isStaffAuthorityRecord)
                .map((record) => [staffAuthorityKey(record), record]),
            );

            for (const record of existing) {
              if (
                isStaffAuthorityRecord(record) &&
                record.storeId === input.storeId &&
                record.terminalId === input.terminalId
              ) {
                await transaction.delete(
                  "staffAuthority",
                  staffAuthorityKey(record),
                );
              }
            }

            const scopedRecords = input.records
              .filter(
                (record) =>
                  record.storeId === input.storeId &&
                  record.terminalId === input.terminalId,
              )
              .map((record) =>
                normalizeStaffAuthorityRecord(
                  preserveWrappedStaffProof(record, existingByKey),
                ),
              );

            for (const record of scopedRecords) {
              await transaction.put(
                "staffAuthority",
                staffAuthorityKey(record),
                record,
              );
            }

            return scopedRecords;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async upsertStaffAuthorityRecord(input: {
      record: PosLocalStaffAuthorityRecord;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityRecord>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "staffAuthority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            if (
              input.record.storeId !== input.storeId ||
              input.record.terminalId !== input.terminalId
            ) {
              return normalizeStaffAuthorityRecord(input.record);
            }

            const existing =
              (await transaction.get<unknown>(
                "staffAuthority",
                staffAuthorityKey(input.record),
              )) ?? null;
            const existingByKey = isStaffAuthorityRecord(existing)
              ? new Map([[staffAuthorityKey(existing), existing]])
              : new Map<string, PosLocalStaffAuthorityRecord>();
            const record = normalizeStaffAuthorityRecord(
              preserveWrappedStaffProof(input.record, existingByKey),
            );
            await transaction.put(
              "staffAuthority",
              staffAuthorityKey(record),
              record,
            );
            return record;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readStaffAuthorityForUsername(input: {
      now?: number;
      storeId: string;
      terminalId: string;
      username: string;
    }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityRecord | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "staffAuthority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            const record =
              (await transaction.get<unknown>(
                "staffAuthority",
                staffAuthorityKey(input),
              )) ?? null;

            if (!isStaffAuthorityRecord(record)) {
              return null;
            }

            if (
              record.storeId !== input.storeId ||
              record.terminalId !== input.terminalId ||
              record.status !== "active" ||
              record.expiresAt < (input.now ?? clock())
            ) {
              return null;
            }

            return record;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async getStaffAuthorityReadiness(input: {
      now?: number;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosLocalStaffAuthorityReadiness>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "staffAuthority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            const records =
              await transaction.getAll<unknown>("staffAuthority");
            const scopedRecords = records.filter(
              (record): record is PosLocalStaffAuthorityRecord =>
                isStaffAuthorityRecord(record) &&
                record.storeId === input.storeId &&
                record.terminalId === input.terminalId,
            );

            if (scopedRecords.length === 0) {
              return "missing" as const;
            }

            const now = input.now ?? clock();
            return scopedRecords.some((record) =>
              isOfflineStaffAuthorityReady(record, now),
            )
              ? ("ready" as const)
              : ("expired" as const);
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeRegisterCatalogSnapshot(input: {
      rows: PosRegisterCatalogRowDto[];
      storeId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogSnapshot>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const snapshot: PosLocalRegisterCatalogSnapshot = {
              refreshedAt: clock(),
              rows: input.rows,
              schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
              storeId: input.storeId,
            };
            await transaction.put("registerCatalog", input.storeId, snapshot);
            return snapshot;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readRegisterCatalogSnapshot(input: {
      storeId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogSnapshot | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return (
              (await transaction.get<PosLocalRegisterCatalogSnapshot>(
                "registerCatalog",
                input.storeId,
              )) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeRegisterServiceCatalogSnapshot(input: {
      rows: PosServiceCatalogRowDto[];
      storeId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterServiceCatalogSnapshot>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerServiceCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const snapshot: PosLocalRegisterServiceCatalogSnapshot = {
              refreshedAt: clock(),
              rows: input.rows.filter((row) => row.status === "active"),
              schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
              storeId: input.storeId,
            };
            await transaction.put(
              "registerServiceCatalog",
              input.storeId,
              snapshot,
            );
            return snapshot;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readRegisterServiceCatalogSnapshot(input: {
      storeId: string;
    }): Promise<
      PosLocalStoreResult<PosLocalRegisterServiceCatalogSnapshot | null>
    > {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "registerServiceCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return (
              (await transaction.get<PosLocalRegisterServiceCatalogSnapshot>(
                "registerServiceCatalog",
                input.storeId,
              )) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeRegisterAvailabilitySnapshot(input: {
      rows: PosRegisterCatalogAvailabilityRowDto[];
      storeId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterAvailabilitySnapshot>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerAvailability"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const snapshot: PosLocalRegisterAvailabilitySnapshot = {
              refreshedAt: clock(),
              rows: input.rows,
              schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
              storeId: input.storeId,
            };
            await transaction.put(
              "registerAvailability",
              input.storeId,
              snapshot,
            );
            return snapshot;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readRegisterAvailabilitySnapshot(input: {
      storeId: string;
    }): Promise<
      PosLocalStoreResult<PosLocalRegisterAvailabilitySnapshot | null>
    > {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "registerAvailability"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return (
              (await transaction.get<PosLocalRegisterAvailabilitySnapshot>(
                "registerAvailability",
                input.storeId,
              )) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async appendEvent(
      input: PosLocalAppendEventInput,
    ): Promise<PosLocalStoreResult<PosLocalEventRecord>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            return appendEventInTransaction(transaction, input);
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async listEvents(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            const events =
              await transaction.getAll<PosLocalEventRecord>("events");
            return events.sort((left, right) => left.sequence - right.sequence);
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async listEventsForUpload(): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      return this.listEvents();
    },

    async attachStaffProofTokenToPendingEvents(input: {
      staffProfileId: string;
      staffProofToken: string;
    }): Promise<PosLocalStoreResult<number>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const events =
              await transaction.getAll<PosLocalEventRecord>("events");
            let attachedCount = 0;

            for (const event of events) {
              if (
                event.staffProfileId === input.staffProfileId &&
                canUploadPosLocalEventType(event.type) &&
                (event.sync.status === "pending" ||
                  event.sync.status === "syncing" ||
                  event.sync.status === "failed")
              ) {
                await transaction.put("events", String(event.sequence), {
                  ...event,
                  staffProofToken: input.staffProofToken,
                });
                attachedCount += 1;
              }
            }

            return attachedCount;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async writeLocalCloudMapping(
      mapping: PosLocalCloudMapping,
    ): Promise<PosLocalStoreResult<PosLocalCloudMapping>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "mappings"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            await transaction.put(
              "mappings",
              mappingKey(mapping.entity, mapping.localId),
              mapping,
            );
            return mapping;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async markEventsSynced(
      eventIds: string[],
      markOptions?: { uploaded?: boolean },
    ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const eventIdSet = new Set(eventIds);
            const events =
              await transaction.getAll<PosLocalEventRecord>("events");
            const updated: PosLocalEventRecord[] = [];

            for (const event of events) {
              if (!eventIdSet.has(event.localEventId)) continue;
              const eventWithoutProof = omitStaffProofToken(event);
              const nextEvent = {
                ...eventWithoutProof,
                sync: {
                  ...event.sync,
                  error: undefined,
                  status: "synced" as const,
                  ...(markOptions?.uploaded ? { uploaded: true } : {}),
                },
              };
              await transaction.put(
                "events",
                String(event.sequence),
                nextEvent,
              );
              updated.push(nextEvent);
            }

            return updated.sort(
              (left, right) => left.sequence - right.sequence,
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readLocalCloudMapping(input: {
      entity: PosLocalEntityKind;
      localId: string;
    }): Promise<PosLocalStoreResult<PosLocalCloudMapping | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "mappings"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return (
              (await transaction.get<PosLocalCloudMapping>(
                "mappings",
                mappingKey(input.entity, input.localId),
              )) ?? null
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async markEventsNeedsReview(
      eventIds: string[],
      error?: string,
      markOptions?: { uploaded?: boolean },
    ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const eventIdSet = new Set(eventIds);
            const events =
              await transaction.getAll<PosLocalEventRecord>("events");
            const updated: PosLocalEventRecord[] = [];

            for (const event of events) {
              if (!eventIdSet.has(event.localEventId)) continue;
              const eventWithoutProof = omitStaffProofToken(event);
              const nextEvent = {
                ...eventWithoutProof,
                sync: {
                  ...event.sync,
                  status: "needs_review" as const,
                  ...(error ? { error } : {}),
                  ...(markOptions?.uploaded ? { uploaded: true } : {}),
                },
              };
              await transaction.put(
                "events",
                String(event.sequence),
                nextEvent,
              );
              updated.push(nextEvent);
            }

            return updated.sort(
              (left, right) => left.sequence - right.sequence,
            );
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async listLocalCloudMappings(): Promise<
      PosLocalStoreResult<PosLocalCloudMapping[]>
    > {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "mappings"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return transaction.getAll<PosLocalCloudMapping>("mappings");
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },
  };
}

function omitStaffProofToken(event: PosLocalEventRecord) {
  const next = { ...event };
  delete next.staffProofToken;
  return next;
}

function mappingKey(entity: PosLocalEntityKind, localId: string) {
  return `${entity}:${localId}`;
}

function terminalIntegrityKey(storeId: string, terminalId: string) {
  return `${TERMINAL_INTEGRITY_PREFIX}${storeId}:${terminalId}`;
}

function drawerAuthorityKey(input: {
  storeId: string;
  terminalId: string;
  localRegisterSessionId: string;
}) {
  return `${DRAWER_AUTHORITY_PREFIX}${input.storeId}:${input.terminalId}:${input.localRegisterSessionId}`;
}

function readinessKey(storeId: string, operatingDate: string) {
  return `${storeId}:${operatingDate}`;
}

function uploadSequenceKey(localRegisterSessionId: string) {
  return `${META_UPLOAD_SEQUENCE_PREFIX}${localRegisterSessionId}`;
}

function normalizeUsername(username: string) {
  return username.trim().toLowerCase();
}

function staffAuthorityKey(input: {
  storeId: string;
  terminalId: string;
  username: string;
}) {
  return `${input.storeId}:${input.terminalId}:${normalizeUsername(input.username)}`;
}

function cashierPresenceKey(input: PosLocalCashierPresenceScope) {
  return `${input.organizationId}:${input.storeId}:${input.terminalId}:${input.operatingDate}`;
}

function normalizeStaffAuthorityRecord(
  record: PosLocalStaffAuthorityRecord,
): PosLocalStaffAuthorityRecord {
  return {
    ...record,
    username: normalizeUsername(record.username),
  };
}

function normalizeCashierPresenceRecord(
  record: PosLocalActiveCashierPresenceRecord,
): PosLocalActiveCashierPresenceRecord {
  return {
    ...record,
    activeRoles: Array.from(new Set(record.activeRoles)).filter(
      (role): role is "cashier" | "manager" =>
        role === "cashier" || role === "manager",
    ),
    username: normalizeUsername(record.username),
  };
}

function normalizeEventValidationMetadata(
  metadata?: PosLocalEventValidationMetadata,
): PosLocalEventValidationMetadata | undefined {
  if (!metadata) return undefined;

  const flags = Array.from(new Set(metadata.flags)).filter(
    (flag): flag is PosLocalEventValidationFlag =>
      flag === "app-session-unverified" ||
      flag === "cloud-validation-uncertain",
  );

  if (flags.length === 0) return undefined;

  return {
    flags,
    ...(typeof metadata.observedAt === "number" &&
    Number.isFinite(metadata.observedAt)
      ? { observedAt: metadata.observedAt }
      : {}),
    ...(metadata.uploadDeferredUntil === "app-session-validated"
      ? { uploadDeferredUntil: metadata.uploadDeferredUntil }
      : {}),
  };
}

function matchesCashierPresenceScope(
  record: PosLocalActiveCashierPresenceRecord,
  scope: PosLocalCashierPresenceScope,
) {
  return (
    record.operatingDate === scope.operatingDate &&
    record.organizationId === scope.organizationId &&
    record.storeId === scope.storeId &&
    record.terminalId === scope.terminalId
  );
}

function isExpiredCashierPresence(
  record: PosLocalActiveCashierPresenceRecord,
  now: number,
) {
  return (
    record.expiresAt <= now ||
    record.offlineFreshUntil <= now ||
    record.wrappedPosLocalStaffProof.expiresAt <= now
  );
}

function preserveWrappedStaffProof(
  record: PosLocalStaffAuthorityRecord,
  existingByKey: Map<string, PosLocalStaffAuthorityRecord>,
): PosLocalStaffAuthorityRecord {
  if (record.wrappedPosLocalStaffProof) {
    return record;
  }

  const existing = existingByKey.get(staffAuthorityKey(record));
  if (
    !existing?.wrappedPosLocalStaffProof ||
    existing.credentialVersion !== record.credentialVersion ||
    existing.wrappedPosLocalStaffProof.expiresAt <= Date.now()
  ) {
    return record;
  }

  return {
    ...record,
    wrappedPosLocalStaffProof: existing.wrappedPosLocalStaffProof,
  };
}

function isOfflineStaffAuthorityReady(
  record: PosLocalStaffAuthorityRecord,
  now: number,
) {
  return (
    record.status === "active" &&
    record.expiresAt > now &&
    Boolean(record.wrappedPosLocalStaffProof) &&
    (record.wrappedPosLocalStaffProof?.expiresAt ?? 0) > now
  );
}

function normalizeTerminalIntegrityState(
  state: PosTerminalIntegrityState,
): PosTerminalIntegrityState {
  return {
    ...state,
    ...(state.message
      ? { message: toSafeAuthorityMessage(state.message, state.reason) }
      : state.reason === "authorization_failed"
        ? { message: "Terminal authorization failed. Repair terminal setup." }
        : {}),
  };
}

function normalizeDrawerAuthorityState(
  state: PosDrawerAuthorityState,
): PosDrawerAuthorityState {
  return {
    ...state,
    ...(state.message
      ? { message: toSafeAuthorityMessage(state.message) }
      : state.reason === "cloud_closed"
        ? { message: "Drawer setup changed. Open a current drawer before selling." }
        : state.reason === "lifecycle_rejected"
          ? { message: "Drawer sync needs review before selling can continue." }
          : {}),
  };
}

function toSafeAuthorityMessage(
  message: string,
  reason?: PosTerminalIntegrityReason,
) {
  if (reason === "authorization_failed") {
    return "Terminal authorization failed. Repair terminal setup.";
  }

  const collapsed = message.replace(/\s+/g, " ").trim();
  if (!collapsed) return undefined;

  return collapsed
    .replace(
      /\b(staffProofToken|syncSecretHash|syncSecret|staff proof|sync secret|verifier|credential|credentials|token)\b(?:\s+[^.,;]*)?/gi,
      (match) => `${match.split(/\s+/)[0]} [redacted]`,
    )
    .replace(/[A-Za-z0-9_-]{24,}/g, "[redacted]")
    .slice(0, 240);
}

function isTerminalIntegrityState(
  value: unknown,
): value is PosTerminalIntegrityState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.observedAt === "number" &&
    typeof record.status === "string" &&
    (record.status === "healthy" ||
      record.status === "repairing" ||
      record.status === "requires_reprovision" ||
      record.status === "reset_required") &&
    typeof record.storeId === "string" &&
    typeof record.terminalId === "string" &&
    (record.cloudTerminalId === undefined ||
      typeof record.cloudTerminalId === "string")
  );
}

function isDrawerAuthorityState(
  value: unknown,
): value is PosDrawerAuthorityState {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.localRegisterSessionId === "string" &&
    typeof record.observedAt === "number" &&
    (record.status === "healthy" || record.status === "blocked") &&
    typeof record.storeId === "string" &&
    typeof record.terminalId === "string"
  );
}

function isStaffAuthorityRecord(
  value: unknown,
): value is PosLocalStaffAuthorityRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const verifier = record.verifier as Record<string, unknown> | undefined;
  const wrappedProof = record.wrappedPosLocalStaffProof as
    | Record<string, unknown>
    | undefined;

  return (
    Array.isArray(record.activeRoles) &&
    record.activeRoles.every((role) => role === "cashier" || role === "manager") &&
    typeof record.credentialId === "string" &&
    typeof record.credentialVersion === "number" &&
    Number.isSafeInteger(record.credentialVersion) &&
    typeof record.expiresAt === "number" &&
    typeof record.issuedAt === "number" &&
    typeof record.organizationId === "string" &&
    (record.wrappedPosLocalStaffProof === undefined ||
      (typeof wrappedProof?.ciphertext === "string" &&
        typeof wrappedProof.expiresAt === "number" &&
        typeof wrappedProof.iv === "string")) &&
    typeof record.refreshedAt === "number" &&
    typeof record.staffProfileId === "string" &&
    (record.status === "active" || record.status === "revoked") &&
    typeof record.storeId === "string" &&
    typeof record.terminalId === "string" &&
    typeof record.username === "string" &&
    typeof verifier?.algorithm === "string" &&
    typeof verifier.hash === "string" &&
    typeof verifier.iterations === "number" &&
    typeof verifier.salt === "string" &&
    typeof verifier.version === "number"
  );
}

function isCashierPresenceRecord(
  value: unknown,
): value is PosLocalActiveCashierPresenceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const wrappedProof = record.wrappedPosLocalStaffProof as
    | Record<string, unknown>
    | undefined;

  return (
    Array.isArray(record.activeRoles) &&
    record.activeRoles.some(
      (role) => role === "cashier" || role === "manager",
    ) &&
    record.activeRoles.every(
      (role) => role === "cashier" || role === "manager",
    ) &&
    typeof record.credentialId === "string" &&
    typeof record.credentialVersion === "number" &&
    Number.isSafeInteger(record.credentialVersion) &&
    typeof record.expiresAt === "number" &&
    typeof record.lastValidatedAt === "number" &&
    typeof record.offlineFreshUntil === "number" &&
    typeof record.operatingDate === "string" &&
    typeof record.organizationId === "string" &&
    typeof record.signedInAt === "number" &&
    typeof record.staffProfileId === "string" &&
    typeof record.storeId === "string" &&
    typeof record.terminalId === "string" &&
    typeof record.username === "string" &&
    typeof wrappedProof?.ciphertext === "string" &&
    typeof wrappedProof.expiresAt === "number" &&
    typeof wrappedProof.iv === "string"
  );
}

export function toSafePosLocalCashierPresenceDiagnostic(
  presence: PosLocalActiveCashierPresenceRecord | null,
): PosLocalCashierPresenceDiagnostic | null {
  if (!presence) return null;
  const { wrappedPosLocalStaffProof: proof, ...safePresence } =
    normalizeCashierPresenceRecord(presence);

  return {
    ...safePresence,
    proof: {
      expiresAt: proof.expiresAt,
      status: "present",
    },
  };
}
export function createIndexedDbPosLocalStorageAdapter(options?: {
  databaseName?: string;
}): PosLocalStorageAdapter {
  const databaseName = options?.databaseName ?? "athena-pos-local";

  async function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, POS_LOCAL_STORE_SCHEMA_VERSION);

      request.onupgradeneeded = () => {
        const database = request.result;
        for (const storeName of [
          "authority",
          "meta",
          "terminalSeed",
          "events",
          "mappings",
          "readiness",
          "cashierPresence",
          "staffAuthority",
          "cashierPresence",
          "registerCatalog",
          "registerServiceCatalog",
          "registerAvailability",
        ] satisfies PosLocalObjectStoreName[]) {
          if (!database.objectStoreNames.contains(storeName)) {
            database.createObjectStore(storeName);
          }
        }
      };
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });
  }

  return {
    async transaction(mode, storeNames, callback) {
      const database = await openDatabase();

      try {
        return await new Promise((resolve, reject) => {
          const transaction = database.transaction(storeNames, mode);
          let settled = false;
          let callbackCompleted = false;
          let callbackResult: unknown;
          let transactionCompleted = false;

          const rejectOnce = (error: unknown) => {
            if (settled) return;
            settled = true;
            reject(error);
          };
          const resolveWhenReady = () => {
            if (settled || !callbackCompleted || !transactionCompleted) return;
            settled = true;
            resolve(callbackResult as never);
          };

          const wrappedTransaction: PosLocalStoreTransaction = {
            get(storeName, key) {
              return new Promise((innerResolve, innerReject) => {
                const request = transaction.objectStore(storeName).get(key);
                request.onerror = () => innerReject(request.error);
                request.onsuccess = () => innerResolve(request.result);
              });
            },
            getAll(storeName) {
              return new Promise((innerResolve, innerReject) => {
                const request = transaction.objectStore(storeName).getAll();
                request.onerror = () => innerReject(request.error);
                request.onsuccess = () => innerResolve(request.result);
              });
            },
            put(storeName, key, value) {
              return new Promise((innerResolve, innerReject) => {
                const request = transaction
                  .objectStore(storeName)
                  .put(value, key);
                request.onerror = () => innerReject(request.error);
                request.onsuccess = () => innerResolve();
              });
            },
            delete(storeName, key) {
              return new Promise((innerResolve, innerReject) => {
                const request = transaction.objectStore(storeName).delete(key);
                request.onerror = () => innerReject(request.error);
                request.onsuccess = () => innerResolve();
              });
            },
          };

          transaction.onabort = () => {
            rejectOnce(transaction.error);
          };
          transaction.onerror = () => {
            rejectOnce(transaction.error);
          };
          transaction.oncomplete = () => {
            transactionCompleted = true;
            resolveWhenReady();
          };

          callback(wrappedTransaction)
            .then((result) => {
              callbackResult = result;
              callbackCompleted = true;
              resolveWhenReady();
            })
            .catch((error) => {
              transaction.abort();
              rejectOnce(error);
            });
        });
      } finally {
        database.close();
      }
    },
  };
}

export function createMemoryPosLocalStorageAdapter(options?: {
  schemaVersion?: number;
  failNextPutForStore?: PosLocalObjectStoreName;
}): PosLocalStorageAdapter {
  let failNextPutForStore = options?.failNextPutForStore;
  const data = createEmptyMemoryStore();
  let writeQueue = Promise.resolve();

  if (options?.schemaVersion !== undefined) {
    data.meta.set(META_SCHEMA_VERSION_KEY, options.schemaVersion);
  }

  return {
    async transaction(_mode, _storeNames, callback) {
      const run = async () => {
        const transactionData = cloneMemoryStore(data);
        const transaction: PosLocalStoreTransaction = {
          async get<T>(storeName: PosLocalObjectStoreName, key: string) {
            return cloneValue(transactionData[storeName].get(key)) as
              | T
              | undefined;
          },
          async getAll<T>(storeName: PosLocalObjectStoreName) {
            return Array.from(transactionData[storeName].values()).map(
              (value) => cloneValue(value),
            ) as T[];
          },
          async put(storeName, key, value) {
            if (failNextPutForStore === storeName) {
              failNextPutForStore = undefined;
              throw new Error(`Failed to write ${storeName}`);
            }
            transactionData[storeName].set(key, cloneValue(value));
          },
          async delete(storeName, key) {
            transactionData[storeName].delete(key);
          },
        };

        const result = await callback(transaction);
        replaceMemoryStore(data, transactionData);
        return result;
      };

      if (_mode === "readonly") {
        return run();
      }

      const queued = writeQueue.then(run, run);
      writeQueue = queued.then(
        () => undefined,
        () => undefined,
      );
      return queued;
    },
  };
}

type MemoryStore = Record<PosLocalObjectStoreName, Map<string, unknown>>;

function createEmptyMemoryStore(): MemoryStore {
  return {
    authority: new Map(),
    meta: new Map(),
    terminalSeed: new Map(),
    events: new Map(),
    mappings: new Map(),
    readiness: new Map(),
    cashierPresence: new Map(),
    staffAuthority: new Map(),
    registerCatalog: new Map(),
    registerServiceCatalog: new Map(),
    registerAvailability: new Map(),
  };
}

function cloneMemoryStore(store: MemoryStore): MemoryStore {
  return {
    authority: new Map(store.authority),
    meta: new Map(store.meta),
    terminalSeed: new Map(store.terminalSeed),
    events: new Map(store.events),
    mappings: new Map(store.mappings),
    readiness: new Map(store.readiness),
    cashierPresence: new Map(store.cashierPresence),
    staffAuthority: new Map(store.staffAuthority),
    registerCatalog: new Map(store.registerCatalog),
    registerServiceCatalog: new Map(store.registerServiceCatalog),
    registerAvailability: new Map(store.registerAvailability),
  };
}

function replaceMemoryStore(target: MemoryStore, source: MemoryStore) {
  for (const storeName of Object.keys(target) as PosLocalObjectStoreName[]) {
    target[storeName] = source[storeName];
  }
}

function cloneValue<T>(value: T): T {
  if (value === undefined) return value;
  return structuredClone(value);
}
