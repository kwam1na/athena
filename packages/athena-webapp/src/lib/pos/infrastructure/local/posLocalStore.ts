import type {
  PosDrawerAuthorityState,
  PosDrawerLocalReviewAuthority,
  PosLocalActiveCashierPresenceRecord,
  PosLocalActivityReportReasonCode,
  PosLocalActivityReportState,
  PosLocalActivityReportStatus,
  PosLocalAppendEventInput,
  PosLocalCashierPresenceDiagnostic,
  PosLocalCashierPresenceScope,
  PosLocalCloudMapping,
  PosLocalEntityKind,
  PosLocalEventRecord,
  PosLocalEventType,
  PosLocalEventValidationFlag,
  PosLocalEventValidationMetadata,
  PosLocalLedgerPurgeResult,
  PosLocalOpaqueContinuation,
  PosLocalLedgerSummary,
  PosLocalRegisterAvailabilitySnapshot,
  PosLocalRegisterCatalogSnapshot,
  PosLocalRegisterCatalogPin,
  PosLocalRegisterCatalogVersion,
  PosLocalRegisterCatalogVersionState,
  PosLocalRegisterCatalogVersionWriteOutcome,
  PosLocalRegisterServiceCatalogSnapshot,
  PosLocalReviewResolutionReason,
  PosLocalStaffAuthorityReadiness,
  PosLocalStaffAuthorityRecord,
  PosLocalStoreDayReadiness,
  PosLocalStoreErrorCode,
  PosLocalStoreResult,
  PosLocalSyncEventStatus,
  PosProvisionedTerminalSeed,
  PosRegisterLifecycleAuthorityApplyResult,
  PosRegisterLifecycleAuthorityObservation,
  PosRegisterLifecycleServerAuthority,
  PosRegisterOperationalStateResetResult,
  PosRegisterCatalogRevision,
  PosTerminalIntegrityReason,
  PosTerminalIntegrityState,
} from "@/lib/pos/application/posLocalStoreTypes";
import type {
  PosRegisterCatalogAvailabilityRowDto,
  PosRegisterCatalogRowDto,
  PosServiceCatalogRowDto,
} from "@/lib/pos/application/dto";
import {
  canUploadPosLocalEventType,
  POS_LOCAL_LOGICAL_RECORD_VERSION,
} from "@/lib/pos/application/posLocalStoreTypes";
import type {
  PosLocalSyncPendingCheckoutItemDefinedPayload,
  PosLocalSyncPendingCheckoutItemLocalMetadata,
  PosLocalSyncPendingCheckoutItemSearchContext,
} from "../../../../../shared/posLocalSyncContract";
import { canReportPosRegisterSessionLocalActivityType } from "../../../../../shared/posRegisterSessionActivityContract";
import { reconcileRegisterLifecycleServerAuthority } from "./registerLifecycleAuthorityReconciliation";
import { assessPosLocalLedgerRetention } from "./posLocalLedgerPolicy";

// Temporary compatibility for tests and migration utilities. Production
// consumers import semantic contracts from the application boundary directly.
export * from "@/lib/pos/application/posLocalStoreTypes";

// IndexedDB owns its physical layout version. Other engines choose independently.
export const POS_LOCAL_STORE_SCHEMA_VERSION = 10;

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
  getAllKeys(storeName: PosLocalObjectStoreName): Promise<string[]>;
  getFromIndex<T>(
    storeName: PosLocalObjectStoreName,
    indexName: string,
    key: IDBValidKey,
  ): Promise<T | undefined>;
  getAllFromIndex<T>(
    storeName: PosLocalObjectStoreName,
    indexName: string,
    range: { lower: IDBValidKey; upper: IDBValidKey },
    limit?: number,
  ): Promise<T[]>;
  countFromIndex(
    storeName: PosLocalObjectStoreName,
    indexName: string,
    range: { lower: IDBValidKey; upper: IDBValidKey },
  ): Promise<number>;
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

const META_SCHEMA_VERSION_KEY = "schemaVersion";
const META_LOGICAL_RECORD_VERSION_KEY = "logicalRecordVersion";
const META_SEQUENCE_KEY = "sequence";
const META_UPLOAD_SEQUENCE_PREFIX = "uploadSequence:";
const META_REGISTER_OPERATIONAL_STATE_RESET_KEY =
  "registerOperationalStateReset:v1";
const REGISTER_CATALOG_ACTIVE_PREFIX = "catalog-active:";
const REGISTER_CATALOG_STAGED_PREFIX = "catalog-staged:";
const REGISTER_CATALOG_VERSION_PREFIX = "catalog-version:";
const REGISTER_CATALOG_PIN_PREFIX = "catalog-pin:";
export const REGISTER_CATALOG_PIN_LEASE_MS = 24 * 60 * 60 * 1_000;
const TERMINAL_SEED_KEY = "current";
const TERMINAL_INTEGRITY_PREFIX = "terminalIntegrity:";
const DRAWER_AUTHORITY_PREFIX = "drawerAuthority:";
const POS_LOCAL_OBJECT_STORE_NAMES = [
  "authority",
  "meta",
  "terminalSeed",
  "events",
  "mappings",
  "readiness",
  "cashierPresence",
  "staffAuthority",
  "registerCatalog",
  "registerServiceCatalog",
  "registerAvailability",
] satisfies PosLocalObjectStoreName[];

class PosLocalStoreSchemaError extends Error {
  readonly code = "unsupported_schema_version" as const;

  constructor(schemaVersion: number) {
    super(
      `POS local store schema version ${schemaVersion} is newer than supported version ${POS_LOCAL_STORE_SCHEMA_VERSION}.`,
    );
  }
}

class PosLocalStoreLogicalRecordVersionError extends Error {
  readonly code = "unsupported_logical_record_version" as const;

  constructor(version: number) {
    super(
      `POS local record version ${version} is newer than this build supports.`,
    );
  }
}

class PosLocalStoreMissingObjectStoresError extends Error {
  readonly code = "missing_object_stores" as const;

  constructor(readonly storeNames: string[]) {
    super(
      `POS local store is missing required IndexedDB object stores: ${storeNames.join(", ")}.`,
    );
  }
}

class PosLocalStoreOperationError extends Error {
  constructor(
    readonly mode: "readonly" | "readwrite",
    readonly cause: unknown,
  ) {
    super("POS local storage operation failed.");
  }
}

export function createPosLocalStore(options: PosLocalStoreOptions) {
  const clock = options.clock ?? Date.now;
  const createLocalId =
    options.createLocalId ??
    ((kind: string) =>
      `${kind}-${clock()}-${Math.random().toString(36).slice(2)}`);

  function catalogRevisionKey(revision: PosRegisterCatalogRevision) {
    return revision === "legacy" ? "legacy" : `server-${revision}`;
  }

  function catalogVersionKey(
    storeId: string,
    revision: PosRegisterCatalogRevision,
  ) {
    return `${REGISTER_CATALOG_VERSION_PREFIX}${storeId}:${catalogRevisionKey(revision)}`;
  }

  function catalogActiveKey(storeId: string) {
    return `${REGISTER_CATALOG_ACTIVE_PREFIX}${storeId}`;
  }

  function catalogStagedKey(storeId: string) {
    return `${REGISTER_CATALOG_STAGED_PREFIX}${storeId}`;
  }

  function catalogPinKey(storeId: string, terminalId: string, ownerId?: string) {
    return `${REGISTER_CATALOG_PIN_PREFIX}${storeId}:${terminalId}:${ownerId ?? "default"}`;
  }

  function compareCatalogRevisions(
    left: PosRegisterCatalogRevision,
    right: PosRegisterCatalogRevision,
  ) {
    if (left === right) return 0;
    if (left === "legacy") return -1;
    if (right === "legacy") return 1;
    return left - right;
  }

  async function readCatalogVersion(
    transaction: PosLocalStoreTransaction,
    storeId: string,
    revision: PosRegisterCatalogRevision | null,
  ) {
    if (revision === null) return null;
    return (
      (await transaction.get<PosLocalRegisterCatalogVersion>(
        "registerCatalog",
        catalogVersionKey(storeId, revision),
      )) ?? null
    );
  }

  async function readCatalogPointer(
    transaction: PosLocalStoreTransaction,
    key: string,
  ) {
    return (
      (
        await transaction.get<{ revision: PosRegisterCatalogRevision }>(
          "registerCatalog",
          key,
        )
      )?.revision ?? null
    );
  }

  async function readCatalogVersionStateInTransaction(
    transaction: PosLocalStoreTransaction,
    storeId: string,
  ): Promise<PosLocalRegisterCatalogVersionState> {
    let activeRevision = await readCatalogPointer(
      transaction,
      catalogActiveKey(storeId),
    );
    let active = await readCatalogVersion(transaction, storeId, activeRevision);
    if (!active) {
      const legacy =
        (await transaction.get<PosLocalRegisterCatalogSnapshot>(
          "registerCatalog",
          storeId,
        )) ?? null;
      if (legacy) {
        activeRevision = "legacy";
        active = {
          persistedAt: legacy.refreshedAt,
          revision: "legacy",
          rows: legacy.rows,
          schemaVersion: legacy.schemaVersion,
          storeId,
        };
      }
    }
    const stagedRevision = await readCatalogPointer(
      transaction,
      catalogStagedKey(storeId),
    );
    const staged = await readCatalogVersion(
      transaction,
      storeId,
      stagedRevision,
    );
    return { active, activeRevision, staged, stagedRevision };
  }

  async function materializeCatalogVersion(
    transaction: PosLocalStoreTransaction,
    input: {
      ownerId?: string;
      revision: PosRegisterCatalogRevision;
      rows: PosRegisterCatalogRowDto[];
      storeId: string;
    },
  ) {
    const existing = await readCatalogVersion(
      transaction,
      input.storeId,
      input.revision,
    );
    if (existing) return existing;
    const version: PosLocalRegisterCatalogVersion = {
      persistedAt: clock(),
      revision: input.revision,
      rows: input.rows,
      schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
      storeId: input.storeId,
    };
    await transaction.put(
      "registerCatalog",
      catalogVersionKey(input.storeId, input.revision),
      version,
    );
    return version;
  }

  async function pinCatalogInTransaction(
    transaction: PosLocalStoreTransaction,
    input: {
      ownerId?: string;
      revision: PosRegisterCatalogRevision;
      rows: PosRegisterCatalogRowDto[];
      storeId: string;
      terminalId: string;
    },
  ) {
    await materializeCatalogVersion(transaction, input);
    const pin: PosLocalRegisterCatalogPin = {
      ...(input.ownerId ? { ownerId: input.ownerId } : {}),
      leaseExpiresAt: clock() + REGISTER_CATALOG_PIN_LEASE_MS,
      pinnedAt: clock(),
      revision: input.revision,
      storeId: input.storeId,
      terminalId: input.terminalId,
    };
    await transaction.put(
      "registerCatalog",
      catalogPinKey(input.storeId, input.terminalId, input.ownerId),
      pin,
    );
    return pin;
  }

  async function pruneUnreferencedCatalogVersions(
    transaction: PosLocalStoreTransaction,
    storeId: string,
  ) {
    const activeRevision = await readCatalogPointer(
      transaction,
      catalogActiveKey(storeId),
    );
    const stagedRevision = await readCatalogPointer(
      transaction,
      catalogStagedKey(storeId),
    );
    const retained = new Set(
      [activeRevision, stagedRevision].filter(
        (revision): revision is PosRegisterCatalogRevision => revision !== null,
      ),
    );
    const pinKeyPrefix = `${REGISTER_CATALOG_PIN_PREFIX}${storeId}:`;
    for (const key of await transaction.getAllKeys("registerCatalog")) {
      if (!key.startsWith(pinKeyPrefix)) continue;
      const record = await transaction.get<PosLocalRegisterCatalogPin>(
        "registerCatalog",
        key,
      );
      if (
        record &&
        record.storeId === storeId &&
        (record.revision === "legacy" || typeof record.revision === "number")
      ) {
        const leaseExpiresAt =
          record.leaseExpiresAt ??
          record.pinnedAt + REGISTER_CATALOG_PIN_LEASE_MS;
        if (leaseExpiresAt <= clock()) {
          await transaction.delete("registerCatalog", key);
        } else {
          retained.add(record.revision);
        }
      }
    }
    const versionKeyPrefix = `${REGISTER_CATALOG_VERSION_PREFIX}${storeId}:`;
    for (const key of await transaction.getAllKeys("registerCatalog")) {
      if (!key.startsWith(versionKeyPrefix)) continue;
      const version = await transaction.get<PosLocalRegisterCatalogVersion>(
        "registerCatalog",
        key,
      );
      if (version && !retained.has(version.revision)) {
        await transaction.delete("registerCatalog", key);
      }
    }
  }

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

    if (
      mode === "readwrite" &&
      (!schemaVersion || schemaVersion < POS_LOCAL_STORE_SCHEMA_VERSION)
    ) {
      await transaction.put(
        "meta",
        META_SCHEMA_VERSION_KEY,
        POS_LOCAL_STORE_SCHEMA_VERSION,
      );
    }

    const logicalRecordVersion = await transaction.get<number>(
      "meta",
      META_LOGICAL_RECORD_VERSION_KEY,
    );
    if (
      logicalRecordVersion &&
      logicalRecordVersion > POS_LOCAL_LOGICAL_RECORD_VERSION
    ) {
      throw new PosLocalStoreLogicalRecordVersionError(logicalRecordVersion);
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

    if (error instanceof PosLocalStoreLogicalRecordVersionError) {
      return {
        ok: false,
        error: { code: error.code, message: error.message },
      };
    }

    if (error instanceof PosLocalStoreMissingObjectStoresError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
        },
      };
    }

    const operationError =
      error instanceof PosLocalStoreOperationError ? error : undefined;
    const nativeError = operationError?.cause ?? error;
    const nativeName =
      nativeError && typeof nativeError === "object" && "name" in nativeError
        ? String(nativeError.name)
        : "";
    const classified = classifyPosLocalStoreErrorCode(
      nativeName,
      operationError?.mode,
    );

    return {
      ok: false,
      error: {
        code: classified,
        message: safePosLocalStoreFailureMessage(classified),
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
    const activity = getInitialActivityState(input.type);
    const event: PosLocalEventRecord = {
      localEventId: createLocalId("event"),
      schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
      sequence: nextSequence,
      ...(uploadSequence ? { uploadSequence } : {}),
      type: input.type,
      terminalId: input.terminalId,
      storeId: input.storeId,
      ...(input.registerNumber ? { registerNumber: input.registerNumber } : {}),
      ...(input.localRegisterSessionId
        ? { localRegisterSessionId: input.localRegisterSessionId }
        : {}),
      ...(getExpenseLocalSessionId(input)
        ? { localExpenseSessionId: getExpenseLocalSessionId(input) }
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
      payload: normalizeLocalEventPayload(input),
      createdAt: clock(),
      ...(input.catalogPin
        ? { catalogRevision: input.catalogPin.revision }
        : {}),
      ...(activity ? { activity } : {}),
      sync: {
        status: input.initialSyncStatus ?? getInitialSyncStatus(input.type),
      },
    };

    await transaction.put("events", String(nextSequence), event);
    if (input.type === "store_day.started") {
      const payload = asRecord(event.payload);
      const operatingDate = stringOrEmpty(payload.operatingDate);
      if (operatingDate) {
        await transaction.put(
          "readiness",
          readinessKey(input.storeId, operatingDate),
          {
            operatingDate,
            source: "local",
            status: "started",
            storeId: input.storeId,
            updatedAt: event.createdAt,
          } satisfies PosLocalStoreDayReadiness,
        );
      }
    }
    if (input.catalogPin) {
      await pinCatalogInTransaction(transaction, {
        ...input.catalogPin,
        storeId: input.storeId,
        terminalId: input.terminalId,
      });
    }
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

    const sequenceScopeId = getUploadSequenceScopeId(input);
    if (!sequenceScopeId) {
      return undefined;
    }

    const key = uploadSequenceKey(sequenceScopeId);
    const currentUploadSequence =
      (await transaction.get<number>("meta", key)) ?? 0;
    const nextUploadSequence = currentUploadSequence + 1;
    await transaction.put("meta", key, nextUploadSequence);
    return nextUploadSequence;
  }

  function shouldAllocateUploadSequence(
    input: PosLocalAppendEventInput,
  ): boolean {
    return Boolean(
      getUploadSequenceScopeId(input) &&
      input.initialSyncStatus !== "synced" &&
      canUploadPosLocalEventType(input.type),
    );
  }

  function getInitialSyncStatus(
    type: PosLocalEventType,
  ): PosLocalSyncEventStatus {
    return canUploadPosLocalEventType(type) ? "pending" : "synced";
  }

  function getInitialActivityState(
    type: PosLocalEventType,
  ): PosLocalActivityReportState | undefined {
    return canReportPosRegisterSessionLocalActivityType(type)
      ? { status: "pending" }
      : undefined;
  }

  function shouldPersistStaffProofToken(input: PosLocalAppendEventInput) {
    return Boolean(
      input.staffProofToken && shouldAllocateUploadSequence(input),
    );
  }

  return {
    async initializeStorage(): Promise<
      PosLocalStoreResult<{ logicalRecordVersion: number }>
    > {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          [...POS_LOCAL_OBJECT_STORE_NAMES],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const logicalRecordVersion = await transaction.get<number>(
              "meta",
              META_LOGICAL_RECORD_VERSION_KEY,
            );
            if (!logicalRecordVersion) {
              await migrateLegacyLogicalRecords(transaction);
              await transaction.put(
                "meta",
                META_LOGICAL_RECORD_VERSION_KEY,
                POS_LOCAL_LOGICAL_RECORD_VERSION,
              );
            }
            return { logicalRecordVersion: POS_LOCAL_LOGICAL_RECORD_VERSION };
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async resetRegisterOperationalStateForAuthorityCutover(): Promise<
      PosLocalStoreResult<PosRegisterOperationalStateResetResult>
    > {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events", "mappings", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const priorReset = await transaction.get<{ resetAt: number }>(
              "meta",
              META_REGISTER_OPERATIONAL_STATE_RESET_KEY,
            );
            if (priorReset) {
              return {
                status: "already_applied" as const,
                resetAt: priorReset.resetAt,
              };
            }

            const events =
              await transaction.getAll<PosLocalEventRecord>("events");
            const registerOperationalEvents = events.filter((event) =>
              isBusinessOperationalEvent(event.type),
            );

            const mappings =
              await transaction.getAll<PosLocalCloudMapping>("mappings");
            const registerSessionMappings = mappings.filter(
              (mapping) => mapping.entity === "registerSession",
            );
            const drawerAuthorityKeys = (
              await transaction.getAllKeys("authority")
            ).filter((key) => !key.startsWith(TERMINAL_INTEGRITY_PREFIX));

            for (const event of registerOperationalEvents) {
              await transaction.delete("events", String(event.sequence));
            }
            for (const mapping of registerSessionMappings) {
              await transaction.delete(
                "mappings",
                mappingKey(mapping.entity, mapping.localId),
              );
            }
            for (const key of drawerAuthorityKeys) {
              await transaction.delete("authority", key);
            }

            const resetAt = clock();
            const result = {
              status: "applied" as const,
              deletedAuthorityCount: drawerAuthorityKeys.length,
              deletedEventCount: registerOperationalEvents.length,
              deletedMappingCount: registerSessionMappings.length,
              resetAt,
            };
            await transaction.put(
              "meta",
              META_REGISTER_OPERATIONAL_STATE_RESET_KEY,
              result,
            );
            return result;
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async resetSharedDemoLocalState(): Promise<PosLocalStoreResult<null>> {
      try {
        await options.adapter.transaction(
          "readwrite",
          [...POS_LOCAL_OBJECT_STORE_NAMES],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            for (const storeName of POS_LOCAL_OBJECT_STORE_NAMES) {
              // Terminal identity is durable device foundation. Demo restore
              // clears operational state around it without unmounting POS.
              if (storeName === "terminalSeed") continue;
              const keys = await transaction.getAllKeys(storeName);
              for (const key of keys) {
                if (
                  storeName === "meta" &&
                  (key === META_SCHEMA_VERSION_KEY ||
                    key === META_LOGICAL_RECORD_VERSION_KEY)
                ) {
                  continue;
                }
                await transaction.delete(storeName, key);
              }
            }
          },
        );
        return { ok: true, value: null };
      } catch (error) {
        return toFailure(error);
      }
    },

    async resetSharedDemoFirstVisitState(): Promise<PosLocalStoreResult<null>> {
      try {
        await options.adapter.transaction(
          "readwrite",
          [...POS_LOCAL_OBJECT_STORE_NAMES],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            for (const storeName of POS_LOCAL_OBJECT_STORE_NAMES) {
              const keys = await transaction.getAllKeys(storeName);
              for (const key of keys) {
                if (
                  storeName === "meta" &&
                  (key === META_SCHEMA_VERSION_KEY ||
                    key === META_LOGICAL_RECORD_VERSION_KEY)
                ) {
                  continue;
                }
                await transaction.delete(storeName, key);
              }
            }
          },
        );
        return { ok: true, value: null };
      } catch (error) {
        return toFailure(error);
      }
    },

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
            await transaction.put(
              "terminalSeed",
              TERMINAL_SEED_KEY,
              input.seed,
            );
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

        return { ok: true as const, value: null };
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
            const current = await transaction.get<unknown>(
              "authority",
              drawerAuthorityKey(state),
            );
            const normalized = mergeDrawerAuthorityState(
              isDrawerAuthorityState(current) ? current : null,
              state,
            );
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

    async applyRegisterLifecycleAuthority(input: {
      expectedMapping?: {
        cloudRegisterSessionId?: string;
        mappedAt?: number;
        mappingAuthorityRevision?: number;
        registerCandidateState?: "current" | "historical";
        registerNumber?: string;
        storeId?: string;
        terminalId?: string;
      };
      observation: PosRegisterLifecycleAuthorityObservation;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosRegisterLifecycleAuthorityApplyResult>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "mappings", "authority"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const mapping = await transaction.get<PosLocalCloudMapping>(
              "mappings",
              mappingKey(
                "registerSession",
                input.observation.localRegisterSessionId,
              ),
            );
            if (
              !registerAuthorityMappingMatchesExpectation({
                expected: input.expectedMapping,
                mapping,
                observation: input.observation,
              })
            ) {
              return {
                disposition: "rejected" as const,
                reason: "mapping_invalidated" as const,
              };
            }

            const key = drawerAuthorityKey({
              localRegisterSessionId: input.observation.localRegisterSessionId,
              storeId: input.storeId,
              terminalId: input.terminalId,
            });
            const rawCurrent = await transaction.get<unknown>("authority", key);
            const current = isDrawerAuthorityState(rawCurrent)
              ? toDrawerAuthorityEnvelope(rawCurrent)
              : null;
            if (
              input.observation.cursor &&
              mapping?.mappingAuthorityRevision !== undefined &&
              input.observation.cursor.mappingAuthorityRevision <
                mapping.mappingAuthorityRevision
            ) {
              return {
                disposition: "noop" as const,
                reason: "stale" as const,
              };
            }
            const decision = reconcileRegisterLifecycleServerAuthority(
              current?.serverAuthority,
              toServerAuthority(input.observation),
            );
            if (decision.disposition !== "applied") return decision;

            const next = buildEffectiveDrawerAuthorityState({
              base: current ?? {
                localRegisterSessionId:
                  input.observation.localRegisterSessionId,
                observedAt: input.observation.observedAt,
                registerNumber: input.observation.registerNumber,
                status: input.observation.status,
                storeId: input.storeId,
                terminalId: input.terminalId,
              },
              serverAuthority: decision.value,
            });
            await transaction.put("authority", key, next);

            if (mapping && decision.value.cursor) {
              await transaction.put(
                "mappings",
                mappingKey(mapping.entity, mapping.localId),
                {
                  ...mapping,
                  mappingAuthorityRevision:
                    decision.value.cursor.mappingAuthorityRevision,
                },
              );
            }

            return {
              disposition: "applied" as const,
              reason: "committed" as const,
              value: next,
            };
          },
        );

        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readDrawerAuthorityState(input: {
      cloudRegisterSessionId?: string;
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
                .filter((state) =>
                  drawerAuthorityMatchesReadInput(state, input),
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
      cloudRegisterSessionId?: string;
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
                drawerAuthorityMatchesExactLocalInput(state, input)
              ) {
                await transaction.delete(
                  "authority",
                  drawerAuthorityKey(state),
                );
              }
            }
          },
        );

        return { ok: true as const, value: null };
      } catch (error) {
        return toFailure(error);
      }
    },

    async clearLocalDrawerReviewAuthorityState(input: {
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
            const key = drawerAuthorityKey(input);
            const rawCurrent = await transaction.get<unknown>("authority", key);
            if (!isDrawerAuthorityState(rawCurrent)) return;
            const current = toDrawerAuthorityEnvelope(rawCurrent);
            if (!current.localReviewAuthority) return;
            if (!current.serverAuthority) {
              await transaction.delete("authority", key);
              return;
            }
            await transaction.put(
              "authority",
              key,
              buildEffectiveDrawerAuthorityState({
                base: current,
                localReviewAuthority: null,
              }),
            );
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
    ): Promise<
      PosLocalStoreResult<PosLocalActiveCashierPresenceRecord | null>
    > {
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

    async readActiveCashierPresence(input: {
      now?: number;
      operatingDate: string;
      organizationId?: string;
      storeId: string;
      terminalId: string;
    }): Promise<
      PosLocalStoreResult<PosLocalActiveCashierPresenceRecord | null>
    > {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "cashierPresence"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const now = input.now ?? clock();
            const records =
              await transaction.getAll<unknown>("cashierPresence");
            const candidates: PosLocalActiveCashierPresenceRecord[] = [];

            for (const record of records) {
              if (!isCashierPresenceRecord(record)) {
                continue;
              }

              if (isExpiredCashierPresence(record, now)) {
                await transaction.delete(
                  "cashierPresence",
                  cashierPresenceKey(record),
                );
                continue;
              }

              if (matchesActiveCashierPresenceScope(record, input)) {
                candidates.push(record);
              }
            }

            return (
              candidates.sort(
                (left, right) => right.signedInAt - left.signedInAt,
              )[0] ?? null
            );
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
            const records = await transaction.getAll<unknown>("staffAuthority");
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

    async readRegisterCatalogVersionState(input: {
      storeId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogVersionState>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return readCatalogVersionStateInTransaction(
              transaction,
              input.storeId,
            );
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readRegisterCatalogSelection(input: {
      ownerId?: string;
      storeId: string;
      terminalId?: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogVersion | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            if (input.terminalId) {
              const pin = await transaction.get<PosLocalRegisterCatalogPin>(
                "registerCatalog",
                catalogPinKey(input.storeId, input.terminalId, input.ownerId),
              );
              if (pin) {
                const pinned = await readCatalogVersion(
                  transaction,
                  input.storeId,
                  pin.revision,
                );
                return pinned;
              }
            }
            return (
              await readCatalogVersionStateInTransaction(
                transaction,
                input.storeId,
              )
            ).active;
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readRegisterCatalogPin(input: {
      ownerId?: string;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogPin | null>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return (
              (await transaction.get<PosLocalRegisterCatalogPin>(
                "registerCatalog",
                catalogPinKey(input.storeId, input.terminalId, input.ownerId),
              )) ?? null
            );
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async stageRegisterCatalogVersion(input: {
      revision: number;
      rows: PosRegisterCatalogRowDto[];
      storeId: string;
    }): Promise<
      PosLocalStoreResult<PosLocalRegisterCatalogVersionWriteOutcome>
    > {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const state = await readCatalogVersionStateInTransaction(
              transaction,
              input.storeId,
            );
            const winner = [state.active, state.staged]
              .filter((version): version is PosLocalRegisterCatalogVersion =>
                Boolean(version),
              )
              .sort((left, right) =>
                compareCatalogRevisions(right.revision, left.revision),
              )[0];
            if (
              winner &&
              compareCatalogRevisions(winner.revision, input.revision) > 0
            ) {
              return {
                revision: winner.revision,
                status: "already_newer" as const,
                version: winner,
              };
            }
            const version = await materializeCatalogVersion(transaction, input);
            if (state.activeRevision === input.revision) {
              return {
                revision: input.revision,
                status: "already_current" as const,
                version,
              };
            }
            if (state.stagedRevision === input.revision) {
              return {
                revision: input.revision,
                status: "already_current" as const,
                version,
              };
            }
            await transaction.put(
              "registerCatalog",
              catalogStagedKey(input.storeId),
              { revision: input.revision },
            );
            return {
              revision: input.revision,
              status: "staged" as const,
              version,
            };
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async promoteRegisterCatalogVersion(input: {
      revision: number;
      storeId: string;
    }): Promise<
      PosLocalStoreResult<PosLocalRegisterCatalogVersionWriteOutcome>
    > {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const state = await readCatalogVersionStateInTransaction(
              transaction,
              input.storeId,
            );
            const requestedVersion = await readCatalogVersion(
              transaction,
              input.storeId,
              input.revision,
            );
            const version = [state.active, state.staged, requestedVersion]
              .filter((candidate): candidate is PosLocalRegisterCatalogVersion =>
                Boolean(candidate),
              )
              .sort((left, right) =>
                compareCatalogRevisions(right.revision, left.revision),
              )[0];
            if (!version) {
              throw new Error(
                "The staged register catalog version is missing.",
              );
            }
            if (state.activeRevision === version.revision) {
              return {
                revision: version.revision,
                status:
                  version.revision === input.revision
                    ? ("already_current" as const)
                    : ("already_newer" as const),
                version,
              };
            }
            await transaction.put(
              "registerCatalog",
              catalogActiveKey(input.storeId),
              { revision: version.revision },
            );
            if (state.stagedRevision === version.revision) {
              await transaction.delete(
                "registerCatalog",
                catalogStagedKey(input.storeId),
              );
            }
            const compatibilitySnapshot: PosLocalRegisterCatalogSnapshot = {
              refreshedAt: version.persistedAt,
              rows: version.rows,
              schemaVersion: version.schemaVersion,
              storeId: input.storeId,
            };
            await transaction.put(
              "registerCatalog",
              input.storeId,
              compatibilitySnapshot,
            );
            await pruneUnreferencedCatalogVersions(transaction, input.storeId);
            return {
              revision: version.revision,
              status: "promoted" as const,
              version,
            };
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async pinRegisterCatalogVersion(input: {
      ownerId?: string;
      revision: PosRegisterCatalogRevision;
      rows: PosRegisterCatalogRowDto[];
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogPin>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            return pinCatalogInTransaction(transaction, input);
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async releaseRegisterCatalogPin(input: {
      ownerId?: string;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<null>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            await transaction.delete(
              "registerCatalog",
              catalogPinKey(input.storeId, input.terminalId, input.ownerId),
            );
            await pruneUnreferencedCatalogVersions(transaction, input.storeId);
            return null;
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async renewRegisterCatalogPinLease(input: {
      ownerId?: string;
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosLocalRegisterCatalogPin | null>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "registerCatalog"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const key = catalogPinKey(
              input.storeId,
              input.terminalId,
              input.ownerId,
            );
            const existing = await transaction.get<PosLocalRegisterCatalogPin>(
              "registerCatalog",
              key,
            );
            if (!existing) return null;
            const renewed = {
              ...existing,
              leaseExpiresAt: clock() + REGISTER_CATALOG_PIN_LEASE_MS,
            };
            await transaction.put("registerCatalog", key, renewed);
            return renewed;
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
              schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
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
              schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
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
              schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
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
          ["meta", "events", "readiness", "registerCatalog"],
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

    async readEventHistoryPage(input: {
      continuation?: PosLocalOpaqueContinuation;
      limit: number;
      storeId: string;
      terminalId: string;
    }): Promise<
      PosLocalStoreResult<{
        continuation?: PosLocalOpaqueContinuation;
        items: PosLocalEventRecord[];
      }>
    > {
      const afterSequence = decodeSequenceContinuation(
        "history",
        input.continuation,
      );
      if (afterSequence === null) return invalidContinuationFailure();
      try {
        const limit = Math.max(1, Math.min(input.limit, 500));
        const items = await options.adapter.transaction(
          "readonly",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return transaction.getAllFromIndex<PosLocalEventRecord>(
              "events",
              "by_terminal_sequence",
              {
                lower: [input.storeId, input.terminalId, afterSequence + 1],
                upper: [
                  input.storeId,
                  input.terminalId,
                  Number.MAX_SAFE_INTEGER,
                ],
              },
              limit,
            );
          },
        );
        const last = items.at(-1);
        return {
          ok: true,
          value: {
            items,
            ...(last && items.length === limit
              ? {
                  continuation: encodeSequenceContinuation(
                    "history",
                    last.sequence,
                  ),
                }
              : {}),
          },
        };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readLedgerSummary(input: {
      storeId: string;
      terminalId: string;
    }): Promise<PosLocalStoreResult<PosLocalLedgerSummary>> {
      try {
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            const range = {
              lower: [input.storeId, input.terminalId, 0],
              upper: [input.storeId, input.terminalId, Number.MAX_SAFE_INTEGER],
            };
            const [eventCount, oldest] = await Promise.all([
              transaction.countFromIndex(
                "events",
                "by_terminal_sequence",
                range,
              ),
              transaction.getAllFromIndex<PosLocalEventRecord>(
                "events",
                "by_terminal_sequence",
                range,
                1,
              ),
            ]);
            return {
              eventCount,
              ...(oldest[0] ? { oldestEventAt: oldest[0].createdAt } : {}),
            };
          },
        );
        return { ok: true as const, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async listEventsForUpload(input?: {
      afterSequence?: number;
      includeReviewEvents?: boolean;
      limit?: number;
      storeId?: string;
      terminalId?: string;
    }): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      if (!input?.storeId || !input.terminalId) return this.listEvents();
      try {
        const limit = Math.max(1, Math.min(input.limit ?? 250, 500));
        const value = await options.adapter.transaction(
          "readonly",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            const syncStatuses: PosLocalSyncEventStatus[] = [
              "pending",
              "syncing",
              "failed",
              ...(input.includeReviewEvents ? (["needs_review"] as const) : []),
            ];
            const activityStatuses: PosLocalActivityReportStatus[] = [
              "pending",
              "failed",
            ];
            const syncPages = await Promise.all(
              syncStatuses.map((status) =>
                transaction.getAllFromIndex<PosLocalEventRecord>(
                  "events",
                  "by_terminal_sync_status_sequence",
                  {
                    lower: [
                      input.storeId!,
                      input.terminalId!,
                      status,
                      (input.afterSequence ?? -1) + 1,
                    ],
                    upper: [
                      input.storeId!,
                      input.terminalId!,
                      status,
                      Number.MAX_SAFE_INTEGER,
                    ],
                  },
                  limit,
                ),
              ),
            );
            const activityPages = await Promise.all(
              activityStatuses.map((status) =>
                transaction.getAllFromIndex<PosLocalEventRecord>(
                  "events",
                  "by_terminal_activity_status_sequence",
                  {
                    lower: [
                      input.storeId!,
                      input.terminalId!,
                      status,
                      (input.afterSequence ?? -1) + 1,
                    ],
                    upper: [
                      input.storeId!,
                      input.terminalId!,
                      status,
                      Number.MAX_SAFE_INTEGER,
                    ],
                  },
                  limit,
                ),
              ),
            );
            return [...syncPages.flat(), ...activityPages.flat()]
              .filter(
                (event, index, events) =>
                  events.findIndex(
                    (candidate) =>
                      candidate.localEventId === event.localEventId,
                  ) === index,
              )
              .sort(comparePosLocalUploadOrder)
              .slice(0, limit);
          },
        );
        return { ok: true, value };
      } catch (error) {
        return toFailure(error);
      }
    },

    async readUploadCandidatePage(input: {
      continuation?: PosLocalOpaqueContinuation;
      limit: number;
      storeId: string;
      terminalId: string;
    }): Promise<
      PosLocalStoreResult<{
        continuation?: PosLocalOpaqueContinuation;
        items: PosLocalEventRecord[];
      }>
    > {
      const afterSequence = decodeSequenceContinuation(
        "upload",
        input.continuation,
      );
      if (afterSequence === null) {
        return invalidContinuationFailure();
      }
      const page = await this.listEventsForUpload({
        afterSequence,
        includeReviewEvents: true,
        limit: input.limit,
        storeId: input.storeId,
        terminalId: input.terminalId,
      });
      if (!page.ok) return page;
      const last = page.value.at(-1);
      return {
        ok: true,
        value: {
          items: page.value,
          ...(last &&
          page.value.length === Math.max(1, Math.min(input.limit, 500))
            ? {
                continuation: encodeSequenceContinuation(
                  "upload",
                  last.sequence,
                ),
              }
            : {}),
        },
      };
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
            const current = await transaction.get<PosLocalCloudMapping>(
              "mappings",
              mappingKey(mapping.entity, mapping.localId),
            );
            if (
              mapping.entity === "registerSession" &&
              mapping.registerCandidateState === "current" &&
              mapping.storeId &&
              mapping.terminalId
            ) {
              const scopeKey: IDBValidKey = [
                "registerSession",
                mapping.storeId,
                mapping.terminalId,
                ...(mapping.registerNumber !== undefined
                  ? [mapping.registerNumber]
                  : []),
                "current",
              ];
              const mappings = (
                await transaction.getAllFromIndex<PosLocalCloudMapping>(
                  "mappings",
                  mapping.registerNumber !== undefined
                    ? "by_register_full_scope_state"
                    : "by_register_scope_state",
                  { lower: scopeKey, upper: scopeKey },
                )
              ).filter(
                (candidate) =>
                  candidate.registerNumber === mapping.registerNumber,
              );
              for (const existing of mappings) {
                if (
                  existing.entity === "registerSession" &&
                  existing.localId !== mapping.localId &&
                  existing.registerCandidateState === "current" &&
                  existing.storeId === mapping.storeId &&
                  existing.terminalId === mapping.terminalId &&
                  existing.registerNumber === mapping.registerNumber
                ) {
                  await transaction.put(
                    "mappings",
                    mappingKey(existing.entity, existing.localId),
                    { ...existing, registerCandidateState: "historical" },
                  );
                }
              }
            }
            const next =
              current?.cloudId === mapping.cloudId
                ? { ...current, ...mapping }
                : mapping;
            await transaction.put(
              "mappings",
              mappingKey(mapping.entity, mapping.localId),
              next,
            );
            return next;
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
            const events = await readEventsByLocalIds(transaction, eventIds);
            const updated: PosLocalEventRecord[] = [];

            for (const event of events) {
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

    async markEventsActivityReported(
      eventIds: string[],
      reportOptions?: {
        reasonCode?: PosLocalActivityReportReasonCode;
        reportedAt?: number;
        status?: Extract<
          PosLocalActivityReportStatus,
          "reported" | "mapping_pending"
        >;
      },
    ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const events = await readEventsByLocalIds(transaction, eventIds);
            const updated: PosLocalEventRecord[] = [];
            const reportedAt = reportOptions?.reportedAt ?? clock();

            for (const event of events) {
              const nextEvent = {
                ...event,
                activity: normalizeActivityReportState({
                  reasonCode: reportOptions?.reasonCode,
                  reportedAt,
                  status: reportOptions?.status ?? "reported",
                }),
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

    async markEventsActivityFailed(
      eventIds: string[],
      failOptions: {
        attemptedAt?: number;
        reasonCode: PosLocalActivityReportReasonCode;
      },
    ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const events = await readEventsByLocalIds(transaction, eventIds);
            const updated: PosLocalEventRecord[] = [];
            const attemptedAt = failOptions.attemptedAt ?? clock();

            for (const event of events) {
              const nextEvent = {
                ...event,
                activity: normalizeActivityReportState({
                  attemptedAt,
                  reasonCode: failOptions.reasonCode,
                  status: "failed",
                }),
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

    async readMappingPage(input: {
      continuation?: PosLocalOpaqueContinuation;
      limit: number;
      storeId: string;
      terminalId: string;
    }): Promise<
      PosLocalStoreResult<{
        continuation?: PosLocalOpaqueContinuation;
        items: PosLocalCloudMapping[];
      }>
    > {
      const afterLocalId = decodeMappingContinuation(input.continuation);
      if (afterLocalId === null) return invalidContinuationFailure();
      try {
        const limit = Math.max(1, Math.min(input.limit, 500));
        const items = await options.adapter.transaction(
          "readonly",
          ["meta", "mappings"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readonly");
            return transaction.getAllFromIndex<PosLocalCloudMapping>(
              "mappings",
              "by_terminal_mapping_local_id",
              {
                lower: [
                  input.storeId,
                  input.terminalId,
                  afterLocalId ? `${afterLocalId}\u0000` : "",
                ],
                upper: [input.storeId, input.terminalId, "\uffff"],
              },
              limit,
            );
          },
        );
        const last = items.at(-1);
        return {
          ok: true,
          value: {
            items,
            ...(last && items.length === limit
              ? { continuation: encodeMappingContinuation(last.localId) }
              : {}),
          },
        };
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
            const events = await readEventsByLocalIds(transaction, eventIds);
            const updated: PosLocalEventRecord[] = [];

            for (const event of events) {
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

    async clearLocalReviewEvents(
      eventIds: string[],
      clearOptions?: {
        reason?: PosLocalReviewResolutionReason;
        serverConfirmedAt?: number;
      },
    ): Promise<PosLocalStoreResult<PosLocalEventRecord[]>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events"],
          async (transaction) => {
            await ensureSupportedSchema(transaction, "readwrite");
            const events = await readEventsByLocalIds(transaction, eventIds);
            const updated: PosLocalEventRecord[] = [];
            const resolvedAt = clock();

            for (const event of events) {
              if (event.sync.status !== "needs_review") continue;
              const eventWithoutProof = omitStaffProofToken(event);
              const nextEvent = {
                ...eventWithoutProof,
                sync: {
                  ...event.sync,
                  error: undefined,
                  localResolution: {
                    reason: clearOptions?.reason ?? "terminal_recovery_command",
                    resolvedAt,
                    status: "local_review_cleared" as const,
                    // Only stamped once the server has acknowledged the
                    // resolution, so an un-round-tripped clear stays unconverged.
                    ...(typeof clearOptions?.serverConfirmedAt === "number"
                      ? { serverConfirmedAt: clearOptions.serverConfirmedAt }
                      : {}),
                  },
                  status: "locally_resolved" as const,
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

    async purgeSettledLedgerEvents(input: {
      activeLocalRegisterSessionId?: string;
    }): Promise<PosLocalStoreResult<PosLocalLedgerPurgeResult>> {
      try {
        const value = await options.adapter.transaction(
          "readwrite",
          ["meta", "events", "authority", "cashierPresence", "mappings"],
          async (transaction): Promise<PosLocalLedgerPurgeResult> => {
            await ensureSupportedSchema(transaction, "readwrite");

            // Whole-store safety gate reused from the terminal-clear preflight:
            // never purge while a cashier is actively signed in. The clear
            // preflight's events>0 and blanket authority>0 refusals are
            // deliberately NOT reused — they would always block a selective
            // purge — so authority is instead consulted per event below.
            const presenceRecords =
              await transaction.getAll<unknown>("cashierPresence");
            if (presenceRecords.some(isCashierPresenceRecord)) {
              return { status: "blocked", reason: "active_presence" };
            }

            // Sessions that still hold a drawer-authority record are treated as
            // referenced (workflow dependency), so their events are retained.
            const authorityRecords =
              await transaction.getAll<unknown>("authority");
            const sessionsWithLiveAuthority = new Set<string>();
            for (const record of authorityRecords) {
              const localRegisterSessionId =
                extractDrawerAuthorityRegisterSessionId(record);
              if (localRegisterSessionId) {
                sessionsWithLiveAuthority.add(localRegisterSessionId);
              }
            }

            // Register sessions still marked "current" are never past the
            // retention boundary, even if the caller omits the active id — this
            // makes the purge self-protective against an under-specified caller.
            const mappingRecords =
              await transaction.getAll<PosLocalCloudMapping>("mappings");
            const currentRegisterSessionIds = new Set<string>();
            for (const mapping of mappingRecords) {
              if (
                mapping.entity === "registerSession" &&
                mapping.registerCandidateState === "current"
              ) {
                currentRegisterSessionIds.add(mapping.localId);
              }
            }

            const events =
              await transaction.getAll<PosLocalEventRecord>("events");
            const purgedSequences: number[] = [];
            let retainedCount = 0;

            for (const event of events) {
              const sessionId = event.localRegisterSessionId;
              // The retention boundary: events for the active register session
              // (or any session still marked "current", and events with no
              // session anchor) stay; only events from a prior/rolled-over
              // session are purge candidates.
              const pastRetentionBoundary = Boolean(
                sessionId &&
                  sessionId !== input.activeLocalRegisterSessionId &&
                  !currentRegisterSessionIds.has(sessionId),
              );
              const assessment = assessPosLocalLedgerRetention({
                activityStatus: event.activity?.status,
                // Receipts become server-canonical once the sale is synced;
                // the local ledger holds no receipt store the purge could strand.
                hasReceiptDependency: false,
                hasWorkflowDependency: Boolean(
                  sessionId && sessionsWithLiveAuthority.has(sessionId),
                ),
                requiresActivitySettlement:
                  canReportPosRegisterSessionLocalActivityType(event.type),
                syncStatus: event.sync.status,
                uploadDeferred:
                  event.validationMetadata?.uploadDeferredUntil ===
                  "app-session-validated",
                // Never purge a locally-cleared review the server has not yet
                // confirmed — the local record is needed to converge next sync.
                serverConfirmedResolution:
                  typeof event.sync.localResolution?.serverConfirmedAt ===
                  "number",
                pastRetentionBoundary,
              });

              if (assessment.eligible) {
                await transaction.delete("events", String(event.sequence));
                purgedSequences.push(event.sequence);
              } else {
                retainedCount += 1;
              }
            }

            return {
              status: "completed",
              purgedCount: purgedSequences.length,
              purgedSequences: purgedSequences.sort((left, right) => left - right),
              retainedCount,
            };
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

async function readEventsByLocalIds(
  transaction: PosLocalStoreTransaction,
  eventIds: readonly string[],
) {
  const events = await Promise.all(
    [...new Set(eventIds)].map((eventId) =>
      transaction.getFromIndex<PosLocalEventRecord>(
        "events",
        "by_local_event_id",
        eventId,
      ),
    ),
  );
  return events.filter((event): event is PosLocalEventRecord => Boolean(event));
}

function comparePosLocalUploadOrder(
  left: PosLocalEventRecord,
  right: PosLocalEventRecord,
) {
  return (
    left.sequence - right.sequence ||
    left.localEventId.localeCompare(right.localEventId)
  );
}

function encodeSequenceContinuation(
  kind: "history" | "upload",
  sequence: number,
): PosLocalOpaqueContinuation {
  return `idb10:${kind}:${sequence}` as PosLocalOpaqueContinuation;
}

function decodeSequenceContinuation(
  kind: "history" | "upload",
  continuation: PosLocalOpaqueContinuation | undefined,
): number | null {
  if (!continuation) return -1;
  const match = new RegExp(`^idb10:${kind}:(\\d+)$`).exec(continuation);
  if (!match) return null;
  const sequence = Number(match[1]);
  return Number.isSafeInteger(sequence) && sequence >= 0 ? sequence : null;
}

function encodeMappingContinuation(
  localId: string,
): PosLocalOpaqueContinuation {
  return `idb10:mapping:${encodeURIComponent(localId)}` as PosLocalOpaqueContinuation;
}

function decodeMappingContinuation(
  continuation: PosLocalOpaqueContinuation | undefined,
) {
  if (!continuation) return "";
  const match = /^idb10:mapping:(.+)$/.exec(continuation);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return null;
  }
}

function invalidContinuationFailure(): PosLocalStoreResult<never> {
  return {
    ok: false,
    error: {
      code: "read_failed",
      message: "POS local storage continuation is invalid.",
    },
  };
}

async function migrateLegacyLogicalRecords(
  transaction: PosLocalStoreTransaction,
) {
  const recordStores = POS_LOCAL_OBJECT_STORE_NAMES.filter(
    (storeName) => storeName !== "meta",
  );
  for (const storeName of recordStores) {
    const [keys, records] = await Promise.all([
      transaction.getAllKeys(storeName),
      transaction.getAll<unknown>(storeName),
    ]);
    if (keys.length !== records.length) {
      throw new Error("POS local logical migration inspection was incomplete.");
    }
    for (let index = 0; index < records.length; index += 1) {
      const record = records[index];
      if (!record || typeof record !== "object") continue;
      const current = record as Record<string, unknown>;
      await transaction.put(storeName, keys[index], {
        ...current,
        ...(Object.hasOwn(current, "schemaVersion")
          ? { schemaVersion: POS_LOCAL_LOGICAL_RECORD_VERSION }
          : {}),
        logicalRecordVersion: POS_LOCAL_LOGICAL_RECORD_VERSION,
      });
    }
  }
}

function normalizeActivityReportState(
  state: PosLocalActivityReportState,
): PosLocalActivityReportState {
  return {
    ...(typeof state.attemptedAt === "number" &&
    Number.isFinite(state.attemptedAt)
      ? { attemptedAt: state.attemptedAt }
      : {}),
    ...(isLocalActivityReasonCode(state.reasonCode)
      ? { reasonCode: state.reasonCode }
      : {}),
    ...(typeof state.reportedAt === "number" &&
    Number.isFinite(state.reportedAt)
      ? { reportedAt: state.reportedAt }
      : {}),
    status: isLocalActivityReportStatus(state.status)
      ? state.status
      : "pending",
  };
}

function isLocalActivityReportStatus(
  status: unknown,
): status is PosLocalActivityReportStatus {
  return (
    status === "pending" ||
    status === "reported" ||
    status === "mapping_pending" ||
    status === "failed"
  );
}

function isLocalActivityReasonCode(
  reasonCode: unknown,
): reasonCode is PosLocalActivityReportReasonCode {
  return (
    reasonCode === "unsupported_event_type" ||
    reasonCode === "missing_register_session" ||
    reasonCode === "missing_expense_session" ||
    reasonCode === "metadata_rejected" ||
    reasonCode === "mapping_missing" ||
    reasonCode === "network_error" ||
    reasonCode === "server_rejected" ||
    reasonCode === "unknown"
  );
}

function mappingKey(entity: PosLocalEntityKind, localId: string) {
  return `${entity}:${localId}`;
}

function isBusinessOperationalEvent(type: PosLocalEventType) {
  return type !== "terminal.seeded";
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

function drawerAuthorityMatchesReadInput(
  state: PosDrawerAuthorityState,
  input: {
    cloudRegisterSessionId?: string;
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  },
) {
  const registerSessionIds = new Set(
    [input.localRegisterSessionId, input.cloudRegisterSessionId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    ),
  );

  return (
    state.storeId === input.storeId &&
    state.terminalId === input.terminalId &&
    (registerSessionIds.has(state.localRegisterSessionId) ||
      (state.cloudRegisterSessionId
        ? registerSessionIds.has(state.cloudRegisterSessionId)
        : false))
  );
}

function drawerAuthorityMatchesExactLocalInput(
  state: PosDrawerAuthorityState,
  input: {
    localRegisterSessionId: string;
    storeId: string;
    terminalId: string;
  },
) {
  return (
    state.storeId === input.storeId &&
    state.terminalId === input.terminalId &&
    state.localRegisterSessionId === input.localRegisterSessionId
  );
}

function readinessKey(storeId: string, operatingDate: string) {
  return `${storeId}:${operatingDate}`;
}

function uploadSequenceKey(scopeId: string) {
  return `${META_UPLOAD_SEQUENCE_PREFIX}${scopeId}`;
}

function getUploadSequenceScopeId(input: PosLocalAppendEventInput) {
  if (input.type.startsWith("expense.")) {
    const localExpenseSessionId = getExpenseLocalSessionId(input);
    return localExpenseSessionId
      ? `expense:${input.storeId}:${input.terminalId}:${localExpenseSessionId}`
      : undefined;
  }

  return input.localRegisterSessionId;
}

function getExpenseLocalSessionId(input: PosLocalAppendEventInput) {
  if (input.localExpenseSessionId) return input.localExpenseSessionId;
  if (!input.type.startsWith("expense.")) return undefined;
  const payload = asRecord(input.payload);
  return trimmedStringToOptional(payload.localExpenseSessionId);
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

function normalizeLocalEventPayload(input: PosLocalAppendEventInput) {
  if (input.type === "pending_checkout_item.defined") {
    return normalizePendingCheckoutItemDefinedPayload(input.payload);
  }

  return input.payload;
}

function normalizePendingCheckoutItemDefinedPayload(
  value: unknown,
): PosLocalSyncPendingCheckoutItemDefinedPayload {
  const payload = asRecord(value);
  const lookupCode = trimmedStringToOptional(payload.lookupCode);
  const searchContext = normalizePendingCheckoutItemSearchContext(
    payload.searchContext,
  );
  const localMetadata = normalizePendingCheckoutItemLocalMetadata(
    payload.localMetadata,
  );

  return {
    localPendingCheckoutItemId: stringOrEmpty(
      payload.localPendingCheckoutItemId,
    ),
    name: stringOrEmpty(payload.name),
    ...(lookupCode ? { lookupCode } : {}),
    ...(searchContext ? { searchContext } : {}),
    price: numberOrZero(payload.price),
    quantitySold: numberOrZero(payload.quantitySold),
    ...(localMetadata ? { localMetadata } : {}),
  };
}

function normalizePendingCheckoutItemSearchContext(
  value: unknown,
): PosLocalSyncPendingCheckoutItemSearchContext | undefined {
  const context = asRecord(value);
  const query = trimmedStringToOptional(context.query);
  const source = pendingCheckoutSearchSourceOrUndefined(context.source);
  const matched = pendingCheckoutSearchMatchOrUndefined(context.matched);

  if (!query && !source && !matched) return undefined;

  return {
    ...(query ? { query } : {}),
    ...(source ? { source } : {}),
    ...(matched ? { matched } : {}),
  };
}

function normalizePendingCheckoutItemLocalMetadata(
  value: unknown,
): PosLocalSyncPendingCheckoutItemLocalMetadata | undefined {
  const metadata = asRecord(value);
  const source = pendingCheckoutMetadataSourceOrUndefined(metadata.source);
  const appSessionValidation = pendingCheckoutAppSessionValidationOrUndefined(
    metadata.appSessionValidation,
  );
  const cloudValidation =
    metadata.cloudValidation === "uncertain"
      ? metadata.cloudValidation
      : undefined;
  const reusedExistingPendingItem =
    typeof metadata.reusedExistingPendingItem === "boolean"
      ? metadata.reusedExistingPendingItem
      : undefined;
  const createdOffline =
    typeof metadata.createdOffline === "boolean"
      ? metadata.createdOffline
      : undefined;

  if (
    !source &&
    reusedExistingPendingItem === undefined &&
    createdOffline === undefined &&
    !appSessionValidation &&
    !cloudValidation
  ) {
    return undefined;
  }

  return {
    schema: "pos_pending_checkout_item_local_metadata_v1",
    ...(source ? { source } : {}),
    ...(reusedExistingPendingItem !== undefined
      ? { reusedExistingPendingItem }
      : {}),
    ...(createdOffline !== undefined ? { createdOffline } : {}),
    ...(appSessionValidation ? { appSessionValidation } : {}),
    ...(cloudValidation ? { cloudValidation } : {}),
  };
}

function pendingCheckoutSearchSourceOrUndefined(value: unknown) {
  return value === "barcode" ||
    value === "lookup_code" ||
    value === "manual" ||
    value === "catalog_search" ||
    value === "unknown"
    ? value
    : undefined;
}

function pendingCheckoutSearchMatchOrUndefined(value: unknown) {
  return value === "existing_product" ||
    value === "pending_checkout_item" ||
    value === "none" ||
    value === "unknown"
    ? value
    : undefined;
}

function pendingCheckoutMetadataSourceOrUndefined(value: unknown) {
  return value === "offline_search" ||
    value === "online_search" ||
    value === "manual_entry" ||
    value === "unknown"
    ? value
    : undefined;
}

function pendingCheckoutAppSessionValidationOrUndefined(value: unknown) {
  return value === "supported" || value === "unverified" ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function trimmedStringToOptional(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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

function matchesActiveCashierPresenceScope(
  record: PosLocalActiveCashierPresenceRecord,
  scope: {
    operatingDate: string;
    organizationId?: string;
    storeId: string;
    terminalId: string;
  },
) {
  return (
    record.operatingDate === scope.operatingDate &&
    (!scope.organizationId || record.organizationId === scope.organizationId) &&
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
        ? {
            message:
              "Drawer setup changed. Open a current drawer before selling.",
          }
        : state.reason === "lifecycle_rejected"
          ? { message: "Drawer sync needs review before selling can continue." }
          : {}),
  };
}

function mergeDrawerAuthorityState(
  current: PosDrawerAuthorityState | null,
  incoming: PosDrawerAuthorityState,
): PosDrawerAuthorityState {
  const envelope = current ? toDrawerAuthorityEnvelope(current) : null;
  if (isLocalReviewAuthorityState(incoming)) {
    return buildEffectiveDrawerAuthorityState({
      base: { ...(envelope ?? incoming), ...incoming },
      localReviewAuthority: {
        ...(incoming.message ? { message: incoming.message } : {}),
        observedAt: incoming.observedAt,
        reason: incoming.reason,
        status: "blocked",
      },
    });
  }

  return buildEffectiveDrawerAuthorityState({
    base: { ...(envelope ?? incoming), ...incoming },
    serverAuthority:
      incoming.serverAuthority ??
      ({
        classification:
          incoming.status === "healthy" ? "sale_usable" : "sale_blocked",
        ...(incoming.cloudRegisterSessionId
          ? { cloudRegisterSessionId: incoming.cloudRegisterSessionId }
          : {}),
        ...(incoming.message ? { message: incoming.message } : {}),
        observedAt: incoming.observedAt,
        ...(incoming.reason === "cloud_closed" ||
        incoming.reason === "authority_unknown"
          ? { reason: incoming.reason }
          : {}),
        source: "legacy_runtime_directive",
        status: incoming.status,
      } satisfies PosRegisterLifecycleServerAuthority),
  });
}

function toDrawerAuthorityEnvelope(
  state: PosDrawerAuthorityState,
): PosDrawerAuthorityState {
  if (state.serverAuthority || state.localReviewAuthority) {
    return buildEffectiveDrawerAuthorityState({ base: state });
  }
  return mergeDrawerAuthorityState(null, state);
}

function buildEffectiveDrawerAuthorityState(input: {
  base: PosDrawerAuthorityState;
  localReviewAuthority?: PosDrawerLocalReviewAuthority | null;
  serverAuthority?: PosRegisterLifecycleServerAuthority | null;
}): PosDrawerAuthorityState {
  const localReviewAuthority =
    input.localReviewAuthority === undefined
      ? input.base.localReviewAuthority
      : (input.localReviewAuthority ?? undefined);
  const serverAuthority =
    input.serverAuthority === undefined
      ? input.base.serverAuthority
      : (input.serverAuthority ?? undefined);
  const effective = localReviewAuthority ?? serverAuthority;
  return normalizeDrawerAuthorityState({
    localRegisterSessionId: input.base.localRegisterSessionId,
    observedAt: effective?.observedAt ?? input.base.observedAt,
    status: effective?.status ?? input.base.status,
    storeId: input.base.storeId,
    terminalId: input.base.terminalId,
    ...(input.base.registerNumber
      ? { registerNumber: input.base.registerNumber }
      : {}),
    ...(serverAuthority?.cloudRegisterSessionId
      ? { cloudRegisterSessionId: serverAuthority.cloudRegisterSessionId }
      : input.base.cloudRegisterSessionId
        ? { cloudRegisterSessionId: input.base.cloudRegisterSessionId }
        : {}),
    ...(effective?.message ? { message: effective.message } : {}),
    ...(effective?.reason ? { reason: effective.reason } : {}),
    ...(localReviewAuthority ? { localReviewAuthority } : {}),
    ...(serverAuthority ? { serverAuthority } : {}),
  });
}

function isLocalReviewAuthorityState(
  state: PosDrawerAuthorityState,
): state is PosDrawerAuthorityState & {
  reason: PosDrawerLocalReviewAuthority["reason"];
  status: "blocked";
} {
  return (
    state.status === "blocked" &&
    !state.serverAuthority &&
    (state.reason === "lifecycle_rejected" ||
      state.reason === "authority_unknown")
  );
}

function toServerAuthority(
  observation: PosRegisterLifecycleAuthorityObservation,
): PosRegisterLifecycleServerAuthority {
  return {
    classification: observation.classification,
    ...(observation.cloudRegisterSessionId
      ? { cloudRegisterSessionId: observation.cloudRegisterSessionId }
      : {}),
    ...(observation.cursor ? { cursor: observation.cursor } : {}),
    ...(observation.message ? { message: observation.message } : {}),
    observedAt: observation.observedAt,
    ...(observation.reason ? { reason: observation.reason } : {}),
    source: observation.source,
    status: observation.status,
  };
}

function registerAuthorityMappingMatchesExpectation(input: {
  expected?: {
    cloudRegisterSessionId?: string;
    mappedAt?: number;
    mappingAuthorityRevision?: number;
    registerCandidateState?: "current" | "historical";
    registerNumber?: string;
    storeId?: string;
    terminalId?: string;
  };
  mapping?: PosLocalCloudMapping;
  observation: PosRegisterLifecycleAuthorityObservation;
}) {
  if (input.observation.source === "dedicated_snapshot" && !input.expected) {
    return false;
  }
  if (!input.expected) {
    return (
      !input.mapping ||
      !input.observation.cloudRegisterSessionId ||
      input.mapping.cloudId === input.observation.cloudRegisterSessionId
    );
  }
  if (!input.mapping || input.mapping.entity !== "registerSession") {
    return false;
  }
  if (
    input.expected.cloudRegisterSessionId !== undefined &&
    input.mapping.cloudId !== input.expected.cloudRegisterSessionId
  ) {
    return false;
  }
  if (
    input.expected.mappedAt !== undefined &&
    input.mapping.mappedAt !== input.expected.mappedAt
  ) {
    return false;
  }
  if (
    Object.hasOwn(input.expected, "mappingAuthorityRevision") &&
    input.mapping.mappingAuthorityRevision !==
      input.expected.mappingAuthorityRevision
  ) {
    return false;
  }
  if (
    Object.hasOwn(input.expected, "registerCandidateState") &&
    input.mapping.registerCandidateState !==
      input.expected.registerCandidateState
  ) {
    return false;
  }
  if (
    Object.hasOwn(input.expected, "registerNumber") &&
    input.mapping.registerNumber !== input.expected.registerNumber
  ) {
    return false;
  }
  if (
    Object.hasOwn(input.expected, "storeId") &&
    input.mapping.storeId !== input.expected.storeId
  ) {
    return false;
  }
  if (
    Object.hasOwn(input.expected, "terminalId") &&
    input.mapping.terminalId !== input.expected.terminalId
  ) {
    return false;
  }
  return true;
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
    Record<string, unknown> | undefined;

  return (
    Array.isArray(record.activeRoles) &&
    record.activeRoles.every(
      (role) => role === "cashier" || role === "manager",
    ) &&
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

function extractDrawerAuthorityRegisterSessionId(
  value: unknown,
): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  return typeof record.localRegisterSessionId === "string" &&
    record.localRegisterSessionId.length > 0 &&
    typeof record.status === "string"
    ? record.localRegisterSessionId
    : null;
}

function isCashierPresenceRecord(
  value: unknown,
): value is PosLocalActiveCashierPresenceRecord {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  const wrappedProof = record.wrappedPosLocalStaffProof as
    Record<string, unknown> | undefined;

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
  openBlockedTimeoutMs?: number;
}): PosLocalStorageAdapter {
  const databaseName = options?.databaseName ?? "athena-pos-local";
  const openBlockedTimeoutMs = options?.openBlockedTimeoutMs ?? 5_000;

  async function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const request = indexedDB.open(
        databaseName,
        POS_LOCAL_STORE_SCHEMA_VERSION,
      );
      let blockedTimeout: ReturnType<typeof setTimeout> | undefined;

      const rejectOnce = (error: unknown) => {
        if (settled) return;
        settled = true;
        if (blockedTimeout) globalThis.clearTimeout(blockedTimeout);
        reject(error);
      };

      request.onupgradeneeded = () => {
        upgradeIndexedDbPosLocalStore(request);
      };
      request.onblocked = () => {
        blockedTimeout ??= globalThis.setTimeout(
          () => rejectOnce(openBlockedError()),
          openBlockedTimeoutMs,
        );
      };
      request.onerror = () => rejectOnce(request.error);
      request.onsuccess = () => {
        const database = request.result;
        // An IDB open request cannot be cancelled. If a blocked request later
        // succeeds after this attempt settled, close its connection so a retry
        // can select a fresh generation without leaking an upgrade blocker.
        if (settled) {
          database.close();
          return;
        }
        const missingStoreNames = POS_LOCAL_OBJECT_STORE_NAMES.filter(
          (storeName) => !database.objectStoreNames.contains(storeName),
        );

        if (missingStoreNames.length > 0) {
          database.close();
          rejectOnce(
            new PosLocalStoreMissingObjectStoresError(missingStoreNames),
          );
          return;
        }

        settled = true;
        globalThis.clearTimeout(blockedTimeout);
        resolve(database);
      };
    });
  }

  return {
    async transaction<T>(
      mode: "readonly" | "readwrite",
      storeNames: PosLocalObjectStoreName[],
      callback: (transaction: PosLocalStoreTransaction) => Promise<T>,
    ): Promise<T> {
      let database: IDBDatabase;
      try {
        database = await openDatabase();
      } catch (error) {
        throw wrapPosLocalStoreOperationError(mode, error);
      }

      try {
        return await new Promise<T>((resolve, reject) => {
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
            getAllKeys(storeName) {
              return new Promise((innerResolve, innerReject) => {
                const request = transaction.objectStore(storeName).getAllKeys();
                request.onerror = () => innerReject(request.error);
                request.onsuccess = () =>
                  innerResolve(request.result.map(String));
              });
            },
            getFromIndex(storeName, indexName, key) {
              return new Promise((innerResolve, innerReject) => {
                const request = transaction
                  .objectStore(storeName)
                  .index(indexName)
                  .get(key);
                request.onerror = () => innerReject(request.error);
                request.onsuccess = () => innerResolve(request.result);
              });
            },
            getAllFromIndex(storeName, indexName, range, limit) {
              return new Promise((innerResolve, innerReject) => {
                const index = transaction
                  .objectStore(storeName)
                  .index(indexName);
                const keyRange = IDBKeyRange.bound(range.lower, range.upper);
                const request =
                  limit === undefined
                    ? index.getAll(keyRange)
                    : index.getAll(keyRange, limit);
                request.onerror = () => innerReject(request.error);
                request.onsuccess = () => innerResolve(request.result);
              });
            },
            countFromIndex(storeName, indexName, range) {
              return new Promise((innerResolve, innerReject) => {
                const index = transaction
                  .objectStore(storeName)
                  .index(indexName);
                const request = index.count(
                  IDBKeyRange.bound(range.lower, range.upper),
                );
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
      } catch (error) {
        throw wrapPosLocalStoreOperationError(mode, error);
      } finally {
        database.close();
      }
    },
  };
}

function openBlockedError() {
  return new DOMException(
    "POS local storage is open in another tab. Close other Athena POS tabs and retry.",
    "AbortError",
  );
}

function upgradeIndexedDbPosLocalStore(request: IDBOpenDBRequest) {
  const database = request.result;
  for (const storeName of POS_LOCAL_OBJECT_STORE_NAMES) {
    if (!database.objectStoreNames.contains(storeName)) {
      database.createObjectStore(storeName);
    }
  }
  const events = request.transaction?.objectStore("events");
  if (!events) return;
  if (!events.indexNames.contains("by_local_event_id")) {
    events.createIndex("by_local_event_id", "localEventId", { unique: true });
  }
  if (!events.indexNames.contains("by_terminal_sequence")) {
    events.createIndex("by_terminal_sequence", [
      "storeId",
      "terminalId",
      "sequence",
    ]);
  }
  if (!events.indexNames.contains("by_terminal_sync_status_sequence")) {
    events.createIndex("by_terminal_sync_status_sequence", [
      "storeId",
      "terminalId",
      "sync.status",
      "sequence",
    ]);
  }
  if (!events.indexNames.contains("by_terminal_activity_status_sequence")) {
    events.createIndex("by_terminal_activity_status_sequence", [
      "storeId",
      "terminalId",
      "activity.status",
      "sequence",
    ]);
  }
  const mappings = request.transaction?.objectStore("mappings");
  if (mappings && !mappings.indexNames.contains("by_register_scope_state")) {
    mappings.createIndex("by_register_scope_state", [
      "entity",
      "storeId",
      "terminalId",
      "registerCandidateState",
    ]);
  }
  if (
    mappings &&
    !mappings.indexNames.contains("by_register_full_scope_state")
  ) {
    mappings.createIndex("by_register_full_scope_state", [
      "entity",
      "storeId",
      "terminalId",
      "registerNumber",
      "registerCandidateState",
    ]);
  }
  if (
    mappings &&
    !mappings.indexNames.contains("by_terminal_mapping_local_id")
  ) {
    mappings.createIndex("by_terminal_mapping_local_id", [
      "storeId",
      "terminalId",
      "localId",
    ]);
  }
}

export function clearIndexedDbPosLocalStore(options?: {
  databaseName?: string;
}): Promise<PosLocalStoreResult<null>> {
  const databaseName = options?.databaseName ?? "athena-pos-local";

  if (typeof indexedDB === "undefined") {
    return Promise.resolve({
      ok: false,
      error: {
        code: "write_failed",
        message: "POS local storage is unavailable in this browser.",
      },
    });
  }

  return assertCanClearIndexedDbPosLocalStore({ databaseName }).then(
    (preflight) => {
      if (!preflight.ok) {
        return preflight;
      }

      return deleteIndexedDbPosLocalStore(databaseName);
    },
  );
}

function assertCanClearIndexedDbPosLocalStore(options: {
  databaseName: string;
}): Promise<PosLocalStoreResult<null>> {
  return inspectIndexedDbStoresForClear(options.databaseName)
    .then(
      ({
        authorityRecords,
        cashierPresenceRecords,
        events,
        protectedRecords,
      }) => {
        if (events.length > 0) {
          return blockedLocalClear(
            "POS local state has sale or register records that may not be synced. Use terminal health or support recovery before clearing this terminal.",
          );
        }

        if (authorityRecords.length > 0) {
          return blockedLocalClear(
            "POS local state has drawer or terminal authority records. Use terminal health or support recovery before clearing this terminal.",
          );
        }

        if (cashierPresenceRecords.some(isCashierPresenceRecord)) {
          return blockedLocalClear(
            "POS local state has an active cashier sign-in. Sign out or use terminal health before clearing this terminal.",
          );
        }

        if (protectedRecords.length > 0) {
          return blockedLocalClear(
            "POS local state contains terminal, authority, readiness, mapping, or snapshot evidence. Use terminal health or support recovery before clearing this terminal.",
          );
        }

        return { ok: true as const, value: null };
      },
    )
    .catch(() =>
      blockedLocalClear(
        "POS local state could not be inspected. Use terminal health or support recovery before clearing this terminal.",
      ),
    );
}

function inspectIndexedDbStoresForClear(databaseName: string): Promise<{
  authorityRecords: unknown[];
  cashierPresenceRecords: unknown[];
  events: unknown[];
  protectedRecords: unknown[];
}> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(
      databaseName,
      POS_LOCAL_STORE_SCHEMA_VERSION,
    );

    request.onupgradeneeded = () => {
      upgradeIndexedDbPosLocalStore(request);
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const storeNames = POS_LOCAL_OBJECT_STORE_NAMES.filter(
        (storeName) =>
          storeName !== "meta" && database.objectStoreNames.contains(storeName),
      );

      if (storeNames.length === 0) {
        database.close();
        resolve({
          authorityRecords: [],
          cashierPresenceRecords: [],
          events: [],
          protectedRecords: [],
        });
        return;
      }

      const transaction = database.transaction(storeNames, "readonly");
      const records = new Map<string, unknown[]>();
      let remaining = storeNames.length;

      const finishStore = (storeName: string, value: unknown[]) => {
        records.set(storeName, value);
        remaining -= 1;
        if (remaining === 0) {
          database.close();
          resolve({
            authorityRecords: records.get("authority") ?? [],
            cashierPresenceRecords: records.get("cashierPresence") ?? [],
            events: records.get("events") ?? [],
            protectedRecords: storeNames
              .filter(
                (storeName) =>
                  storeName !== "authority" &&
                  storeName !== "cashierPresence" &&
                  storeName !== "events",
              )
              .flatMap((storeName) => records.get(storeName) ?? []),
          });
        }
      };

      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };

      for (const storeName of storeNames) {
        const getAllRequest = transaction.objectStore(storeName).getAll();
        getAllRequest.onerror = () => {
          database.close();
          reject(getAllRequest.error);
        };
        getAllRequest.onsuccess = () => {
          finishStore(storeName, getAllRequest.result);
        };
      }
    };
  });
}

function blockedLocalClear(message: string): PosLocalStoreResult<null> {
  return {
    ok: false,
    error: {
      code: "write_failed",
      message,
    },
  };
}

function deleteIndexedDbPosLocalStore(databaseName: string) {
  return new Promise<PosLocalStoreResult<null>>((resolve) => {
    const request = indexedDB.deleteDatabase(databaseName);

    request.onsuccess = () => {
      resolve({ ok: true, value: null });
    };
    request.onerror = () => {
      resolve({
        ok: false,
        error: {
          code: "write_failed",
          message: "POS local state could not be cleared.",
        },
      });
    };
    request.onblocked = () => {
      resolve({
        ok: false,
        error: {
          code: "write_failed",
          message:
            "POS local state is open in another tab. Close other Athena POS tabs and try again.",
        },
      });
    };
  });
}

export function createMemoryPosLocalStorageAdapter(options?: {
  schemaVersion?: number;
  logicalRecordVersion?: number;
  failNextPutForStore?: PosLocalObjectStoreName;
}): PosLocalStorageAdapter {
  let failNextPutForStore = options?.failNextPutForStore;
  const data = createEmptyMemoryStore();
  let writeQueue = Promise.resolve();

  if (options?.schemaVersion !== undefined) {
    data.meta.set(META_SCHEMA_VERSION_KEY, options.schemaVersion);
  }
  if (options?.logicalRecordVersion !== undefined) {
    data.meta.set(
      META_LOGICAL_RECORD_VERSION_KEY,
      options.logicalRecordVersion,
    );
  }

  return {
    async transaction(_mode, _storeNames, callback) {
      const run = async () => {
        const transactionData = cloneMemoryStore(data);
        const transaction: PosLocalStoreTransaction = {
          async get<T>(storeName: PosLocalObjectStoreName, key: string) {
            return cloneValue(transactionData[storeName].get(key)) as
              T | undefined;
          },
          async getAll<T>(storeName: PosLocalObjectStoreName) {
            return Array.from(transactionData[storeName].values()).map(
              (value) => cloneValue(value),
            ) as T[];
          },
          async getAllKeys(storeName: PosLocalObjectStoreName) {
            return Array.from(transactionData[storeName].keys());
          },
          async getFromIndex<T>(
            storeName: PosLocalObjectStoreName,
            indexName: string,
            key: IDBValidKey,
          ) {
            return findMemoryIndexValues(
              transactionData[storeName],
              indexName,
              key,
            )[0] as T | undefined;
          },
          async getAllFromIndex<T>(
            storeName: PosLocalObjectStoreName,
            indexName: string,
            range: { lower: IDBValidKey; upper: IDBValidKey },
            limit?: number,
          ) {
            const values = findMemoryIndexValues(
              transactionData[storeName],
              indexName,
              range,
            );
            return (
              limit === undefined ? values : values.slice(0, limit)
            ) as T[];
          },
          async countFromIndex(storeName, indexName, range) {
            return findMemoryIndexValues(
              transactionData[storeName],
              indexName,
              range,
            ).length;
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

        const result = await callback(transaction).catch((error) => {
          throw wrapPosLocalStoreOperationError(_mode, error);
        });
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

function findMemoryIndexValues(
  values: Map<string, unknown>,
  indexName: string,
  query: IDBValidKey | { lower: IDBValidKey; upper: IDBValidKey },
) {
  return [...values.values()]
    .map((value) => ({ key: memoryIndexKey(value, indexName), value }))
    .filter(
      (entry): entry is { key: IDBValidKey; value: unknown } =>
        entry.key !== undefined && indexQueryIncludes(query, entry.key),
    )
    .sort((left, right) => compareIndexKeys(left.key, right.key))
    .map((entry) => cloneValue(entry.value));
}

function memoryIndexKey(
  value: unknown,
  indexName: string,
): IDBValidKey | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as PosLocalEventRecord;
  switch (indexName) {
    case "by_local_event_id":
      return record.localEventId;
    case "by_terminal_sequence":
      return [record.storeId, record.terminalId, record.sequence];
    case "by_terminal_sync_status_sequence":
      return [
        record.storeId,
        record.terminalId,
        record.sync?.status,
        record.sequence,
      ];
    case "by_terminal_activity_status_sequence":
      return record.activity
        ? [
            record.storeId,
            record.terminalId,
            record.activity.status,
            record.sequence,
          ]
        : undefined;
    case "by_register_scope_state": {
      const mapping = value as PosLocalCloudMapping;
      return [
        mapping.entity,
        mapping.storeId ?? "",
        mapping.terminalId ?? "",
        mapping.registerCandidateState ?? "",
      ];
    }
    case "by_register_full_scope_state": {
      const mapping = value as PosLocalCloudMapping;
      return mapping.registerNumber === undefined
        ? undefined
        : [
            mapping.entity,
            mapping.storeId ?? "",
            mapping.terminalId ?? "",
            mapping.registerNumber,
            mapping.registerCandidateState ?? "",
          ];
    }
    case "by_terminal_mapping_local_id": {
      const mapping = value as PosLocalCloudMapping;
      return mapping.storeId && mapping.terminalId
        ? [mapping.storeId, mapping.terminalId, mapping.localId]
        : undefined;
    }
    default:
      return undefined;
  }
}

function indexQueryIncludes(
  query: IDBValidKey | { lower: IDBValidKey; upper: IDBValidKey },
  key: IDBValidKey,
) {
  if (query && typeof query === "object" && "lower" in query) {
    return (
      compareIndexKeys(query.lower, key) <= 0 &&
      compareIndexKeys(key, query.upper) <= 0
    );
  }
  return compareIndexKeys(query as IDBValidKey, key) === 0;
}

function compareIndexKeys(left: IDBValidKey, right: IDBValidKey): number {
  if (Array.isArray(left) && Array.isArray(right)) {
    for (
      let index = 0;
      index < Math.max(left.length, right.length);
      index += 1
    ) {
      const compared = compareIndexKeys(left[index] ?? "", right[index] ?? "");
      if (compared !== 0) return compared;
    }
    return 0;
  }
  if (typeof left === "number" && typeof right === "number")
    return left - right;
  return String(left).localeCompare(String(right));
}

function wrapPosLocalStoreOperationError(
  mode: "readonly" | "readwrite",
  error: unknown,
) {
  if (
    error instanceof PosLocalStoreSchemaError ||
    error instanceof PosLocalStoreLogicalRecordVersionError ||
    error instanceof PosLocalStoreMissingObjectStoresError ||
    error instanceof PosLocalStoreOperationError
  ) {
    return error;
  }
  return new PosLocalStoreOperationError(mode, error);
}

function classifyPosLocalStoreErrorCode(
  nativeName: string,
  mode?: "readonly" | "readwrite",
): PosLocalStoreErrorCode {
  switch (nativeName) {
    case "QuotaExceededError":
      return "quota_exceeded";
    case "ConstraintError":
    case "DataCloneError":
      return "corruption";
    case "AbortError":
    case "TransactionInactiveError":
      return "contention";
    case "InvalidStateError":
    case "NotFoundError":
    case "SecurityError":
      return "unavailable";
    case "VersionError":
      return "unsupported_schema_version";
    default:
      return mode === "readonly" ? "read_failed" : "write_failed";
  }
}

function safePosLocalStoreFailureMessage(code: PosLocalStoreErrorCode) {
  switch (code) {
    case "quota_exceeded":
      return "POS local storage is full. Free device storage and retry.";
    case "contention":
      return "POS local storage is busy. Retry the operation.";
    case "corruption":
      return "POS local storage needs support attention.";
    case "maintenance":
      return "POS local storage maintenance is in progress.";
    case "unavailable":
      return "POS local storage is unavailable.";
    case "read_failed":
      return "POS local storage could not be read.";
    case "missing_object_stores":
    case "unsupported_logical_record_version":
    case "unsupported_schema_version":
    case "write_failed":
      return "POS local storage could not save this operation.";
  }
}
