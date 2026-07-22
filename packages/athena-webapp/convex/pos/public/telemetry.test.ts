import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Doc, Id } from "../../_generated/dataModel";
import { assertConformsToExportedReturns } from "../../lib/returnValidatorContract";
import {
  POS_CLIENT_EVENT_MAX_BATCH,
  POS_CLIENT_EVENT_MAX_MESSAGE_LENGTH,
  listClientEvents,
  recordClientEvents,
  sanitizeClientEventMetadata,
} from "./telemetry";

const authMocks = vi.hoisted(() => ({
  requireAuthenticatedAthenaUserWithCtx: vi.fn(),
  requireOrganizationMemberRoleWithCtx: vi.fn(),
}));
const sharedDemoMocks = vi.hoisted(() => ({
  getSharedDemoActorWithCtx: vi.fn(),
}));

vi.mock("../../lib/athenaUserAuth", () => authMocks);
vi.mock("../../sharedDemo/actor", () => sharedDemoMocks);

function getHandler<TArgs, TResult>(definition: unknown) {
  return (definition as { _handler: (ctx: unknown, args: TArgs) => TResult })
    ._handler;
}

const STORE_ID = "store-1" as Id<"store">;
const TERMINAL_ID = "terminal-1" as Id<"posTerminal">;

type StoredEvent = Doc<"posClientEvent">;

function createCtx(options?: {
  store?: { _id: Id<"store">; organizationId: string } | null;
  terminal?: { _id: Id<"posTerminal">; storeId: Id<"store"> } | null;
  existingEvents?: StoredEvent[];
}) {
  const store =
    options?.store === undefined
      ? { _id: STORE_ID, organizationId: "org-1" }
      : options.store;
  const terminal =
    options?.terminal === undefined
      ? { _id: TERMINAL_ID, storeId: STORE_ID }
      : options.terminal;
  const rows: StoredEvent[] = [...(options?.existingEvents ?? [])];
  const inserted: Array<Record<string, unknown>> = [];

  const db = {
    get: vi.fn(async (table: string, id: string) => {
      if (table === "store") return store && store._id === id ? store : null;
      if (table === "posTerminal")
        return terminal && terminal._id === id ? terminal : null;
      if (table === "athenaUser") return { _id: id };
      return null;
    }),
    insert: vi.fn(async (_table: string, doc: Record<string, unknown>) => {
      inserted.push(doc);
      rows.push({
        ...(doc as StoredEvent),
        _id: `evt-${inserted.length}` as Id<"posClientEvent">,
        _creationTime: inserted.length,
      });
      return `evt-${inserted.length}`;
    }),
    query: vi.fn((_table: string) => {
      let filtered = rows;
      const builder = {
        withIndex: (
          _name: string,
          cb: (q: {
            eq: (field: string, value: unknown) => unknown;
          }) => unknown,
        ) => {
          const constraints: Array<[string, unknown]> = [];
          const q = {
            eq(field: string, value: unknown) {
              constraints.push([field, value]);
              return q;
            },
          };
          cb(q);
          filtered = rows.filter((row) =>
            constraints.every(
              ([field, value]) =>
                (row as Record<string, unknown>)[field] === value,
            ),
          );
          return builder;
        },
        order: (_direction: string) => builder,
        take: async (limit: number) => filtered.slice(0, limit),
        unique: async () => {
          if (filtered.length > 1) throw new Error("not unique");
          return filtered[0] ?? null;
        },
      };
      return builder;
    }),
  };

  return { ctx: { db }, inserted };
}

function baseEvent(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    clientEventId: "client-event-1",
    level: "error" as const,
    flow: "checkout" as const,
    message: "Checkout failed",
    occurredAt: 1000,
    metadata: {},
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue(null);
  authMocks.requireAuthenticatedAthenaUserWithCtx.mockResolvedValue({
    _id: "user-1",
  });
  authMocks.requireOrganizationMemberRoleWithCtx.mockResolvedValue(undefined);
});

describe("recordClientEvents", () => {
  const handler = getHandler<
    {
      storeId: Id<"store">;
      terminalId?: Id<"posTerminal">;
      terminalFingerprint?: string;
      events: Array<ReturnType<typeof baseEvent>>;
    },
    Promise<{ kind: string; data?: { accepted: number; duplicates: number } }>
  >(recordClientEvents);

  it("inserts events and returns the accepted count", async () => {
    const { ctx, inserted } = createCtx();

    const result = await handler(ctx, {
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
      terminalFingerprint: "fp-hash",
      events: [
        baseEvent(),
        baseEvent({ clientEventId: "client-event-2", level: "warn" }),
      ],
    });

    expect(result).toEqual({
      kind: "ok",
      data: { accepted: 2, duplicates: 0 },
    });
    expect(inserted).toHaveLength(2);
    expect(inserted[0]).toMatchObject({
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
      terminalFingerprint: "fp-hash",
      clientEventId: "client-event-1",
      level: "error",
      flow: "checkout",
      message: "Checkout failed",
      occurredAt: 1000,
    });
    expect(typeof (inserted[0] as { receivedAt: number }).receivedAt).toBe(
      "number",
    );
  });

  it("dedupes events already stored for the same clientEventId", async () => {
    const { ctx, inserted } = createCtx({
      existingEvents: [
        {
          _id: "existing" as Id<"posClientEvent">,
          _creationTime: 1,
          storeId: STORE_ID,
          clientEventId: "client-event-1",
          level: "error",
          flow: "checkout",
          message: "Checkout failed",
          metadata: {},
          occurredAt: 900,
          receivedAt: 950,
        } as StoredEvent,
      ],
    });

    const result = await handler(ctx, {
      storeId: STORE_ID,
      events: [baseEvent()],
    });

    expect(result).toEqual({
      kind: "ok",
      data: { accepted: 0, duplicates: 1 },
    });
    expect(inserted).toHaveLength(0);
  });

  it("performs a single dedupe read for a fresh batch", async () => {
    const { ctx } = createCtx();

    await handler(ctx, {
      storeId: STORE_ID,
      events: [
        baseEvent(),
        baseEvent({ clientEventId: "client-event-2" }),
        baseEvent({ clientEventId: "client-event-3" }),
      ],
    });

    expect(ctx.db.query).toHaveBeenCalledTimes(1);
  });

  it("accepts appended events when a replayed batch carries new tail entries", async () => {
    const { ctx, inserted } = createCtx({
      existingEvents: [
        {
          _id: "existing" as Id<"posClientEvent">,
          _creationTime: 1,
          storeId: STORE_ID,
          clientEventId: "client-event-1",
          level: "error",
          flow: "checkout",
          message: "Checkout failed",
          metadata: {},
          occurredAt: 900,
          receivedAt: 950,
        } as StoredEvent,
      ],
    });

    const result = await handler(ctx, {
      storeId: STORE_ID,
      events: [baseEvent(), baseEvent({ clientEventId: "client-event-2" })],
    });

    expect(result).toEqual({
      kind: "ok",
      data: { accepted: 1, duplicates: 1 },
    });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ clientEventId: "client-event-2" });
  });

  it("caps a batch at the max batch size", async () => {
    const { ctx, inserted } = createCtx();
    const events = Array.from(
      { length: POS_CLIENT_EVENT_MAX_BATCH + 10 },
      (_, i) => baseEvent({ clientEventId: `client-event-${i}` }),
    );

    const result = await handler(ctx, { storeId: STORE_ID, events });

    expect(result.data?.accepted).toBe(POS_CLIENT_EVENT_MAX_BATCH);
    expect(inserted).toHaveLength(POS_CLIENT_EVENT_MAX_BATCH);
  });

  it("redacts secrets and PII from message, error detail, and metadata", async () => {
    const { ctx, inserted } = createCtx();

    await handler(ctx, {
      storeId: STORE_ID,
      events: [
        baseEvent({
          message: "Checkout failed for customer@example.com",
          errorMessage: "fetch rejected with Authorization: Bearer abc.def.ghi",
          errorStack:
            "Error: syncSecretHash=deadbeef1234 at completeTransaction",
          metadata: { detail: "call +233 55 123 4567 for the customer" },
        }),
      ],
    });

    const [row] = inserted as Array<Record<string, string>>;
    expect(row.message).toBe("Checkout failed for [redacted]");
    expect(row.errorMessage).not.toContain("abc.def.ghi");
    expect(row.errorStack).not.toContain("deadbeef1234");
    expect(
      (row.metadata as unknown as Record<string, string>).detail,
    ).not.toContain("123 4567");
  });

  it("truncates oversized messages", async () => {
    const { ctx, inserted } = createCtx();

    await handler(ctx, {
      storeId: STORE_ID,
      events: [baseEvent({ message: "x".repeat(2000) })],
    });

    expect((inserted[0] as { message: string }).message).toHaveLength(
      POS_CLIENT_EVENT_MAX_MESSAGE_LENGTH,
    );
  });

  it("returns not_found for an unknown store", async () => {
    const { ctx } = createCtx({ store: null });

    const result = await handler(ctx, {
      storeId: STORE_ID,
      events: [baseEvent()],
    });

    expect(result.kind).toBe("user_error");
  });

  it("rejects unauthenticated callers", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const { ctx, inserted } = createCtx();

    const result = await handler(ctx, {
      storeId: STORE_ID,
      events: [baseEvent()],
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: { code: "authorization_failed" },
    });
    expect(inserted).toHaveLength(0);
  });

  it("rejects a terminal that belongs to another store", async () => {
    const { ctx, inserted } = createCtx({
      terminal: { _id: TERMINAL_ID, storeId: "store-2" as Id<"store"> },
    });

    const result = await handler(ctx, {
      storeId: STORE_ID,
      terminalId: TERMINAL_ID,
      events: [baseEvent()],
    });

    expect(result).toMatchObject({
      kind: "user_error",
      error: { code: "authorization_failed" },
    });
    expect(inserted).toHaveLength(0);
  });
});

describe("listClientEvents", () => {
  const handler = getHandler<
    { storeId: Id<"store">; level?: "warn" | "error"; limit?: number },
    Promise<StoredEvent[]>
  >(listClientEvents);

  function storedEvent(overrides: Partial<StoredEvent> = {}): StoredEvent {
    return {
      _id: "evt-a" as Id<"posClientEvent">,
      _creationTime: 1,
      storeId: STORE_ID,
      clientEventId: "client-event-a",
      level: "error",
      flow: "sync",
      message: "Sync failed",
      metadata: {},
      occurredAt: 900,
      receivedAt: 950,
      ...overrides,
    } as StoredEvent;
  }

  it("returns events for an authorized caller", async () => {
    const { ctx } = createCtx({ existingEvents: [storedEvent()] });

    const result = await handler(ctx, { storeId: STORE_ID });

    expect(result).toHaveLength(1);
    expect(result[0].message).toBe("Sync failed");
  });

  it("filters by level via the level index", async () => {
    const { ctx } = createCtx({
      existingEvents: [
        storedEvent(),
        storedEvent({
          _id: "evt-b" as Id<"posClientEvent">,
          clientEventId: "client-event-b",
          level: "warn",
        }),
      ],
    });

    const result = await handler(ctx, { storeId: STORE_ID, level: "warn" });

    expect(result).toHaveLength(1);
    expect(result[0].level).toBe("warn");
  });

  it("requires admission before listing client events", async () => {
    authMocks.requireAuthenticatedAthenaUserWithCtx.mockRejectedValue(
      new Error("not signed in"),
    );
    const { ctx } = createCtx({ existingEvents: [storedEvent()] });

    await expect(handler(ctx, { storeId: STORE_ID })).rejects.toThrow(
      "not signed in",
    );
  });

  it("admits shared-demo client event reads through the read rail", async () => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      storeId: STORE_ID,
    });
    const { ctx } = createCtx({ existingEvents: [storedEvent()] });

    const result = await handler(ctx, { storeId: STORE_ID });

    expect(result).toHaveLength(1);
    expect(sharedDemoMocks.getSharedDemoActorWithCtx).toHaveBeenCalledWith(ctx);
    expect(
      authMocks.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
    expect(authMocks.requireOrganizationMemberRoleWithCtx).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        allowedRoles: ["full_admin", "pos_only"],
        userId: "demo-user-1",
      }),
    );
  });

  it("denies shared-demo client event reads outside the admitted store", async () => {
    sharedDemoMocks.getSharedDemoActorWithCtx.mockResolvedValue({
      athenaUserId: "demo-user-1",
      kind: "shared_demo",
      storeId: "store-2",
    });
    const { ctx } = createCtx({ existingEvents: [storedEvent()] });

    await expect(handler(ctx, { storeId: STORE_ID })).rejects.toThrow(
      "This action isn't allowed in the demo.",
    );
    expect(
      authMocks.requireAuthenticatedAthenaUserWithCtx,
    ).not.toHaveBeenCalled();
  });
});

describe("return contracts", () => {
  it("recordClientEvents results conform to the exported returns validator", () => {
    assertConformsToExportedReturns(recordClientEvents, {
      kind: "ok",
      data: { accepted: 2, duplicates: 1 },
    });
    assertConformsToExportedReturns(recordClientEvents, {
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "You do not have access to report POS telemetry.",
      },
    });
  });

  it("listClientEvents rows conform to the exported returns validator", () => {
    assertConformsToExportedReturns(listClientEvents, [
      {
        _id: "evt-1" as Id<"posClientEvent">,
        _creationTime: 1,
        storeId: STORE_ID,
        terminalId: TERMINAL_ID,
        terminalFingerprint: "fp-hash",
        localRegisterSessionId: "local-register-1",
        clientEventId: "client-event-1",
        level: "error",
        flow: "checkout",
        message: "Checkout failed",
        errorName: "Error",
        errorMessage: "boom",
        errorStack: "Error: boom",
        appVersion: "1.2.3",
        metadata: { attempt: 2, offline: true },
        occurredAt: 900,
        receivedAt: 950,
      },
    ]);
  });
});

describe("sanitizeClientEventMetadata", () => {
  it("caps keys and truncates values", () => {
    const metadata: Record<string, string | number | boolean> = {};
    for (let index = 0; index < 30; index += 1) {
      metadata[`key-${index}`] = index;
    }
    metadata.long = "x".repeat(1000);

    const sanitized = sanitizeClientEventMetadata(metadata);

    expect(Object.keys(sanitized).length).toBeLessThanOrEqual(20);
  });

  it("drops non-finite numbers", () => {
    expect(sanitizeClientEventMetadata({ bad: Number.NaN, good: 1 })).toEqual({
      good: 1,
    });
  });
});
