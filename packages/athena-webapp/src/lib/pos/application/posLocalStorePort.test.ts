import { describe, expect, it } from "vitest";

import type { PosLocalStorePort } from "./posLocalStorePort";
import type {
  PosLocalActiveCashierPresenceRecord,
  PosDrawerAuthorityState,
  PosLocalCloudMapping,
  PosLocalEventRecord,
  PosLocalOpaqueContinuation,
  PosLocalRegisterAvailabilitySnapshot,
  PosLocalRegisterCatalogSnapshot,
  PosLocalRegisterCatalogPin,
  PosLocalRegisterCatalogVersion,
  PosLocalRegisterServiceCatalogSnapshot,
  PosLocalStaffAuthorityRecord,
  PosLocalStoreDayReadiness,
  PosLocalStoreResult,
  PosProvisionedTerminalSeed,
  PosRegisterLifecycleAuthorityApplyResult,
  PosRegisterLifecycleAuthorityObservation,
  PosTerminalIntegrityState,
} from "./posLocalStoreTypes";

type ConformancePort = PosLocalStorePort;

type SemanticState = {
  authority: Map<string, PosDrawerAuthorityState>;
  availability: Map<string, PosLocalRegisterAvailabilitySnapshot>;
  catalog: Map<string, PosLocalRegisterCatalogSnapshot>;
  catalogActive: Map<string, number | "legacy">;
  catalogPins: Map<string, PosLocalRegisterCatalogPin>;
  catalogStaged: Map<string, number>;
  catalogVersions: Map<string, PosLocalRegisterCatalogVersion>;
  events: PosLocalEventRecord[];
  integrity: Map<string, PosTerminalIntegrityState>;
  mappings: Map<string, PosLocalCloudMapping>;
  presence: Map<string, PosLocalActiveCashierPresenceRecord>;
  readiness: Map<string, PosLocalStoreDayReadiness>;
  seed: PosProvisionedTerminalSeed | null;
  serviceCatalog: Map<string, PosLocalRegisterServiceCatalogSnapshot>;
  staff: Map<string, PosLocalStaffAuthorityRecord>;
  initialized: boolean;
  resetAt?: number;
};

/**
 * Test-only reference engine expressed entirely in POS semantics. It has no
 * key-value adapter, object stores, SQL schema, cursor, or transaction API.
 */
function createSemanticMemoryEngine(): ConformancePort & {
  failNextDurableCommit(): void;
} {
  let state: SemanticState = {
    authority: new Map(),
    availability: new Map(),
    catalog: new Map(),
    catalogActive: new Map(),
    catalogPins: new Map(),
    catalogStaged: new Map(),
    catalogVersions: new Map(),
    events: [],
    integrity: new Map(),
    mappings: new Map(),
    presence: new Map(),
    readiness: new Map(),
    seed: null,
    serviceCatalog: new Map(),
    staff: new Map(),
    initialized: false,
  };
  let failNextCommit = false;

  function failure<T>(): PosLocalStoreResult<T> {
    return {
      ok: false,
      error: {
        code: "write_failed",
        message: "POS local storage commit failed.",
      },
    };
  }

  function publish<T>(
    change: (draft: SemanticState) => T,
  ): PosLocalStoreResult<T> {
    const draft: SemanticState = {
      authority: new Map(state.authority),
      availability: new Map(state.availability),
      catalog: new Map(state.catalog),
      catalogActive: new Map(state.catalogActive),
      catalogPins: new Map(state.catalogPins),
      catalogStaged: new Map(state.catalogStaged),
      catalogVersions: new Map(state.catalogVersions),
      events: structuredClone(state.events),
      integrity: new Map(state.integrity),
      mappings: new Map(state.mappings),
      presence: new Map(state.presence),
      readiness: new Map(state.readiness),
      seed: state.seed ? { ...state.seed } : null,
      serviceCatalog: new Map(state.serviceCatalog),
      staff: new Map(state.staff),
      initialized: state.initialized,
      resetAt: state.resetAt,
    };
    const value = change(draft);
    if (failNextCommit) {
      failNextCommit = false;
      return failure();
    }
    state = draft;
    return { ok: true, value };
  }

  function updateEvents(
    eventIds: string[],
    update: (event: PosLocalEventRecord) => PosLocalEventRecord,
  ): PosLocalStoreResult<PosLocalEventRecord[]> {
    return publish((draft) => {
      const ids = new Set(eventIds);
      const changed: PosLocalEventRecord[] = [];
      draft.events = draft.events.map((event) => {
        if (!ids.has(event.localEventId)) return event;
        const next = update(event);
        changed.push(next);
        return next;
      });
      return structuredClone(changed);
    });
  }

  function catalogVersionKey(storeId: string, revision: number | "legacy") {
    return `${storeId}:${revision}`;
  }

  function catalogPinKey(storeId: string, terminalId: string) {
    return `${storeId}:${terminalId}`;
  }

  const engine: ConformancePort & { failNextDurableCommit(): void } = {
    failNextDurableCommit() {
      failNextCommit = true;
    },

    async initializeStorage() {
      return publish((draft) => {
        draft.initialized = true;
        return { logicalRecordVersion: 1 };
      });
    },

    async resetRegisterOperationalStateForAuthorityCutover() {
      if (state.resetAt !== undefined) {
        return {
          ok: true,
          value: { status: "already_applied" as const, resetAt: state.resetAt },
        };
      }
      return publish((draft) => {
        const deletedAuthorityCount = draft.authority.size;
        const deletedEventCount = draft.events.length;
        const deletedMappingCount = draft.mappings.size;
        draft.authority.clear();
        draft.events = [];
        draft.mappings.clear();
        draft.resetAt = 1;
        return {
          status: "applied" as const,
          deletedAuthorityCount,
          deletedEventCount,
          deletedMappingCount,
          resetAt: 1,
        };
      });
    },

    async appendEvent(input) {
      return publish((draft) => {
        const event: PosLocalEventRecord = {
          ...structuredClone(input),
          ...(input.catalogPin
            ? { catalogRevision: input.catalogPin.revision }
            : {}),
          activity: { status: "pending" },
          createdAt: draft.events.length + 1,
          localEventId: `event-${draft.events.length + 1}`,
          schemaVersion: 1,
          sequence: draft.events.length + 1,
          sync: { status: input.initialSyncStatus ?? "pending" },
        };
        if (input.catalogPin) {
          const versionKey = catalogVersionKey(
            input.storeId,
            input.catalogPin.revision,
          );
          if (!draft.catalogVersions.has(versionKey)) {
            draft.catalogVersions.set(versionKey, {
              persistedAt: draft.events.length + 1,
              revision: input.catalogPin.revision,
              rows: structuredClone(input.catalogPin.rows),
              schemaVersion: 1,
              storeId: input.storeId,
            });
          }
          draft.catalogPins.set(
            catalogPinKey(input.storeId, input.terminalId),
            {
              pinnedAt: draft.events.length + 1,
              revision: input.catalogPin.revision,
              storeId: input.storeId,
              terminalId: input.terminalId,
            },
          );
        }
        draft.events.push(event);
        return structuredClone(event);
      });
    },

    async listEvents() {
      return { ok: true, value: structuredClone(state.events) };
    },

    async listEventsForUpload(input = {}) {
      const statuses = new Set([
        "pending",
        "syncing",
        "failed",
        ...(input.includeReviewEvents ? ["needs_review"] : []),
      ]);
      return {
        ok: true,
        value: structuredClone(
          state.events
            .filter(
              (event) =>
                statuses.has(event.sync.status) &&
                (!input.storeId || event.storeId === input.storeId) &&
                (!input.terminalId || event.terminalId === input.terminalId),
            )
            .slice(0, input.limit),
        ),
      };
    },

    async readEventHistoryPage(input) {
      return page(
        state.events.filter(
          (event) =>
            event.storeId === input.storeId &&
            event.terminalId === input.terminalId,
        ),
        input,
      );
    },

    async readLedgerSummary(input) {
      const events = state.events.filter(
        (event) =>
          event.storeId === input.storeId &&
          event.terminalId === input.terminalId,
      );
      return {
        ok: true,
        value: {
          eventCount: events.length,
          ...(events[0] ? { oldestEventAt: events[0].createdAt } : {}),
        },
      };
    },

    async readUploadCandidatePage(input) {
      return page(
        state.events.filter(
          (event) =>
            event.storeId === input.storeId &&
            event.terminalId === input.terminalId &&
            ["pending", "syncing", "failed"].includes(event.sync.status),
        ),
        input,
      );
    },

    async markEventsSynced(eventIds, options = {}) {
      return updateEvents(eventIds, (event) => ({
        ...event,
        sync: { status: "synced", uploaded: options.uploaded },
      }));
    },

    async markEventsNeedsReview(eventIds, error, options = {}) {
      return updateEvents(eventIds, (event) => ({
        ...event,
        sync: {
          error,
          status: "needs_review",
          uploaded: options.uploaded,
        },
      }));
    },

    async clearLocalReviewEvents(eventIds, options = {}) {
      return updateEvents(eventIds, (event) => ({
        ...event,
        sync: {
          ...event.sync,
          error: undefined,
          localResolution: {
            reason: options.reason ?? "terminal_recovery_command",
            resolvedAt: 1,
            status: "local_review_cleared",
          },
          status: "locally_resolved",
        },
      }));
    },

    async markEventsActivityFailed(eventIds, options) {
      return updateEvents(eventIds, (event) => ({
        ...event,
        activity: {
          attemptedAt: options.attemptedAt,
          reasonCode: options.reasonCode,
          status: "failed",
        },
      }));
    },

    async markEventsActivityReported(eventIds, options = {}) {
      return updateEvents(eventIds, (event) => ({
        ...event,
        activity: {
          reasonCode: options.reasonCode,
          reportedAt: options.reportedAt,
          status: options.status ?? "reported",
        },
      }));
    },

    async attachStaffProofTokenToPendingEvents(input) {
      return publish((draft) => {
        let count = 0;
        draft.events = draft.events.map((event) => {
          if (
            event.staffProfileId !== input.staffProfileId ||
            event.staffProofToken ||
            event.sync.status === "synced"
          )
            return event;
          count += 1;
          return { ...event, staffProofToken: input.staffProofToken };
        });
        return count;
      });
    },

    async readProvisionedTerminalSeed() {
      return { ok: true, value: state.seed ? { ...state.seed } : null };
    },

    async writeProvisionedTerminalSeed(seed) {
      return publish((draft) => {
        draft.seed = { ...seed };
        return { ...seed };
      });
    },

    async writeProvisionedTerminalSeedAndClearTerminalIntegrity({ seed }) {
      return publish((draft) => {
        draft.seed = { ...seed };
        draft.integrity.delete(integrityKey(seed));
        return { ...seed };
      });
    },

    async listLocalCloudMappings() {
      return {
        ok: true,
        value: [...state.mappings.values()].map((mapping) => ({ ...mapping })),
      };
    },

    async readMappingPage(input) {
      return page(
        [...state.mappings.values()].filter(
          (mapping) =>
            mapping.storeId === input.storeId &&
            mapping.terminalId === input.terminalId,
        ),
        input,
      );
    },

    async readLocalCloudMapping(input) {
      const mapping = state.mappings.get(
        mappingKey(input.entity, input.localId),
      );
      return { ok: true, value: mapping ? { ...mapping } : null };
    },

    async writeLocalCloudMapping(mapping) {
      return publish((draft) => {
        const value = { ...mapping };
        draft.mappings.set(mappingKey(mapping.entity, mapping.localId), value);
        return value;
      });
    },

    async readTerminalIntegrityState(input) {
      const value = state.integrity.get(integrityKey(input));
      return { ok: true, value: value ? { ...value } : null };
    },

    async writeTerminalIntegrityState(value) {
      return publish((draft) => {
        draft.integrity.set(integrityKey(value), { ...value });
        return { ...value };
      });
    },

    async clearTerminalIntegrityState(input) {
      return publish((draft) => {
        draft.integrity.delete(integrityKey(input));
        return null;
      });
    },

    async readStoreDayReadiness(input) {
      const value = state.readiness.get(readinessKey(input));
      return { ok: true, value: value ? { ...value } : null };
    },

    async writeStoreDayReadiness(value) {
      return publish((draft) => {
        draft.readiness.set(readinessKey(value), { ...value });
        return { ...value };
      });
    },

    async readRegisterCatalogSnapshot({ storeId }) {
      const value = state.catalog.get(storeId);
      return { ok: true, value: value ? structuredClone(value) : null };
    },

    async readRegisterCatalogVersionState({ storeId }) {
      const activeRevision =
        state.catalogActive.get(storeId) ??
        (state.catalog.has(storeId) ? "legacy" : null);
      const stagedRevision = state.catalogStaged.get(storeId) ?? null;
      const legacy = state.catalog.get(storeId);
      const active =
        activeRevision === null
          ? null
          : (state.catalogVersions.get(
              catalogVersionKey(storeId, activeRevision),
            ) ??
            (legacy
              ? {
                  persistedAt: legacy.refreshedAt,
                  revision: "legacy" as const,
                  rows: legacy.rows,
                  schemaVersion: legacy.schemaVersion,
                  storeId,
                }
              : null));
      const staged =
        stagedRevision === null
          ? null
          : (state.catalogVersions.get(
              catalogVersionKey(storeId, stagedRevision),
            ) ?? null);
      return {
        ok: true,
        value: structuredClone({
          active,
          activeRevision,
          staged,
          stagedRevision,
        }),
      };
    },

    async readRegisterCatalogSelection({ storeId, terminalId }) {
      const pin = terminalId
        ? state.catalogPins.get(catalogPinKey(storeId, terminalId))
        : null;
      if (pin) {
        return {
          ok: true,
          value: structuredClone(
            state.catalogVersions.get(catalogVersionKey(storeId, pin.revision)) ??
              null,
          ),
        };
      }
      const versionState = await engine.readRegisterCatalogVersionState({
        storeId,
      });
      return versionState.ok
        ? { ok: true, value: versionState.value.active }
        : versionState;
    },

    async readRegisterCatalogPin({ storeId, terminalId }) {
      return {
        ok: true,
        value: structuredClone(
          state.catalogPins.get(catalogPinKey(storeId, terminalId)) ?? null,
        ),
      };
    },

    async stageRegisterCatalogVersion({ revision, rows, storeId }) {
      return publish((draft) => {
        const newest = Math.max(
          typeof draft.catalogActive.get(storeId) === "number"
            ? (draft.catalogActive.get(storeId) as number)
            : -1,
          draft.catalogStaged.get(storeId) ?? -1,
        );
        const winnerRevision = newest > revision ? newest : revision;
        const key = catalogVersionKey(storeId, winnerRevision);
        let version = draft.catalogVersions.get(key);
        if (!version) {
          version = {
            persistedAt: 1,
            revision,
            rows: structuredClone(rows),
            schemaVersion: 1,
            storeId,
          };
          draft.catalogVersions.set(
            catalogVersionKey(storeId, revision),
            version,
          );
        }
        if (newest > revision) {
          return {
            revision: winnerRevision,
            status: "already_newer" as const,
            version,
          };
        }
        const status =
          draft.catalogStaged.get(storeId) === revision
            ? ("already_current" as const)
            : ("staged" as const);
        draft.catalogStaged.set(storeId, revision);
        return { revision, status, version };
      });
    },

    async promoteRegisterCatalogVersion({ revision, storeId }) {
      return publish((draft) => {
        const activeRevision = draft.catalogActive.get(storeId);
        const activeVersion =
          activeRevision === undefined
            ? undefined
            : draft.catalogVersions.get(
                catalogVersionKey(storeId, activeRevision),
              );
        if (
          typeof activeRevision === "number" &&
          activeRevision > revision &&
          activeVersion
        ) {
          return {
            revision: activeRevision,
            status: "already_newer" as const,
            version: activeVersion,
          };
        }
        const version = draft.catalogVersions.get(
          catalogVersionKey(storeId, revision),
        );
        if (!version) throw new Error("Missing staged catalog version");
        const status =
          activeRevision === revision
            ? ("already_current" as const)
            : ("promoted" as const);
        draft.catalogActive.set(storeId, revision);
        if (draft.catalogStaged.get(storeId) === revision)
          draft.catalogStaged.delete(storeId);
        draft.catalog.set(storeId, {
          refreshedAt: version.persistedAt,
          rows: structuredClone(version.rows),
          schemaVersion: version.schemaVersion,
          storeId,
        });
        return { revision, status, version };
      });
    },

    async pinRegisterCatalogVersion({ revision, rows, storeId, terminalId }) {
      return publish((draft) => {
        const versionKey = catalogVersionKey(storeId, revision);
        if (!draft.catalogVersions.has(versionKey)) {
          draft.catalogVersions.set(versionKey, {
            persistedAt: 1,
            revision,
            rows: structuredClone(rows),
            schemaVersion: 1,
            storeId,
          });
        }
        const pin = { pinnedAt: 1, revision, storeId, terminalId };
        draft.catalogPins.set(catalogPinKey(storeId, terminalId), pin);
        return pin;
      });
    },

    async releaseRegisterCatalogPin({ storeId, terminalId }) {
      return publish((draft) => {
        draft.catalogPins.delete(catalogPinKey(storeId, terminalId));
        return null;
      });
    },

    async writeRegisterCatalogSnapshot({ rows, storeId }) {
      return publish((draft) => {
        const value = { refreshedAt: 1, rows, schemaVersion: 1, storeId };
        draft.catalog.set(storeId, structuredClone(value));
        return value;
      });
    },

    async readRegisterServiceCatalogSnapshot({ storeId }) {
      const value = state.serviceCatalog.get(storeId);
      return { ok: true, value: value ? structuredClone(value) : null };
    },

    async writeRegisterServiceCatalogSnapshot({ rows, storeId }) {
      return publish((draft) => {
        const value = { refreshedAt: 1, rows, schemaVersion: 1, storeId };
        draft.serviceCatalog.set(storeId, structuredClone(value));
        return value;
      });
    },

    async readRegisterAvailabilitySnapshot({ storeId }) {
      const value = state.availability.get(storeId);
      return { ok: true, value: value ? structuredClone(value) : null };
    },

    async writeRegisterAvailabilitySnapshot({ rows, storeId }) {
      return publish((draft) => {
        const value = { refreshedAt: 1, rows, schemaVersion: 1, storeId };
        draft.availability.set(storeId, structuredClone(value));
        return value;
      });
    },

    async replaceStaffAuthoritySnapshot(input) {
      return publish((draft) => {
        for (const [key, record] of draft.staff) {
          if (
            record.storeId === input.storeId &&
            record.terminalId === input.terminalId
          )
            draft.staff.delete(key);
        }
        for (const record of input.records)
          draft.staff.set(staffKey(record), structuredClone(record));
        return structuredClone(input.records);
      });
    },

    async upsertStaffAuthorityRecord({ record, storeId, terminalId }) {
      const value = { ...record, storeId, terminalId };
      return publish((draft) => {
        draft.staff.set(staffKey(value), structuredClone(value));
        return structuredClone(value);
      });
    },

    async readStaffAuthorityForUsername(input) {
      const value = [...state.staff.values()].find(
        (record) =>
          record.storeId === input.storeId &&
          record.terminalId === input.terminalId &&
          record.username === input.username &&
          record.status === "active" &&
          record.expiresAt > (input.now ?? Date.now()),
      );
      return { ok: true, value: value ? structuredClone(value) : null };
    },

    async getStaffAuthorityReadiness(input) {
      const matching = [...state.staff.values()].filter(
        (record) =>
          record.storeId === input.storeId &&
          record.terminalId === input.terminalId &&
          record.status === "active",
      );
      if (matching.length === 0) return { ok: true, value: "missing" as const };
      return {
        ok: true,
        value: matching.some(
          (record) => record.expiresAt > (input.now ?? Date.now()),
        )
          ? ("ready" as const)
          : ("expired" as const),
      };
    },

    async writeCashierPresence(value) {
      return publish((draft) => {
        draft.presence.set(presenceKey(value), structuredClone(value));
        return structuredClone(value);
      });
    },

    async readCashierPresence(input) {
      const value = state.presence.get(presenceKey(input));
      return {
        ok: true,
        value:
          value && value.expiresAt > (input.now ?? Date.now())
            ? structuredClone(value)
            : null,
      };
    },

    async readActiveCashierPresence(input) {
      const candidates = [...state.presence.values()].filter(
        (presence) =>
          presence.operatingDate === input.operatingDate &&
          presence.storeId === input.storeId &&
          presence.terminalId === input.terminalId &&
          (!input.organizationId ||
            presence.organizationId === input.organizationId) &&
          presence.expiresAt > (input.now ?? Date.now()),
      );
      return {
        ok: true,
        value: candidates[0] ? structuredClone(candidates[0]) : null,
      };
    },

    async clearCashierPresence(input) {
      return publish((draft) => {
        draft.presence.delete(presenceKey(input));
        return null;
      });
    },

    async invalidateCashierPresenceForTerminal(input) {
      return publish((draft) => {
        let count = 0;
        for (const [key, presence] of draft.presence) {
          if (
            presence.terminalId === input.terminalId &&
            (!input.storeId || presence.storeId === input.storeId) &&
            (!input.organizationId ||
              presence.organizationId === input.organizationId)
          ) {
            draft.presence.delete(key);
            count += 1;
          }
        }
        return count;
      });
    },

    async readDrawerAuthorityState(input) {
      const authority = state.authority.get(authorityKey(input));
      if (
        authority &&
        input.cloudRegisterSessionId &&
        authority.cloudRegisterSessionId !== input.cloudRegisterSessionId
      ) {
        return { ok: true, value: null };
      }
      return { ok: true, value: authority ? structuredClone(authority) : null };
    },

    async writeDrawerAuthorityState(authority) {
      return publish((draft) => {
        const value = structuredClone(authority);
        draft.authority.set(authorityKey(authority), value);
        return value;
      });
    },

    async clearDrawerAuthorityState(input) {
      return publish((draft) => {
        draft.authority.delete(authorityKey(input));
        return null;
      });
    },

    async clearLocalDrawerReviewAuthorityState(input) {
      return publish((draft) => {
        const key = authorityKey(input);
        const current = draft.authority.get(key);
        if (current) {
          const next = { ...current };
          delete next.localReviewAuthority;
          draft.authority.set(key, effectiveAuthority(next));
        }
        return null;
      });
    },

    async applyRegisterLifecycleAuthority(input) {
      const mapping = state.mappings.get(
        mappingKey("registerSession", input.observation.localRegisterSessionId),
      );
      if (!mappingMatches(input.expectedMapping, mapping, input.observation)) {
        return {
          ok: true,
          value: { disposition: "rejected", reason: "mapping_invalidated" },
        };
      }
      if (
        input.observation.cursor &&
        mapping?.mappingAuthorityRevision !== undefined &&
        input.observation.cursor.mappingAuthorityRevision <
          mapping.mappingAuthorityRevision
      ) {
        return {
          ok: true,
          value: { disposition: "noop", reason: "stale" },
        };
      }

      const key = authorityKey({
        localRegisterSessionId: input.observation.localRegisterSessionId,
        storeId: input.storeId,
        terminalId: input.terminalId,
      });
      const current = state.authority.get(key);
      const decision = compareAuthority(
        current?.serverAuthority,
        input.observation,
      );
      if (decision !== "apply") {
        return { ok: true, value: { disposition: "noop", reason: decision } };
      }

      return publish((draft): PosRegisterLifecycleAuthorityApplyResult => {
        const next = effectiveAuthority({
          ...current,
          localRegisterSessionId: input.observation.localRegisterSessionId,
          observedAt: input.observation.observedAt,
          registerNumber: input.observation.registerNumber,
          status: input.observation.status,
          storeId: input.storeId,
          terminalId: input.terminalId,
          serverAuthority: {
            classification: input.observation.classification,
            cloudRegisterSessionId: input.observation.cloudRegisterSessionId,
            cursor: input.observation.cursor,
            message: input.observation.message,
            observedAt: input.observation.observedAt,
            reason: input.observation.reason,
            source: input.observation.source,
            status: input.observation.status,
          },
        });
        draft.authority.set(key, next);
        if (mapping && input.observation.cursor) {
          draft.mappings.set(mappingKey(mapping.entity, mapping.localId), {
            ...mapping,
            mappingAuthorityRevision:
              input.observation.cursor.mappingAuthorityRevision,
          });
        }
        return { disposition: "applied", reason: "committed", value: next };
      });
    },
  };

  return engine;
}

describe("POS local-store application port conformance", () => {
  it("is implemented by an independent semantic engine", async () => {
    const engine = createSemanticMemoryEngine();
    await expect(engine.writeProvisionedTerminalSeed(seed())).resolves.toEqual({
      ok: true,
      value: seed(),
    });
    await expect(engine.readProvisionedTerminalSeed()).resolves.toEqual({
      ok: true,
      value: seed(),
    });

    await expect(engine.writeLocalCloudMapping(mapping())).resolves.toEqual({
      ok: true,
      value: mapping(),
    });
    await expect(
      engine.readLocalCloudMapping({
        entity: "registerSession",
        localId: "local-register-1",
      }),
    ).resolves.toEqual({ ok: true, value: mapping() });
  });

  it("fails durable writes without publishing partial state", async () => {
    const engine = createSemanticMemoryEngine();
    engine.failNextDurableCommit();
    await expect(
      engine.writeProvisionedTerminalSeed(seed()),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "write_failed" },
    });
    await expect(engine.readProvisionedTerminalSeed()).resolves.toEqual({
      ok: true,
      value: null,
    });

    engine.failNextDurableCommit();
    await expect(engine.appendEvent(eventInput())).resolves.toMatchObject({
      ok: false,
      error: { code: "write_failed" },
    });
    await expect(engine.listEvents()).resolves.toEqual({ ok: true, value: [] });
  });

  it("supports event history, upload selection, and event lifecycle outcomes", async () => {
    const engine = createSemanticMemoryEngine();
    await engine.appendEvent(eventInput());
    await engine.appendEvent({
      ...eventInput(),
      payload: { item: 2 },
      staffProfileId: "staff-1",
    });
    await expect(
      engine.readEventHistoryPage({
        limit: 1,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { continuation: "1", items: [{ localEventId: "event-1" }] },
    });
    await expect(
      engine.readLedgerSummary({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { eventCount: 2, oldestEventAt: 1 },
    });
    await expect(
      engine.attachStaffProofTokenToPendingEvents({
        staffProfileId: "staff-1",
        staffProofToken: "proof",
      }),
    ).resolves.toEqual({ ok: true, value: 2 });
    await engine.markEventsNeedsReview(["event-1"], "review");
    await expect(engine.listEventsForUpload()).resolves.toMatchObject({
      ok: true,
      value: [{ localEventId: "event-2", staffProofToken: "proof" }],
    });
    await engine.clearLocalReviewEvents(["event-1"]);
    await engine.markEventsActivityReported(["event-2"], { reportedAt: 3 });
    await expect(engine.markEventsSynced(["event-2"])).resolves.toMatchObject({
      ok: true,
      value: [{ activity: { status: "reported" }, sync: { status: "synced" } }],
    });
  });

  it("supports terminal integrity and operating-day readiness", async () => {
    const engine = createSemanticMemoryEngine();
    const integrity = terminalIntegrity();
    const readiness = storeReadiness();
    await engine.writeTerminalIntegrityState(integrity);
    await engine.writeStoreDayReadiness(readiness);
    await expect(
      engine.readTerminalIntegrityState({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: integrity });
    await expect(
      engine.readStoreDayReadiness({
        operatingDate: "2026-07-10",
        storeId: "store-1",
      }),
    ).resolves.toEqual({ ok: true, value: readiness });
    await engine.clearTerminalIntegrityState(integrity);
    await expect(engine.readTerminalIntegrityState(integrity)).resolves.toEqual(
      { ok: true, value: null },
    );
  });

  it("supports catalog snapshot outcomes without exposing layout mechanics", async () => {
    const engine = createSemanticMemoryEngine();
    await engine.writeRegisterCatalogSnapshot({ rows: [], storeId: "store-1" });
    await engine.writeRegisterServiceCatalogSnapshot({
      rows: [],
      storeId: "store-1",
    });
    await engine.writeRegisterAvailabilitySnapshot({
      rows: [],
      storeId: "store-1",
    });
    await expect(
      Promise.all([
        engine.readRegisterCatalogSnapshot({ storeId: "store-1" }),
        engine.readRegisterServiceCatalogSnapshot({ storeId: "store-1" }),
        engine.readRegisterAvailabilitySnapshot({ storeId: "store-1" }),
      ]),
    ).resolves.toEqual([
      { ok: true, value: snapshot("store-1") },
      { ok: true, value: snapshot("store-1") },
      { ok: true, value: snapshot("store-1") },
    ]);
  });

  it("expresses revision staging, promotion, and runtime selection semantically", async () => {
    const engine = createSemanticMemoryEngine();
    await engine.writeRegisterCatalogSnapshot({ rows: [], storeId: "store-1" });
    await expect(
      engine.readRegisterCatalogVersionState({ storeId: "store-1" }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({ activeRevision: "legacy" }),
    });

    const staged = await engine.stageRegisterCatalogVersion({
      revision: 0,
      rows: [],
      storeId: "store-1",
    });
    expect(staged).toEqual({
      ok: true,
      value: expect.objectContaining({ status: "staged", revision: 0 }),
    });
    await engine.promoteRegisterCatalogVersion({
      revision: 0,
      storeId: "store-1",
    });
    await engine.pinRegisterCatalogVersion({
      revision: 0,
      rows: [],
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    await expect(
      engine.readRegisterCatalogSelection({
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: expect.objectContaining({ revision: 0 }),
    });
  });

  it("supports staff authority and terminal-scoped cashier presence", async () => {
    const engine = createSemanticMemoryEngine();
    const staff = staffAuthority();
    const presence = cashierPresence();
    await engine.replaceStaffAuthoritySnapshot({
      records: [staff],
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    await engine.writeCashierPresence(presence);
    await expect(
      engine.getStaffAuthorityReadiness({
        now: 2,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: "ready" });
    await expect(
      engine.readStaffAuthorityForUsername({
        now: 2,
        storeId: "store-1",
        terminalId: "terminal-1",
        username: "cashier",
      }),
    ).resolves.toEqual({ ok: true, value: staff });
    await expect(
      engine.readActiveCashierPresence({
        now: 2,
        operatingDate: "2026-07-10",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: presence });
    await expect(
      engine.invalidateCashierPresenceForTerminal({ terminalId: "terminal-1" }),
    ).resolves.toEqual({ ok: true, value: 1 });
  });

  it("supports initialization and idempotent compatibility reset outcomes", async () => {
    const engine = createSemanticMemoryEngine();
    await engine.appendEvent(eventInput());
    await engine.writeLocalCloudMapping(mapping());
    await expect(engine.initializeStorage()).resolves.toEqual({
      ok: true,
      value: { logicalRecordVersion: 1 },
    });
    await expect(
      engine.resetRegisterOperationalStateForAuthorityCutover(),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        deletedEventCount: 1,
        deletedMappingCount: 1,
        status: "applied",
      },
    });
    await expect(
      engine.resetRegisterOperationalStateForAuthorityCutover(),
    ).resolves.toEqual({
      ok: true,
      value: { resetAt: 1, status: "already_applied" },
    });
  });

  it("applies #642 authority only against the exact current mapping", async () => {
    const engine = createSemanticMemoryEngine();
    await engine.writeLocalCloudMapping(mapping());
    const observation = authorityObservation();

    await expect(
      engine.applyRegisterLifecycleAuthority({
        expectedMapping: expectedMapping(),
        observation,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        disposition: "applied",
        reason: "committed",
        value: {
          cloudRegisterSessionId: "cloud-register-1",
          localRegisterSessionId: "local-register-1",
          status: "blocked",
        },
      },
    });
    await expect(
      engine.readLocalCloudMapping({
        entity: "registerSession",
        localId: "local-register-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { mappingAuthorityRevision: 2 },
    });

    await expect(
      engine.applyRegisterLifecycleAuthority({
        expectedMapping: {
          ...expectedMapping(),
          cloudRegisterSessionId: "replacement-register",
        },
        observation: { ...observation, observedAt: 20 },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { disposition: "rejected", reason: "mapping_invalidated" },
    });
  });

  it("commits mapping revision and authority together or neither", async () => {
    const engine = createSemanticMemoryEngine();
    await engine.writeLocalCloudMapping(mapping());
    engine.failNextDurableCommit();

    await expect(
      engine.applyRegisterLifecycleAuthority({
        expectedMapping: expectedMapping(),
        observation: authorityObservation(),
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({ ok: false, error: { code: "write_failed" } });
    await expect(
      engine.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({ ok: true, value: null });
    await expect(
      engine.readLocalCloudMapping({
        entity: "registerSession",
        localId: "local-register-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { mappingAuthorityRevision: 1 },
    });
  });

  it("preserves local review authority and rejects duplicate or stale observations", async () => {
    const engine = createSemanticMemoryEngine();
    await engine.writeLocalCloudMapping(mapping());
    await engine.writeDrawerAuthorityState({
      localRegisterSessionId: "local-register-1",
      localReviewAuthority: {
        observedAt: 5,
        reason: "authority_unknown",
        status: "blocked",
      },
      observedAt: 5,
      status: "blocked",
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    const observation = authorityObservation({ status: "healthy" });
    await engine.applyRegisterLifecycleAuthority({
      expectedMapping: expectedMapping(),
      observation,
      storeId: "store-1",
      terminalId: "terminal-1",
    });
    await expect(
      engine.readDrawerAuthorityState({
        localRegisterSessionId: "local-register-1",
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: {
        localReviewAuthority: { reason: "authority_unknown" },
        serverAuthority: { status: "healthy" },
        status: "blocked",
      },
    });
    await expect(
      engine.applyRegisterLifecycleAuthority({
        expectedMapping: { ...expectedMapping(), mappingAuthorityRevision: 2 },
        observation,
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { disposition: "noop", reason: "duplicate" },
    });
    await expect(
      engine.applyRegisterLifecycleAuthority({
        expectedMapping: { ...expectedMapping(), mappingAuthorityRevision: 2 },
        observation: {
          ...observation,
          cursor: { lifecycleRevision: 1, mappingAuthorityRevision: 1 },
        },
        storeId: "store-1",
        terminalId: "terminal-1",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { disposition: "noop", reason: "stale" },
    });
  });
});

function seed(): PosProvisionedTerminalSeed {
  return {
    cloudTerminalId: "cloud-terminal-1",
    displayName: "Register 1",
    provisionedAt: 1,
    schemaVersion: 9,
    storeId: "store-1",
    syncSecretHash: "secret-hash",
    terminalId: "terminal-1",
  };
}

function eventInput() {
  return {
    payload: { item: 1 },
    staffProfileId: "staff-1",
    storeId: "store-1",
    terminalId: "terminal-1",
    type: "cart.item_added" as const,
  };
}

function terminalIntegrity(): PosTerminalIntegrityState {
  return {
    observedAt: 1,
    reason: "ownership_conflict",
    status: "requires_reprovision",
    storeId: "store-1",
    terminalId: "terminal-1",
  };
}

function storeReadiness(): PosLocalStoreDayReadiness {
  return {
    operatingDate: "2026-07-10",
    source: "daily_opening",
    status: "started",
    storeId: "store-1",
    updatedAt: 1,
  };
}

function snapshot(storeId: string) {
  return { refreshedAt: 1, rows: [], schemaVersion: 1, storeId };
}

function staffAuthority(): PosLocalStaffAuthorityRecord {
  return {
    activeRoles: ["cashier"],
    credentialId: "credential-1",
    credentialVersion: 1,
    expiresAt: 100,
    issuedAt: 1,
    organizationId: "organization-1",
    refreshedAt: 1,
    staffProfileId: "staff-1",
    status: "active",
    storeId: "store-1",
    terminalId: "terminal-1",
    username: "cashier",
    verifier: {} as PosLocalStaffAuthorityRecord["verifier"],
  };
}

function cashierPresence(): PosLocalActiveCashierPresenceRecord {
  return {
    activeRoles: ["cashier"],
    credentialId: "credential-1",
    credentialVersion: 1,
    expiresAt: 100,
    lastValidatedAt: 1,
    offlineFreshUntil: 100,
    operatingDate: "2026-07-10",
    organizationId: "organization-1",
    signedInAt: 1,
    staffProfileId: "staff-1",
    storeId: "store-1",
    terminalId: "terminal-1",
    username: "cashier",
    wrappedPosLocalStaffProof:
      {} as PosLocalActiveCashierPresenceRecord["wrappedPosLocalStaffProof"],
  };
}

function mapping(): PosLocalCloudMapping {
  return {
    cloudId: "cloud-register-1",
    entity: "registerSession",
    localId: "local-register-1",
    mappedAt: 2,
    mappingAuthorityRevision: 1,
    registerCandidateState: "current",
    registerNumber: "1",
    storeId: "store-1",
    terminalId: "terminal-1",
  };
}

function expectedMapping() {
  return {
    cloudRegisterSessionId: "cloud-register-1",
    mappedAt: 2,
    mappingAuthorityRevision: 1,
    registerCandidateState: "current" as const,
    registerNumber: "1",
    storeId: "store-1",
    terminalId: "terminal-1",
  };
}

function authorityObservation(
  overrides: Partial<PosRegisterLifecycleAuthorityObservation> = {},
): PosRegisterLifecycleAuthorityObservation {
  return {
    classification: "sale_blocked",
    cloudRegisterSessionId: "cloud-register-1",
    cursor: { lifecycleRevision: 3, mappingAuthorityRevision: 2 },
    localRegisterSessionId: "local-register-1",
    observedAt: 10,
    reason: "cloud_closed",
    registerNumber: "1",
    source: "dedicated_snapshot",
    status: "blocked",
    ...overrides,
  };
}

function mappingKey(entity: string, localId: string) {
  return `${entity}:${localId}`;
}

function page<T>(
  values: T[],
  input: { continuation?: PosLocalOpaqueContinuation; limit: number },
): PosLocalStoreResult<{
  continuation?: PosLocalOpaqueContinuation;
  items: T[];
}> {
  const offset = Number(input.continuation ?? 0);
  const items = structuredClone(values.slice(offset, offset + input.limit));
  const next = offset + items.length;
  return {
    ok: true,
    value: {
      ...(next < values.length
        ? { continuation: String(next) as PosLocalOpaqueContinuation }
        : {}),
      items,
    },
  };
}

function integrityKey(input: { storeId: string; terminalId: string }) {
  return `${input.storeId}:${input.terminalId}`;
}

function readinessKey(input: { storeId: string; operatingDate: string }) {
  return `${input.storeId}:${input.operatingDate}`;
}

function staffKey(input: {
  storeId: string;
  terminalId: string;
  username: string;
}) {
  return `${input.storeId}:${input.terminalId}:${input.username}`;
}

function presenceKey(input: {
  operatingDate: string;
  organizationId: string;
  storeId: string;
  terminalId: string;
}) {
  return `${input.organizationId}:${input.storeId}:${input.terminalId}:${input.operatingDate}`;
}

function authorityKey(input: {
  localRegisterSessionId: string;
  storeId: string;
  terminalId: string;
}) {
  return `${input.storeId}:${input.terminalId}:${input.localRegisterSessionId}`;
}

function mappingMatches(
  expected: Parameters<
    ConformancePort["applyRegisterLifecycleAuthority"]
  >[0]["expectedMapping"],
  mapping: PosLocalCloudMapping | undefined,
  observation: PosRegisterLifecycleAuthorityObservation,
) {
  if (!expected) return true;
  if (!mapping || mapping.entity !== "registerSession") return false;
  if (mapping.cloudId !== expected.cloudRegisterSessionId) return false;
  if (
    observation.cloudRegisterSessionId &&
    observation.cloudRegisterSessionId !== mapping.cloudId
  )
    return false;
  return (
    mapping.mappedAt === expected.mappedAt &&
    mapping.mappingAuthorityRevision === expected.mappingAuthorityRevision &&
    mapping.registerCandidateState === expected.registerCandidateState &&
    mapping.registerNumber === expected.registerNumber &&
    mapping.storeId === expected.storeId &&
    mapping.terminalId === expected.terminalId
  );
}

function compareAuthority(
  current: PosDrawerAuthorityState["serverAuthority"],
  incoming: PosRegisterLifecycleAuthorityObservation,
): "apply" | "duplicate" | "lower_confidence" | "stale" {
  if (!current) return "apply";
  const currentCursor = current.cursor;
  const incomingCursor = incoming.cursor;
  if (currentCursor && incomingCursor) {
    if (
      incomingCursor.mappingAuthorityRevision <
        currentCursor.mappingAuthorityRevision ||
      (incomingCursor.mappingAuthorityRevision ===
        currentCursor.mappingAuthorityRevision &&
        incomingCursor.lifecycleRevision < currentCursor.lifecycleRevision)
    )
      return "stale";
    if (
      incomingCursor.mappingAuthorityRevision ===
        currentCursor.mappingAuthorityRevision &&
      incomingCursor.lifecycleRevision === currentCursor.lifecycleRevision
    )
      return "duplicate";
  }
  if (
    current.source === "dedicated_snapshot" &&
    incoming.source === "legacy_runtime_directive"
  )
    return "lower_confidence";
  return "apply";
}

function effectiveAuthority(
  state: PosDrawerAuthorityState,
): PosDrawerAuthorityState {
  if (!state.localReviewAuthority) {
    return {
      ...state,
      cloudRegisterSessionId: state.serverAuthority?.cloudRegisterSessionId,
      message: state.serverAuthority?.message,
      observedAt: state.serverAuthority?.observedAt ?? state.observedAt,
      reason: state.serverAuthority?.reason,
      status: state.serverAuthority?.status ?? state.status,
    };
  }
  return {
    ...state,
    cloudRegisterSessionId: state.serverAuthority?.cloudRegisterSessionId,
    message: state.localReviewAuthority.message,
    observedAt: Math.max(
      state.observedAt,
      state.localReviewAuthority.observedAt,
      state.serverAuthority?.observedAt ?? 0,
    ),
    reason: state.localReviewAuthority.reason,
    status: "blocked",
  };
}
