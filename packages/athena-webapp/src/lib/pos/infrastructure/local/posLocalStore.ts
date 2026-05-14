export const POS_LOCAL_STORE_SCHEMA_VERSION = 1;

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

export interface PosProvisionedTerminalSeed {
  terminalId: string;
  cloudTerminalId: string;
  syncSecretHash: string;
  storeId: string;
  registerNumber?: string;
  displayName: string;
  provisionedAt: number;
  schemaVersion: number;
}

export interface PosLocalEventRecord {
  localEventId: string;
  schemaVersion: number;
  sequence: number;
  type: PosLocalEventType;
  terminalId: string;
  storeId: string;
  registerNumber?: string;
  localRegisterSessionId?: string;
  localPosSessionId?: string;
  localTransactionId?: string;
  staffProfileId?: string;
  staffProofToken?: string;
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
  | "meta"
  | "terminalSeed"
  | "events"
  | "mappings";

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
  payload: unknown;
};

const META_SCHEMA_VERSION_KEY = "schemaVersion";
const META_SEQUENCE_KEY = "sequence";
const TERMINAL_SEED_KEY = "current";

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
    const event: PosLocalEventRecord = {
      localEventId: createLocalId("event"),
      schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
      sequence: nextSequence,
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
      ...(input.staffProofToken
        ? { staffProofToken: input.staffProofToken }
        : {}),
      payload: input.payload,
      createdAt: clock(),
      sync: { status: "pending" },
    };

    await transaction.put("events", String(nextSequence), event);
    await transaction.put("meta", META_SEQUENCE_KEY, nextSequence);
    return event;
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

export function createIndexedDbPosLocalStorageAdapter(options?: {
  databaseName?: string;
}): PosLocalStorageAdapter {
  const databaseName = options?.databaseName ?? "athena-pos-local";

  async function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);

      request.onupgradeneeded = () => {
        const database = request.result;
        for (const storeName of [
          "meta",
          "terminalSeed",
          "events",
          "mappings",
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
    meta: new Map(),
    terminalSeed: new Map(),
    events: new Map(),
    mappings: new Map(),
  };
}

function cloneMemoryStore(store: MemoryStore): MemoryStore {
  return {
    meta: new Map(store.meta),
    terminalSeed: new Map(store.terminalSeed),
    events: new Map(store.events),
    mappings: new Map(store.mappings),
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
