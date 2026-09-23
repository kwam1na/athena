import { afterEach, describe, expect, it, vi } from "vitest";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import {
  createIndexedDbPosLocalStorageAdapter,
  createPosLocalStore,
  POS_LOCAL_STORE_SCHEMA_VERSION,
  type PosLocalEventRecord,
} from "./posLocalStore";
import {
  isPosLocalRuntimeActivityReportCandidate,
  isPosLocalRuntimeDrainCandidate,
  readScopedPosLocalUploadEvents,
} from "./usePosLocalSyncRuntime";

afterEach(() => vi.unstubAllGlobals());

function buildEvent(sequence: number, overrides: Partial<PosLocalEventRecord> = {}): PosLocalEventRecord {
  return {
    localEventId: `event-${sequence}`,
    sequence,
    createdAt: sequence,
    schemaVersion: POS_LOCAL_STORE_SCHEMA_VERSION,
    storeId: "store-1",
    terminalId: "terminal-1",
    type: "expense.session_started",
    localExpenseSessionId: "expense-1",
    payload: {},
    sync: { status: "synced", uploaded: true },
    activity: { status: "failed", reasonCode: "missing_register_session" },
    ...overrides,
  };
}

async function createFixture(events: PosLocalEventRecord[]) {
  vi.stubGlobal("indexedDB", new IDBFactory());
  vi.stubGlobal("IDBKeyRange", IDBKeyRange);
  const adapter = createIndexedDbPosLocalStorageAdapter({ databaseName: "upload-selection-test" });
  const store = createPosLocalStore({ adapter });
  expect((await store.initializeStorage()).ok).toBe(true);
  await adapter.transaction("readwrite", ["events"], async (transaction) => {
    for (const event of events) await transaction.put("events", String(event.sequence), event);
  });
  return store;
}

describe("runtime upload page selection", () => {
  it("reconciles an evidenced review in IndexedDB without leaving a duplicate", async () => {
    const event = buildEvent(1, { sync: { status: "needs_review", uploaded: true } });
    const store = await createFixture([event]);
    const result = await store.clearLocalReviewEvents([event.localEventId], { serverConfirmedAt: 100 });
    expect(result.ok).toBe(true);
    const listed = await store.listEvents();
    expect(listed).toMatchObject({ ok: true, value: [{ localEventId: event.localEventId, sync: { status: "locally_resolved", localResolution: { serverConfirmedAt: 100 } } }] });
    if (listed.ok) expect(listed.value).toHaveLength(1);
  });
  it.each([249, 250, 251, 750])("finds 15 uploads after %i nonretryable activities on both reads without changing history", async (count) => {
    const blocked = Array.from({ length: count }, (_, index) => buildEvent(index + 1));
    const pending = Array.from({ length: 15 }, (_, index) => buildEvent(count + index + 1, {
      type: "transaction.completed",
      localRegisterSessionId: "register-1",
      staffProfileId: "staff-1",
      staffProofToken: "fixture-proof",
      uploadSequence: index + 5,
      sync: { status: "pending" },
      activity: { status: "pending" },
    }));
    const store = await createFixture([...blocked, ...pending]);
    const before = await store.listEvents();
    for (let read = 0; read < 2; read += 1) {
      const selected = await readScopedPosLocalUploadEvents({ store, storeId: "store-1", terminalId: "terminal-1" });
      expect(selected.ok).toBe(true);
      if (!selected.ok) throw new Error(selected.error.message);
      expect(selected.value.events.filter((event) => isPosLocalRuntimeDrainCandidate(event)).map((event) => event.localEventId)).toEqual(pending.slice(0, count === 249 ? 1 : 15).map((event) => event.localEventId));
      expect(selected.value.events.length).toBeLessThanOrEqual(250);
    }
    expect(await store.listEvents()).toEqual(before);
  });

  it("keeps activity retries for synced register events and terminates an exhausted scan", async () => {
    const events = Array.from({ length: 250 }, (_, index) => buildEvent(index + 1));
    const store = await createFixture(events);
    const empty = await readScopedPosLocalUploadEvents({ store, storeId: "store-1", terminalId: "terminal-1" });
    expect(empty).toMatchObject({ ok: true, value: { events: [] } });
    for (const reasonCode of ["network_error", "unknown"] as const) {
      expect(isPosLocalRuntimeActivityReportCandidate(buildEvent(251, {
        type: "transaction.completed", localRegisterSessionId: "register-1",
        activity: { status: "failed", reasonCode },
      }))).toBe(true);
    }
  });

  it("propagates a later page read failure instead of declaring the queue empty", async () => {
    const store = await createFixture(Array.from({ length: 250 }, (_, index) => buildEvent(index + 1)));
    const originalRead = store.listEventsForUpload.bind(store);
    vi.spyOn(store, "listEventsForUpload").mockImplementation(async (input) =>
      input?.afterSequence !== undefined
        ? { ok: false, error: { code: "read_failed", message: "read failed" } }
        : originalRead(input),
    );
    expect(await readScopedPosLocalUploadEvents({ store, storeId: "store-1", terminalId: "terminal-1" })).toMatchObject({ ok: false });
  });
});

describe("drawerless expense activity admission", () => {
  it("preserves expense events and upload sequencing without queuing register activity", async () => {
    const store = await createFixture([]);
    for (const type of ["expense.session_started", "expense.item_added", "expense.completed"] as const) {
      const appended = await store.appendEvent({ type, storeId: "store-1", terminalId: "terminal-1", localExpenseSessionId: "expense-1", staffProfileId: "staff-1", staffProofToken: "fixture-proof", payload: { localExpenseSessionId: "expense-1" } });
      expect(appended.ok).toBe(true);
      if (!appended.ok) throw new Error(appended.error.message);
      expect(appended.value.activity).toBeUndefined();
      if (type === "expense.completed") {
        expect(appended.value.sync.status).toBe("pending");
        expect(appended.value.uploadSequence).toBe(1);
        expect(isPosLocalRuntimeDrainCandidate(appended.value)).toBe(true);
      }
    }
    expect(isPosLocalRuntimeActivityReportCandidate(buildEvent(1, { activity: { status: "pending" } }))).toBe(false);
    const attached = await store.appendEvent({ type: "expense.session_started", storeId: "store-1", terminalId: "terminal-1", localExpenseSessionId: "expense-1", localRegisterSessionId: "register-1", payload: {} });
    expect(attached).toMatchObject({ ok: true, value: { activity: { status: "pending" } } });
  });
});
