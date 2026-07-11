import type { PosLocalStoreSnapshot } from "../posLocalStoreSnapshot";

export const POS_LOCAL_STORE_V9_SECTIONS = Object.freeze({
  authority: [
    {
      localRegisterSessionId: "register-local-1",
      localReviewAuthority: {
        observedAt: 1_100,
        reason: "authority_unknown",
        status: "blocked",
      },
      observedAt: 1_200,
      serverAuthority: {
        cursor: { lifecycleRevision: 4, mappingAuthorityRevision: 3 },
        observedAt: 1_200,
        source: "dedicated_snapshot",
        status: "healthy",
      },
      status: "blocked",
      storeId: "store-1",
      terminalId: "terminal-1",
    },
  ],
  cashierPresence: [
    {
      operatingDate: "2026-07-10",
      staffProfileId: "staff-1",
      storeId: "store-1",
      terminalId: "terminal-1",
    },
  ],
  checkpoints: [{ sequence: 3, uploadSequence: 2 }],
  events: [
    {
      activity: { status: "reported" },
      createdAt: 1_000,
      localEventId: "event-open",
      localRegisterSessionId: "register-local-1",
      payload: { openingFloat: 100 },
      schemaVersion: 9,
      sequence: 1,
      storeId: "store-1",
      sync: { status: "synced", uploaded: true },
      terminalId: "terminal-1",
      type: "register.opened",
      uploadSequence: 1,
    },
    {
      activity: { status: "reported" },
      createdAt: 1_100,
      localEventId: "event-sale",
      localRegisterSessionId: "register-local-1",
      localTransactionId: "sale-local-1",
      payload: { total: 25 },
      schemaVersion: 9,
      sequence: 2,
      storeId: "store-1",
      sync: { status: "pending" },
      terminalId: "terminal-1",
      type: "transaction.completed",
      uploadSequence: 2,
    },
    {
      activity: { status: "mapping_pending" },
      createdAt: 1_200,
      localEventId: "event-expense",
      localExpenseSessionId: "expense-local-1",
      payload: { total: 8 },
      schemaVersion: 9,
      sequence: 3,
      storeId: "store-1",
      sync: { status: "needs_review" },
      terminalId: "terminal-1",
      type: "expense.completed",
      uploadSequence: 1,
    },
  ],
  mappings: [
    {
      cloudId: "register-cloud-1",
      entity: "registerSession",
      localId: "register-local-1",
      mappedAt: 1_000,
      mappingAuthorityRevision: 3,
      registerCandidateState: "current",
      registerNumber: "1",
      storeId: "store-1",
      terminalId: "terminal-1",
    },
  ],
  readiness: [
    {
      operatingDate: "2026-07-10",
      source: "daily_opening",
      status: "started",
      storeId: "store-1",
      updatedAt: 900,
    },
  ],
  registerAvailability: [{ refreshedAt: 900, rows: [], storeId: "store-1" }],
  registerCatalog: [{ refreshedAt: 900, rows: [], storeId: "store-1" }],
  registerServiceCatalog: [{ refreshedAt: 900, rows: [], storeId: "store-1" }],
  staffAuthority: [
    {
      credentialId: "credential-1",
      staffProfileId: "staff-1",
      status: "active",
      storeId: "store-1",
      terminalId: "terminal-1",
    },
  ],
  terminalIntegrity: [
    {
      observedAt: 800,
      status: "healthy",
      storeId: "store-1",
      terminalId: "terminal-1",
    },
  ],
  terminalSeed: [
    {
      cloudTerminalId: "terminal-cloud-1",
      displayName: "Front",
      provisionedAt: 700,
      schemaVersion: 9,
      storeId: "store-1",
      terminalId: "terminal-1",
    },
  ],
});

export function buildPosLocalStoreFixtureSnapshot(
  sections: Record<string, readonly unknown[]>,
): PosLocalStoreSnapshot {
  const orderedSections = Object.fromEntries(
    Object.entries(sections).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    envelopeVersion: 1,
    manifest: {
      integrity: fixtureIntegrity(orderedSections),
      sections: Object.entries(orderedSections).map(([name, records]) => ({
        count: records.length,
        identities: records.map((record, index) =>
          fixtureIdentity(name, record, index),
        ),
        name,
      })),
    },
    sections: orderedSections,
  };
}

export function fixtureIntegrity(sections: Record<string, readonly unknown[]>) {
  return JSON.stringify(
    Object.fromEntries(
      Object.entries(sections).sort(([left], [right]) => left.localeCompare(right)),
    ),
  );
}

function fixtureIdentity(name: string, record: unknown, index: number) {
  if (record && typeof record === "object") {
    const candidate = record as Record<string, unknown>;
    for (const key of [
      "localEventId",
      "localId",
      "localRegisterSessionId",
      "staffProfileId",
      "terminalId",
      "storeId",
    ]) {
      if (typeof candidate[key] === "string") return `${name}:${candidate[key]}`;
    }
  }
  return `${name}:${index}`;
}

export const POS_LOCAL_STORE_V9_LOGICAL_FIXTURE = Object.freeze(
  buildPosLocalStoreFixtureSnapshot(POS_LOCAL_STORE_V9_SECTIONS),
);
