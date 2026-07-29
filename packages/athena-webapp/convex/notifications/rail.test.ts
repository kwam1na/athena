/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ADMIN_EMAILS } from "../constants/email";
import schema from "../schema";
import { MAX_DELIVERY_ATTEMPTS } from "./deliveryPolicy";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./notifications/"),
    loader,
  ]),
);

const NOW = Date.parse("2026-07-29T12:00:00Z");

// Mirrors the (unexported) cap in convex/notifications/dispatch.ts. If that
// constant moves, this test's overflow row stops being an overflow row.
const SUBSCRIPTION_RESOLUTION_CAP = 200;

const NORMALIZED_ADMIN_EMAILS = ADMIN_EMAILS.map((recipient) =>
  recipient.email.trim().toLowerCase(),
).sort();

async function seedOrgStore(ctx: MutationCtx) {
  const userId = await ctx.db.insert("athenaUser", {
    email: "owner@example.com",
    normalizedEmail: "owner@example.com",
  });
  const organizationId = await ctx.db.insert("organization", {
    createdByUserId: userId,
    name: "Accra",
    slug: "accra",
  });
  const storeId = await ctx.db.insert("store", {
    createdByUserId: userId,
    currency: "GHS",
    name: "Accra",
    organizationId,
    slug: "accra",
  });
  return { userId, organizationId, storeId };
}

async function seedTerminal(
  ctx: MutationCtx,
  args: { storeId: Id<"store">; userId: Id<"athenaUser"> },
) {
  return ctx.db.insert("posTerminal", {
    storeId: args.storeId,
    fingerprintHash: "fingerprint-1",
    displayName: "Front Desk",
    registeredByUserId: args.userId,
    browserInfo: { userAgent: "test-agent" },
    registeredAt: NOW,
    status: "active",
  });
}

type SeededFixture = {
  userId: Id<"athenaUser">;
  organizationId: Id<"organization">;
  storeId: Id<"store">;
};

async function insertTerminalHealthIntent(
  ctx: MutationCtx,
  fixture: SeededFixture,
  terminalId: Id<"posTerminal">,
  overrides: Partial<{
    status: "pending" | "dispatched" | "suppressed";
    emittedAt: number;
    dedupeKey: string;
  }> = {},
) {
  return ctx.db.insert("notificationIntent", {
    kind: "pos.terminal_health",
    category: "system_health",
    storeId: fixture.storeId,
    organizationId: fixture.organizationId,
    subjectType: "posTerminal",
    subjectId: String(terminalId),
    dedupeKey:
      overrides.dedupeKey ?? `pos.terminal_health:${terminalId}:${NOW}`,
    payload: {
      storeId: fixture.storeId,
      terminalId,
      conditions: ["storage_critical"],
      observedAt: NOW,
    },
    status: overrides.status ?? "pending",
    emittedAt: overrides.emittedAt ?? NOW,
  });
}

async function listDeliveries(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query("notificationDelivery").take(50));
}

async function listOperationalEvents(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query("operationalEvent").take(50));
}

describe("emit", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("inserts an intent and no-ops on a second emit with the same payload", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));

    const args = {
      kind: "pos.terminal_health",
      storeId: fixture.storeId,
      organizationId: fixture.organizationId,
      subjectType: "posTerminal",
      subjectId: String(terminalId),
      payload: {
        storeId: fixture.storeId,
        terminalId,
        conditions: ["storage_critical"],
        observedAt: NOW,
      },
    };

    const first = await t.mutation(
      internal.notifications.emit.emitNotification,
      args,
    );
    expect(first.created).toBe(true);

    const second = await t.mutation(
      internal.notifications.emit.emitNotification,
      args,
    );
    expect(second).toEqual({ intentId: first.intentId, created: false });

    const intents = await t.run((ctx) =>
      ctx.db.query("notificationIntent").take(10),
    );
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: "pos.terminal_health",
      category: "system_health",
      dedupeKey: `pos.terminal_health:${terminalId}:${NOW}`,
      status: "pending",
    });
  });

  it("throws at emit time for an unknown kind", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);

    await expect(
      t.mutation(internal.notifications.emit.emitNotification, {
        kind: "not.a_kind",
        storeId: fixture.storeId,
        subjectType: "store",
        subjectId: String(fixture.storeId),
        payload: {},
      }),
    ).rejects.toThrow("Unknown notification kind: not.a_kind");

    const intents = await t.run((ctx) =>
      ctx.db.query("notificationIntent").take(10),
    );
    expect(intents).toHaveLength(0);
  });

  it("resolves the organization from the store when not passed", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));

    const { intentId } = await t.mutation(
      internal.notifications.emit.emitNotification,
      {
        kind: "pos.terminal_health",
        storeId: fixture.storeId,
        subjectType: "posTerminal",
        subjectId: String(terminalId),
        payload: {
          storeId: fixture.storeId,
          terminalId,
          conditions: ["sync_stuck"],
          observedAt: NOW,
        },
      },
    );

    const intent = await t.run((ctx) =>
      ctx.db.get("notificationIntent", intentId),
    );
    expect(intent?.organizationId).toBe(fixture.organizationId);
  });
});

describe("reserveIntentDeliveries", () => {
  it("resolves subscriptions with store scoping, disabled exclusion, and email collapse", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    await t.run(async (ctx) => {
      const otherStoreId = await ctx.db.insert("store", {
        createdByUserId: fixture.userId,
        currency: "GHS",
        name: "Kumasi",
        organizationId: fixture.organizationId,
        slug: "kumasi",
      });
      const base = {
        organizationId: fixture.organizationId,
        category: "system_health" as const,
        channel: "email" as const,
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      };
      // Org-level: matches any store.
      await ctx.db.insert("notificationSubscription", {
        ...base,
        recipientEmail: "org-wide@example.com",
        recipientName: "Org Wide",
      });
      // Store-scoped to the intent's store: matches.
      await ctx.db.insert("notificationSubscription", {
        ...base,
        storeId: fixture.storeId,
        recipientEmail: "store-scoped@example.com",
      });
      // Store-scoped to another store: excluded.
      await ctx.db.insert("notificationSubscription", {
        ...base,
        storeId: otherStoreId,
        recipientEmail: "other-store@example.com",
      });
      // Disabled: excluded.
      await ctx.db.insert("notificationSubscription", {
        ...base,
        recipientEmail: "disabled@example.com",
        enabled: false,
      });
      // Duplicate of the org-wide email under a different spelling: collapses.
      await ctx.db.insert("notificationSubscription", {
        ...base,
        recipientEmail: " ORG-WIDE@example.com ",
      });
    });

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );

    expect(reserved).not.toBeNull();
    expect(
      reserved!.leased.map((lease) => lease.recipientEmail).sort(),
    ).toEqual(["org-wide@example.com", "store-scoped@example.com"]);

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(2);
    for (const delivery of deliveries) {
      expect(delivery.status).toBe("in_flight");
      expect(delivery.attemptCount).toBe(1);
      expect(delivery.leaseToken).toBeDefined();
      expect(delivery.leaseExpiresAt).toBeGreaterThan(Date.now());
    }

    const intent = await t.run((ctx) =>
      ctx.db.get("notificationIntent", intentId),
    );
    expect(intent?.status).toBe("dispatched");
  });

  it("suppresses with no_recipients when every subscription row is disabled", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    await t.run(async (ctx) => {
      for (const email of ["a@example.com", "b@example.com"]) {
        await ctx.db.insert("notificationSubscription", {
          organizationId: fixture.organizationId,
          category: "system_health",
          channel: "email",
          recipientEmail: email,
          enabled: false,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );

    // The fallback is a pre-seed bridge keyed off "no rows at all". An
    // explicitly disabled audience is a real configuration, not a reason to
    // re-broadcast to the hardcoded admin list.
    expect(reserved).toBeNull();
    expect(await listDeliveries(t)).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.get("notificationIntent", intentId)),
    ).toMatchObject({
      status: "suppressed",
      suppressedReason: "no_recipients",
    });
  });

  it("does not fall back to ADMIN_EMAILS when rows exist but are scoped to another store", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    await t.run(async (ctx) => {
      const otherStoreId = await ctx.db.insert("store", {
        createdByUserId: fixture.userId,
        currency: "GHS",
        name: "Kumasi",
        organizationId: fixture.organizationId,
        slug: "kumasi",
      });
      await ctx.db.insert("notificationSubscription", {
        organizationId: fixture.organizationId,
        storeId: otherStoreId,
        category: "system_health",
        channel: "email",
        recipientEmail: "kumasi-only@example.com",
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );

    // Narrowing the audience by store must narrow it, not widen it back to
    // the admin list.
    expect(reserved).toBeNull();
    expect(await listDeliveries(t)).toHaveLength(0);
    expect(
      await t.run((ctx) => ctx.db.get("notificationIntent", intentId)),
    ).toMatchObject({
      status: "suppressed",
      suppressedReason: "no_recipients",
    });
  });

  it("records a subscription_cap_exceeded event rather than silently truncating", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    await t.run(async (ctx) => {
      for (let index = 0; index <= SUBSCRIPTION_RESOLUTION_CAP; index += 1) {
        await ctx.db.insert("notificationSubscription", {
          organizationId: fixture.organizationId,
          category: "system_health",
          channel: "email",
          recipientEmail: `subscriber-${index}@example.com`,
          enabled: true,
          createdAt: NOW,
          updatedAt: NOW,
        });
      }
    });

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );

    expect(reserved!.leased).toHaveLength(SUBSCRIPTION_RESOLUTION_CAP);

    const failureEvents = (await listOperationalEvents(t)).filter(
      (event) => event.eventType === "notification_delivery_failed",
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0]?.metadata).toMatchObject({
      notificationKind: "pos.terminal_health",
      errorCode: "subscription_cap_exceeded",
    });
  });

  it("suppresses stranded deliveries whose recipient left the audience", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    const strandedId = await t.run(async (ctx) => {
      await ctx.db.insert("notificationSubscription", {
        organizationId: fixture.organizationId,
        category: "system_health",
        channel: "email",
        recipientEmail: "current@example.com",
        enabled: true,
        createdAt: NOW,
        updatedAt: NOW,
      });
      return ctx.db.insert("notificationDelivery", {
        intentId,
        kind: "pos.terminal_health",
        category: "system_health",
        channel: "email",
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        recipientEmail: "departed@example.com",
        dedupeKey: "delivery:departed",
        status: "retryable_failure",
        attemptCount: 1,
        nextAttemptAt: Date.now() - 1,
        createdAt: NOW,
        updatedAt: NOW,
      });
    });

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );

    expect(
      reserved!.leased.map((lease) => lease.recipientEmail),
    ).toEqual(["current@example.com"]);

    // Left in retryable_failure it would be re-selected by the sweeper on
    // every tick forever, consuming the budget for real work.
    const stranded = await t.run((ctx) =>
      ctx.db.get("notificationDelivery", strandedId),
    );
    expect(stranded).toMatchObject({
      status: "suppressed",
      errorCode: "recipient_unsubscribed",
    });
    expect(stranded?.nextAttemptAt).toBeUndefined();
    expect(stranded?.terminalAt).toBeDefined();
  });

  it("terminalizes an intent whose kind is no longer registered instead of throwing", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const intentId = await t.run((ctx) =>
      ctx.db.insert("notificationIntent", {
        kind: "pos.retired_kind",
        category: "system_health",
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        subjectType: "store",
        subjectId: String(fixture.storeId),
        dedupeKey: "pos.retired_kind:1",
        payload: {},
        status: "pending",
        emittedAt: NOW,
      }),
    );

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );

    expect(reserved).toBeNull();
    expect(
      await t.run((ctx) => ctx.db.get("notificationIntent", intentId)),
    ).toMatchObject({
      status: "suppressed",
      suppressedReason: "unknown_kind",
    });
    expect(await listDeliveries(t)).toHaveLength(0);

    const failureEvents = (await listOperationalEvents(t)).filter(
      (event) => event.eventType === "notification_delivery_failed",
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0]?.metadata).toMatchObject({
      notificationKind: "pos.retired_kind",
      notificationSubjectKey: String(intentId),
      errorCode: "unknown_kind",
    });

    // The action path must not throw either.
    await expect(
      t.action(internal.notifications.dispatch.dispatchIntent, { intentId }),
    ).resolves.toBeNull();
  });

  it("skips a delivery already at the attempt cap", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    const first = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    expect(first!.leased.length).toBeGreaterThan(0);

    // Park every delivery at the cap with an elapsed backoff: eligible on
    // every axis except the attempt budget.
    await t.run(async (ctx) => {
      for (const delivery of await ctx.db
        .query("notificationDelivery")
        .take(50)) {
        await ctx.db.patch("notificationDelivery", delivery._id, {
          status: "retryable_failure",
          attemptCount: MAX_DELIVERY_ATTEMPTS,
          leaseToken: undefined,
          leaseExpiresAt: undefined,
          nextAttemptAt: Date.now() - 1,
        });
      }
    });

    const again = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    expect(again!.leased).toHaveLength(0);

    const deliveries = await listDeliveries(t);
    expect(
      deliveries.every(
        (delivery) =>
          delivery.attemptCount === MAX_DELIVERY_ATTEMPTS &&
          delivery.status === "retryable_failure",
      ),
    ).toBe(true);
  });

  it("falls back to ADMIN_EMAILS when no subscription rows exist", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );

    expect(
      reserved!.leased.map((lease) => lease.recipientEmail).sort(),
    ).toEqual(NORMALIZED_ADMIN_EMAILS);
  });

  it("creates nothing new when re-reserving after all deliveries were sent", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    for (const lease of reserved!.leased) {
      await t.mutation(internal.notifications.dispatch.completeDelivery, {
        deliveryId: lease.deliveryId,
        leaseToken: lease.leaseToken,
        state: "sent",
        errorCode: "sent",
      });
    }

    const again = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    expect(again!.leased).toHaveLength(0);

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(reserved!.leased.length);
    expect(deliveries.every((delivery) => delivery.status === "sent")).toBe(
      true,
    );
  });

  it("skips deliveries under a live lease", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    const first = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    expect(first!.leased.length).toBeGreaterThan(0);

    const second = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    expect(second!.leased).toHaveLength(0);

    // Attempt counts were not bumped by the skipped re-reserve.
    const deliveries = await listDeliveries(t);
    expect(
      deliveries.every((delivery) => delivery.attemptCount === 1),
    ).toBe(true);
  });
});

describe("completeDelivery", () => {
  async function reserveOne(t: ReturnType<typeof convexTest>) {
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );
    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    return { fixture, terminalId, intentId, lease: reserved!.leased[0]! };
  }

  it("is a no-op with the wrong lease token", async () => {
    const t = convexTest(schema, modules);
    const { lease } = await reserveOne(t);

    await t.mutation(internal.notifications.dispatch.completeDelivery, {
      deliveryId: lease.deliveryId,
      leaseToken: "not-the-token",
      state: "sent",
      errorCode: "sent",
    });

    const delivery = await t.run((ctx) =>
      ctx.db.get("notificationDelivery", lease.deliveryId),
    );
    expect(delivery).toMatchObject({
      status: "in_flight",
      leaseToken: lease.leaseToken,
    });
    expect(delivery?.sentAt).toBeUndefined();
  });

  it("marks sent with sentAt and clears the lease", async () => {
    const t = convexTest(schema, modules);
    const { lease } = await reserveOne(t);

    await t.mutation(internal.notifications.dispatch.completeDelivery, {
      deliveryId: lease.deliveryId,
      leaseToken: lease.leaseToken,
      state: "sent",
      errorCode: "sent",
      providerMessageId: "msg-1",
    });

    const delivery = await t.run((ctx) =>
      ctx.db.get("notificationDelivery", lease.deliveryId),
    );
    expect(delivery).toMatchObject({
      status: "sent",
      errorCode: "sent",
      providerMessageId: "msg-1",
    });
    expect(delivery?.sentAt).toBeDefined();
    expect(delivery?.leaseToken).toBeUndefined();
    expect(delivery?.leaseExpiresAt).toBeUndefined();
  });

  it("records an operational event on terminal_failure", async () => {
    const t = convexTest(schema, modules);
    const { fixture, terminalId, lease } = await reserveOne(t);

    await t.mutation(internal.notifications.dispatch.completeDelivery, {
      deliveryId: lease.deliveryId,
      leaseToken: lease.leaseToken,
      state: "terminal_failure",
      errorCode: "provider_404",
    });

    const delivery = await t.run((ctx) =>
      ctx.db.get("notificationDelivery", lease.deliveryId),
    );
    expect(delivery).toMatchObject({
      status: "terminal_failure",
      errorCode: "provider_404",
    });
    expect(delivery?.terminalAt).toBeDefined();

    const events = await listOperationalEvents(t);
    const failureEvents = events.filter(
      (event) => event.eventType === "notification_delivery_failed",
    );
    expect(failureEvents).toHaveLength(1);
    // subjectType/subjectId always come from the intent, and the delivery id
    // travels under notificationSubjectKey — the metadata key the event's own
    // dedupe is declared over.
    expect(failureEvents[0]).toMatchObject({
      storeId: fixture.storeId,
      organizationId: fixture.organizationId,
      actorType: "automation",
      subjectType: "posTerminal",
      subjectId: String(terminalId),
    });
    expect(failureEvents[0]?.metadata).toMatchObject({
      notificationKind: "pos.terminal_health",
      notificationSubjectKey: String(lease.deliveryId),
      errorCode: "provider_404",
    });
    expect(failureEvents[0]?.metadata?.deliveryId).toBeUndefined();
  });

  it("marks suppressed with terminalAt and no operational event", async () => {
    const t = convexTest(schema, modules);
    const { lease } = await reserveOne(t);

    await t.mutation(internal.notifications.dispatch.completeDelivery, {
      deliveryId: lease.deliveryId,
      leaseToken: lease.leaseToken,
      state: "suppressed",
      errorCode: "payload_unavailable",
    });

    const delivery = await t.run((ctx) =>
      ctx.db.get("notificationDelivery", lease.deliveryId),
    );
    expect(delivery).toMatchObject({
      status: "suppressed",
      errorCode: "payload_unavailable",
    });
    expect(delivery?.terminalAt).toBeDefined();

    const events = await listOperationalEvents(t);
    expect(
      events.filter(
        (event) => event.eventType === "notification_delivery_failed",
      ),
    ).toHaveLength(0);
  });
});

describe("dispatchIntent", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  function stubProdTransport(status = 202) {
    vi.stubEnv("STAGE", "prod");
    vi.stubEnv("MAILERSEND_API_KEY", "test-key");
    const fetchMock = vi.fn(
      async (_input: string | URL | Request, _init?: RequestInit) =>
        new Response(null, {
          status,
          headers: { "x-message-id": "msg-1" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends every delivery and marks the intent dispatched on the happy path", async () => {
    const fetchMock = stubProdTransport();
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    await t.action(internal.notifications.dispatch.dispatchIntent, {
      intentId,
    });

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(ADMIN_EMAILS.length);
    for (const delivery of deliveries) {
      expect(delivery.status).toBe("sent");
      expect(delivery.sentAt).toBeDefined();
      expect(delivery.leaseToken).toBeUndefined();
      expect(delivery.providerMessageId).toBe("msg-1");
    }
    expect(await t.run((ctx) => ctx.db.get("notificationIntent", intentId)))
      .toMatchObject({ status: "dispatched" });

    // One provider call per delivery, idempotency-keyed by the delivery id.
    expect(fetchMock).toHaveBeenCalledTimes(deliveries.length);
    const idempotencyKeys = fetchMock.mock.calls.map(
      (call) =>
        (call[1]!.headers as Record<string, string>)["Idempotency-Key"],
    );
    expect(idempotencyKeys.sort()).toEqual(
      deliveries.map((delivery) => String(delivery._id)).sort(),
    );
  });

  it("keeps the batch retryable and the intent dispatched when prepareEmail throws", async () => {
    const fetchMock = stubProdTransport();
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);

    // An approvalRequest that is not a variance review makes the payload
    // query throw. A throw is a transient fault (read limit, OCC, momentarily
    // missing row) and must stay retryable — treating it as "no longer
    // sendable" would let one flaky query permanently silence an alert.
    const { intentId } = await t.run(async (ctx) => {
      const approvalRequestId = await ctx.db.insert("approvalRequest", {
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        requestType: "discount_override",
        subjectType: "posTransaction",
        subjectId: "tx-1",
        status: "pending",
        createdAt: NOW,
      });
      const intentId = await ctx.db.insert("notificationIntent", {
        kind: "register.closeout_variance",
        category: "cash_controls",
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        subjectType: "approvalRequest",
        subjectId: String(approvalRequestId),
        dedupeKey: `register.closeout_variance:${approvalRequestId}`,
        payload: { approvalRequestId },
        status: "pending",
        emittedAt: NOW,
      });
      return { intentId };
    });

    const before = Date.now();
    await t.action(internal.notifications.dispatch.dispatchIntent, {
      intentId,
    });

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(ADMIN_EMAILS.length);
    for (const delivery of deliveries) {
      expect(delivery.status).toBe("retryable_failure");
      expect(delivery.errorCode).toBe("payload_error");
      expect(delivery.nextAttemptAt).toBeGreaterThan(before);
      expect(delivery.leaseToken).toBeUndefined();
      expect(delivery.terminalAt).toBeUndefined();
    }
    expect(
      await t.run((ctx) => ctx.db.get("notificationIntent", intentId)),
    ).toMatchObject({ status: "dispatched" });
    expect(
      await t.run((ctx) => ctx.db.get("notificationIntent", intentId)),
    ).not.toHaveProperty("suppressedReason", "payload_error");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("terminals the batch when prepareEmail throws on the final attempt", async () => {
    const fetchMock = stubProdTransport();
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);

    const { intentId } = await t.run(async (ctx) => {
      const approvalRequestId = await ctx.db.insert("approvalRequest", {
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        requestType: "discount_override",
        subjectType: "posTransaction",
        subjectId: "tx-1",
        status: "pending",
        createdAt: NOW,
      });
      const intentId = await ctx.db.insert("notificationIntent", {
        kind: "register.closeout_variance",
        category: "cash_controls",
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        subjectType: "approvalRequest",
        subjectId: String(approvalRequestId),
        dedupeKey: `register.closeout_variance:${approvalRequestId}`,
        payload: { approvalRequestId },
        status: "pending",
        emittedAt: NOW,
      });
      return { intentId };
    });

    // Drive the batch to one attempt below the cap so the dispatch below
    // reserves at attemptCount === MAX_DELIVERY_ATTEMPTS.
    for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      await t.action(internal.notifications.dispatch.dispatchIntent, {
        intentId,
      });
      await t.run(async (ctx) => {
        for (const delivery of await ctx.db
          .query("notificationDelivery")
          .take(50)) {
          await ctx.db.patch("notificationDelivery", delivery._id, {
            nextAttemptAt: undefined,
          });
        }
      });
    }

    await t.action(internal.notifications.dispatch.dispatchIntent, {
      intentId,
    });

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(ADMIN_EMAILS.length);
    for (const delivery of deliveries) {
      expect(delivery.attemptCount).toBe(MAX_DELIVERY_ATTEMPTS);
      expect(delivery.status).toBe("terminal_failure");
      expect(delivery.errorCode).toBe("payload_error");
      expect(delivery.nextAttemptAt).toBeUndefined();
      expect(delivery.terminalAt).toBeDefined();
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("suppresses the batch and intent when prepareEmail returns null", async () => {
    const fetchMock = stubProdTransport();
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);

    // An action-required daily report with no automationRunId has nothing to
    // rebuild from: genuinely no longer sendable, so the batch suppresses
    // rather than sending stale content.
    const intentId = await t.run((ctx) =>
      ctx.db.insert("notificationIntent", {
        kind: "eod.daily_manager_report",
        category: "eod",
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        subjectType: "store",
        subjectId: String(fixture.storeId),
        dedupeKey: `eod.daily_manager_report:${fixture.storeId}:2026-07-28:action_required`,
        payload: {
          storeId: fixture.storeId,
          operatingDate: "2026-07-28",
          status: "skipped",
        },
        status: "pending",
        emittedAt: NOW,
      }),
    );

    await t.action(internal.notifications.dispatch.dispatchIntent, {
      intentId,
    });

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(ADMIN_EMAILS.length);
    for (const delivery of deliveries) {
      expect(delivery.status).toBe("suppressed");
      expect(delivery.errorCode).toBe("payload_unavailable");
      expect(delivery.terminalAt).toBeDefined();
    }
    expect(
      await t.run((ctx) => ctx.db.get("notificationIntent", intentId)),
    ).toMatchObject({
      status: "suppressed",
      suppressedReason: "payload_unavailable",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks deliveries retryable with a future nextAttemptAt on a 500", async () => {
    stubProdTransport(500);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    const before = Date.now();
    await t.action(internal.notifications.dispatch.dispatchIntent, {
      intentId,
    });

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(ADMIN_EMAILS.length);
    for (const delivery of deliveries) {
      expect(delivery.status).toBe("retryable_failure");
      expect(delivery.errorCode).toBe("provider_500");
      expect(delivery.leaseToken).toBeUndefined();
      expect(delivery.nextAttemptAt).toBeGreaterThan(before);
    }
  });

  it("escalates a retryable provider result to terminal_failure on the final attempt", async () => {
    stubProdTransport(500);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId),
    );

    // Burn the attempt budget: each dispatch leaves a future nextAttemptAt,
    // which is cleared so the next reserve is eligible again.
    for (let attempt = 1; attempt <= MAX_DELIVERY_ATTEMPTS; attempt += 1) {
      await t.action(internal.notifications.dispatch.dispatchIntent, {
        intentId,
      });
      if (attempt < MAX_DELIVERY_ATTEMPTS) {
        await t.run(async (ctx) => {
          for (const delivery of await ctx.db
            .query("notificationDelivery")
            .take(50)) {
            await ctx.db.patch("notificationDelivery", delivery._id, {
              nextAttemptAt: undefined,
            });
          }
        });
      }
    }

    const deliveries = await listDeliveries(t);
    expect(deliveries).toHaveLength(ADMIN_EMAILS.length);
    for (const delivery of deliveries) {
      expect(delivery.attemptCount).toBe(MAX_DELIVERY_ATTEMPTS);
      // A retryable classification past the budget must not stay retryable —
      // it would be swept forever with no attempts left to spend.
      expect(delivery.status).toBe("terminal_failure");
      expect(delivery.errorCode).toBe("provider_500");
      expect(delivery.nextAttemptAt).toBeUndefined();
      expect(delivery.terminalAt).toBeDefined();
    }

    const failureEvents = (await listOperationalEvents(t)).filter(
      (event) => event.eventType === "notification_delivery_failed",
    );
    expect(failureEvents).toHaveLength(ADMIN_EMAILS.length);
    for (const event of failureEvents) {
      expect(event.metadata).toMatchObject({
        notificationKind: "pos.terminal_health",
        errorCode: "provider_500",
      });
    }
  });
});

describe("sweeper", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  type DeliveryOverrides = Partial<{
    status: "in_flight" | "retryable_failure";
    attemptCount: number;
    leaseExpiresAt: number;
    nextAttemptAt: number;
    dedupeKey: string;
  }>;

  async function insertDelivery(
    ctx: MutationCtx,
    fixture: SeededFixture,
    intentId: Id<"notificationIntent">,
    overrides: DeliveryOverrides = {},
  ) {
    return ctx.db.insert("notificationDelivery", {
      intentId,
      kind: "pos.terminal_health",
      category: "system_health",
      channel: "email",
      storeId: fixture.storeId,
      organizationId: fixture.organizationId,
      recipientEmail: "admin@example.com",
      dedupeKey: overrides.dedupeKey ?? `delivery:${Math.random()}`,
      status: overrides.status ?? "in_flight",
      attemptCount: overrides.attemptCount ?? 1,
      leaseToken:
        (overrides.status ?? "in_flight") === "in_flight"
          ? "lease-token"
          : undefined,
      leaseExpiresAt: overrides.leaseExpiresAt,
      nextAttemptAt: overrides.nextAttemptAt,
      createdAt: NOW - 10_000,
      updatedAt: NOW - 10_000,
    });
  }

  async function seedSweeperFixture(t: ReturnType<typeof convexTest>) {
    const fixture = await t.run(seedOrgStore);
    const terminalId = await t.run((ctx) => seedTerminal(ctx, fixture));
    return { fixture, terminalId };
  }

  it("recovers an expired in_flight lease under the cap as a future retry", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { fixture, terminalId } = await seedSweeperFixture(t);
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "dispatched",
      }),
    );
    const deliveryId = await t.run((ctx) =>
      insertDelivery(ctx, fixture, intentId, {
        attemptCount: 1,
        leaseExpiresAt: NOW - 1,
      }),
    );

    const result = await t.mutation(internal.notifications.sweeper.sweep, {
      now: NOW,
    });

    expect(result).toEqual({
      staleLeasesRecovered: 1,
      terminaled: 0,
      dispatchesScheduled: 0,
      intentsAbandoned: 0,
      staleLeaseBacklog: false,
      retryBacklog: false,
      pendingIntentBacklog: false,
    });
    const delivery = await t.run((ctx) =>
      ctx.db.get("notificationDelivery", deliveryId),
    );
    expect(delivery).toMatchObject({
      status: "retryable_failure",
      errorCode: "stale_delivery_lease",
    });
    expect(delivery?.leaseToken).toBeUndefined();
    expect(delivery?.nextAttemptAt).toBeGreaterThan(NOW);
  });

  it("terminals an expired lease at the attempt cap and records an operational event", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { fixture, terminalId } = await seedSweeperFixture(t);
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "dispatched",
      }),
    );
    const deliveryId = await t.run((ctx) =>
      insertDelivery(ctx, fixture, intentId, {
        attemptCount: MAX_DELIVERY_ATTEMPTS,
        leaseExpiresAt: NOW - 1,
      }),
    );

    const result = await t.mutation(internal.notifications.sweeper.sweep, {
      now: NOW,
    });

    expect(result).toEqual({
      staleLeasesRecovered: 0,
      terminaled: 1,
      dispatchesScheduled: 0,
      intentsAbandoned: 0,
      staleLeaseBacklog: false,
      retryBacklog: false,
      pendingIntentBacklog: false,
    });
    const delivery = await t.run((ctx) =>
      ctx.db.get("notificationDelivery", deliveryId),
    );
    expect(delivery).toMatchObject({
      status: "terminal_failure",
      errorCode: "stale_delivery_lease",
      terminalAt: NOW,
    });

    const events = await listOperationalEvents(t);
    const failureEvents = events.filter(
      (event) => event.eventType === "notification_delivery_failed",
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0]?.metadata).toMatchObject({
      deliveryId: String(deliveryId),
      errorCode: "stale_delivery_lease",
    });
  });

  it("schedules dispatches for due retries and stale pending intents", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { fixture, terminalId } = await seedSweeperFixture(t);
    const retryIntentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "dispatched",
        dedupeKey: "intent:retry",
      }),
    );
    await t.run((ctx) =>
      insertDelivery(ctx, fixture, retryIntentId, {
        status: "retryable_failure",
        attemptCount: 1,
        nextAttemptAt: NOW - 1,
      }),
    );
    // Pending intent older than the 60s pickup delay.
    await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "pending",
        emittedAt: NOW - 120_000,
        dedupeKey: "intent:stale-pending",
      }),
    );
    // Fresh pending intent stays with its own runAfter(0) fast path.
    await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "pending",
        emittedAt: NOW - 1_000,
        dedupeKey: "intent:fresh-pending",
      }),
    );

    const result = await t.mutation(internal.notifications.sweeper.sweep, {
      now: NOW,
    });

    expect(result).toEqual({
      staleLeasesRecovered: 0,
      terminaled: 0,
      dispatchesScheduled: 2,
      intentsAbandoned: 0,
      staleLeaseBacklog: false,
      retryBacklog: false,
      pendingIntentBacklog: false,
    });
  });

  it("respects the batch limit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { fixture, terminalId } = await seedSweeperFixture(t);
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "dispatched",
      }),
    );
    await t.run((ctx) =>
      insertDelivery(ctx, fixture, intentId, {
        leaseExpiresAt: NOW - 1,
        dedupeKey: "delivery:a",
      }),
    );
    await t.run((ctx) =>
      insertDelivery(ctx, fixture, intentId, {
        leaseExpiresAt: NOW - 1,
        dedupeKey: "delivery:b",
      }),
    );

    const result = await t.mutation(internal.notifications.sweeper.sweep, {
      now: NOW,
      limit: 1,
    });

    expect(result).toEqual({
      staleLeasesRecovered: 1,
      terminaled: 0,
      dispatchesScheduled: 0,
      intentsAbandoned: 0,
      // Saturated phase: surfaced rather than silently truncated.
      staleLeaseBacklog: true,
      retryBacklog: false,
      pendingIntentBacklog: false,
    });
    const deliveries = await listDeliveries(t);
    expect(
      deliveries.filter((delivery) => delivery.status === "in_flight"),
    ).toHaveLength(1);
  });

  it("gives each phase its own budget instead of sharing one", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { fixture, terminalId } = await seedSweeperFixture(t);
    const dispatchedIntentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "dispatched",
        dedupeKey: "intent:dispatched",
      }),
    );
    // Phase 1 saturates the limit on its own.
    await t.run((ctx) =>
      insertDelivery(ctx, fixture, dispatchedIntentId, {
        leaseExpiresAt: NOW - 1,
        dedupeKey: "delivery:stale-lease",
      }),
    );
    // A shared budget consumed by phase 1 would starve these to zero work.
    await t.run((ctx) =>
      insertDelivery(ctx, fixture, dispatchedIntentId, {
        status: "retryable_failure",
        attemptCount: 1,
        nextAttemptAt: NOW - 1,
        dedupeKey: "delivery:due-retry",
      }),
    );
    await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "pending",
        emittedAt: NOW - 120_000,
        dedupeKey: "intent:stale-pending",
      }),
    );

    const result = await t.mutation(internal.notifications.sweeper.sweep, {
      now: NOW,
      limit: 1,
    });

    expect(result).toEqual({
      staleLeasesRecovered: 1,
      terminaled: 0,
      // The due retry and the stale pending intent both got picked up.
      dispatchesScheduled: 2,
      intentsAbandoned: 0,
      staleLeaseBacklog: true,
      retryBacklog: true,
      pendingIntentBacklog: true,
    });
  });

  it("counts sweep pickups of a pending intent and abandons it past the cap", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { fixture, terminalId } = await seedSweeperFixture(t);
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "pending",
        emittedAt: NOW - 120_000,
        dedupeKey: "intent:unreservable",
      }),
    );

    // MAX_INTENT_SWEEP_ATTEMPTS pickups: each bumps the counter and still
    // schedules a dispatch.
    for (let sweepNumber = 1; sweepNumber <= 5; sweepNumber += 1) {
      const result = await t.mutation(internal.notifications.sweeper.sweep, {
        now: NOW,
      });
      expect(result).toMatchObject({
        dispatchesScheduled: 1,
        intentsAbandoned: 0,
      });
      const intent = await t.run((ctx) =>
        ctx.db.get("notificationIntent", intentId),
      );
      expect(intent?.sweepAttempts).toBe(sweepNumber);
      expect(intent?.status).toBe("pending");
    }

    const result = await t.mutation(internal.notifications.sweeper.sweep, {
      now: NOW,
    });
    expect(result).toMatchObject({
      dispatchesScheduled: 0,
      intentsAbandoned: 1,
    });

    const intent = await t.run((ctx) =>
      ctx.db.get("notificationIntent", intentId),
    );
    expect(intent).toMatchObject({
      status: "suppressed",
      suppressedReason: "dispatch_unrecoverable",
      sweepAttempts: 6,
    });

    const failureEvents = (await listOperationalEvents(t)).filter(
      (event) => event.eventType === "notification_delivery_failed",
    );
    expect(failureEvents).toHaveLength(1);
    expect(failureEvents[0]?.metadata).toMatchObject({
      notificationKind: "pos.terminal_health",
      notificationSubjectKey: String(intentId),
      errorCode: "dispatch_unrecoverable",
    });

    // Suppressed intents leave the pending queue for good.
    const afterAbandon = await t.mutation(
      internal.notifications.sweeper.sweep,
      { now: NOW },
    );
    expect(afterAbandon).toMatchObject({
      dispatchesScheduled: 0,
      intentsAbandoned: 0,
    });
  });

  it("is a no-op when nothing is eligible", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const { fixture, terminalId } = await seedSweeperFixture(t);
    const intentId = await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "dispatched",
      }),
    );
    // Live lease, future retry, and fresh pending intent: none eligible.
    await t.run((ctx) =>
      insertDelivery(ctx, fixture, intentId, {
        leaseExpiresAt: NOW + 60_000,
        dedupeKey: "delivery:live",
      }),
    );
    await t.run((ctx) =>
      insertDelivery(ctx, fixture, intentId, {
        status: "retryable_failure",
        nextAttemptAt: NOW + 60_000,
        dedupeKey: "delivery:future-retry",
      }),
    );
    await t.run((ctx) =>
      insertTerminalHealthIntent(ctx, fixture, terminalId, {
        status: "pending",
        emittedAt: NOW,
        dedupeKey: "intent:fresh",
      }),
    );

    const result = await t.mutation(internal.notifications.sweeper.sweep, {
      now: NOW,
    });

    expect(result).toEqual({
      staleLeasesRecovered: 0,
      terminaled: 0,
      dispatchesScheduled: 0,
      intentsAbandoned: 0,
      staleLeaseBacklog: false,
      retryBacklog: false,
      pendingIntentBacklog: false,
    });
  });
});

describe("seedAdminSubscriptions", () => {
  it("inserts each (org, category, admin email) subscription exactly once across runs", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);
    const secondOrgId = await t.run((ctx) =>
      ctx.db.insert("organization", {
        createdByUserId: fixture.userId,
        name: "Kumasi",
        slug: "kumasi",
      }),
    );

    const categories = ["cash_controls", "eod", "system_health"];
    const expectedCount = 2 * categories.length * ADMIN_EMAILS.length;

    const first = await t.mutation(
      internal.notifications.seed.seedAdminSubscriptions,
      {},
    );
    expect(first).toEqual({ inserted: expectedCount });

    const second = await t.mutation(
      internal.notifications.seed.seedAdminSubscriptions,
      {},
    );
    expect(second).toEqual({ inserted: 0 });

    const subscriptions = await t.run((ctx) =>
      ctx.db.query("notificationSubscription").take(100),
    );
    expect(subscriptions).toHaveLength(expectedCount);

    const keys = subscriptions.map(
      (subscription) =>
        `${subscription.organizationId}:${subscription.category}:${subscription.recipientEmail}`,
    );
    expect(new Set(keys).size).toBe(expectedCount);
    for (const organizationId of [fixture.organizationId, secondOrgId]) {
      for (const category of categories) {
        for (const admin of ADMIN_EMAILS) {
          expect(keys).toContain(
            `${organizationId}:${category}:${admin.email.toLowerCase()}`,
          );
        }
      }
    }
    expect(
      subscriptions.every(
        (subscription) =>
          subscription.enabled &&
          subscription.channel === "email" &&
          subscription.storeId === undefined,
      ),
    ).toBe(true);
  });
});
