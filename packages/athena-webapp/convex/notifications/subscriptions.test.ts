/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import { ADMIN_EMAILS } from "../constants/email";
import { assertConformsToExportedReturns } from "../lib/returnValidatorContract";
import schema from "../schema";
import { SUBSCRIPTION_RESOLUTION_CAP } from "./dispatch";
import {
  SUBSCRIPTION_LIST_READ_BUDGET,
  addSubscription,
  listOrganizationMemberRecipientCandidates,
  listSubscriptionsForOrganization,
  removeSubscription,
  setSubscriptionEnabled,
} from "./subscriptions";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./notifications/"),
    loader,
  ]),
);

const NOW = Date.parse("2026-07-30T12:00:00Z");
const ACCESS_DENIED = "Notification settings unavailable.";

type AnyHandler = (ctx: unknown, args: unknown) => Promise<unknown>;

function getHandler(fn: unknown): AnyHandler {
  return (fn as { _handler: AnyHandler })._handler;
}

// Simulates an authenticated Athena user: the operation-admission actor
// short-circuit in lib/athenaUserAuth resolves identity from the admitted
// actor, so injecting one is equivalent to a signed-in session while keeping
// every database-backed authorization check (membership, row org) real.
function asAdmitted(ctx: MutationCtx, athenaUserId: Id<"athenaUser">) {
  return {
    ...ctx,
    operationAdmission: {
      actor: { kind: "normal_user" as const, athenaUserId },
    },
  };
}

type Fixture = {
  adminA: Id<"athenaUser">;
  posOnlyA: Id<"athenaUser">;
  outsider: Id<"athenaUser">;
  adminB: Id<"athenaUser">;
  organizationA: Id<"organization">;
  organizationB: Id<"organization">;
  storeA: Id<"store">;
};

async function seedFixture(ctx: MutationCtx): Promise<Fixture> {
  async function seedUser(email: string) {
    return ctx.db.insert("athenaUser", {
      email,
      normalizedEmail: email,
    });
  }
  const adminA = await seedUser("admin-a@example.com");
  const posOnlyA = await seedUser("pos-only-a@example.com");
  const outsider = await seedUser("outsider@example.com");
  const adminB = await seedUser("admin-b@example.com");

  const organizationA = await ctx.db.insert("organization", {
    createdByUserId: adminA,
    name: "Org A",
    slug: "org-a",
  });
  const organizationB = await ctx.db.insert("organization", {
    createdByUserId: adminB,
    name: "Org B",
    slug: "org-b",
  });
  const storeA = await ctx.db.insert("store", {
    createdByUserId: adminA,
    currency: "GHS",
    name: "Org A Store",
    organizationId: organizationA,
    slug: "org-a-store",
  });

  await ctx.db.insert("organizationMember", {
    organizationId: organizationA,
    userId: adminA,
    role: "full_admin",
  });
  await ctx.db.insert("organizationMember", {
    organizationId: organizationA,
    userId: posOnlyA,
    role: "pos_only",
  });
  await ctx.db.insert("organizationMember", {
    organizationId: organizationB,
    userId: adminB,
    role: "full_admin",
  });

  return {
    adminA,
    posOnlyA,
    outsider,
    adminB,
    organizationA,
    organizationB,
    storeA,
  };
}

function callList(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: Record<string, unknown>,
) {
  return t.run((ctx) =>
    getHandler(listSubscriptionsForOrganization)(asAdmitted(ctx, userId), args),
  );
}

function callListMemberCandidates(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: Record<string, unknown>,
) {
  return t.run((ctx) =>
    getHandler(listOrganizationMemberRecipientCandidates)(
      asAdmitted(ctx, userId),
      args,
    ),
  );
}

function callAdd(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: Record<string, unknown>,
) {
  return t.run((ctx) =>
    getHandler(addSubscription)(asAdmitted(ctx, userId), args),
  );
}

function callSetEnabled(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: Record<string, unknown>,
) {
  return t.run((ctx) =>
    getHandler(setSubscriptionEnabled)(asAdmitted(ctx, userId), args),
  );
}

function callRemove(
  t: ReturnType<typeof convexTest>,
  userId: Id<"athenaUser">,
  args: Record<string, unknown>,
) {
  return t.run((ctx) =>
    getHandler(removeSubscription)(asAdmitted(ctx, userId), args),
  );
}

async function insertSubscription(
  ctx: MutationCtx,
  args: {
    organizationId: Id<"organization">;
    category: "cash_controls" | "eod" | "system_health" | "approvals";
    recipientEmail: string;
    enabled?: boolean;
    storeId?: Id<"store">;
  },
) {
  return ctx.db.insert("notificationSubscription", {
    organizationId: args.organizationId,
    storeId: args.storeId,
    category: args.category,
    channel: "email",
    recipientEmail: args.recipientEmail,
    enabled: args.enabled ?? true,
    createdAt: NOW,
    updatedAt: NOW,
  });
}

async function insertApprovalsIntent(
  ctx: MutationCtx,
  fixture: Pick<Fixture, "organizationA" | "storeA">,
  dedupeSuffix: string,
) {
  // The registry has no approvals-category kind yet; reserve resolves the
  // audience from the intent row's own category and only consults the
  // registry for channels, so a registered kind with an approvals category
  // row exercises the real resolution path.
  return ctx.db.insert("notificationIntent", {
    kind: "pos.terminal_health",
    category: "approvals",
    storeId: fixture.storeA,
    organizationId: fixture.organizationA,
    subjectType: "store",
    subjectId: String(fixture.storeA),
    dedupeKey: `approvals-intent:${dedupeSuffix}`,
    payload: {},
    status: "pending",
    emittedAt: NOW,
  });
}

describe("notification subscriptions public API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists rows grouped per category for a full admin", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    await t.run(async (ctx) => {
      await insertSubscription(ctx, {
        organizationId: fixture.organizationA,
        category: "approvals",
        recipientEmail: "manager@example.com",
      });
      await insertSubscription(ctx, {
        organizationId: fixture.organizationA,
        category: "eod",
        recipientEmail: "eod@example.com",
        enabled: false,
      });
      // Another org's rows must never appear.
      await insertSubscription(ctx, {
        organizationId: fixture.organizationB,
        category: "approvals",
        recipientEmail: "other-org@example.com",
      });
    });

    const result = (await callList(t, fixture.adminA, {
      organizationId: fixture.organizationA,
    })) as {
      complete: boolean;
      categories: Array<{
        category: string;
        subscriptions: Array<Record<string, unknown>>;
      }>;
    };

    expect(result.complete).toBe(true);
    const byCategory = new Map(
      result.categories.map((group) => [group.category, group.subscriptions]),
    );
    expect([...byCategory.keys()].sort()).toEqual([
      "approvals",
      "cash_controls",
      "eod",
      "system_health",
    ]);
    expect(byCategory.get("approvals")).toHaveLength(1);
    expect(byCategory.get("approvals")![0]).toMatchObject({
      category: "approvals",
      channel: "email",
      recipientEmail: "manager@example.com",
      enabled: true,
    });
    expect(byCategory.get("eod")![0]).toMatchObject({
      recipientEmail: "eod@example.com",
      enabled: false,
    });
    expect(byCategory.get("cash_controls")).toHaveLength(0);

    // Projection only — never raw docs.
    expect(byCategory.get("approvals")![0]).not.toHaveProperty("_id");
    expect(byCategory.get("approvals")![0]).not.toHaveProperty("_creationTime");

    assertConformsToExportedReturns(listSubscriptionsForOrganization, result);
  });

  it("add inserts an org-wide normalized row that dispatch resolves as the audience", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);

    const result = (await callAdd(t, fixture.adminA, {
      organizationId: fixture.organizationA,
      category: "approvals",
      channel: "email",
      recipientEmail: "  Manager@Example.COM ",
      recipientName: "Manager",
    })) as { kind: string; data?: { subscriptionId: Id<"notificationSubscription"> } };

    expect(result.kind).toBe("ok");
    assertConformsToExportedReturns(addSubscription, result);

    const row = await t.run((ctx) =>
      ctx.db.get("notificationSubscription", result.data!.subscriptionId),
    );
    expect(row).toMatchObject({
      organizationId: fixture.organizationA,
      category: "approvals",
      channel: "email",
      recipientEmail: "manager@example.com",
      recipientName: "Manager",
      enabled: true,
    });
    expect(row?.storeId).toBeUndefined();

    const intentId = await t.run((ctx) =>
      insertApprovalsIntent(ctx, fixture, "visible"),
    );
    const reserved = await t.mutation(
      internal.notifications.dispatch.reserveIntentDeliveries,
      { intentId },
    );
    expect(reserved!.leased.map((lease) => lease.recipientEmail)).toEqual([
      "manager@example.com",
    ]);
  });

  describe("authorization", () => {
    it.each([
      ["non-member", "outsider" as const],
      ["pos_only member", "posOnlyA" as const],
      ["full_admin of another org", "adminB" as const],
    ])("rejects a %s on every mutation and the query", async (_label, who) => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      const subscriptionId = await t.run((ctx) =>
        insertSubscription(ctx, {
          organizationId: fixture.organizationA,
          category: "approvals",
          recipientEmail: "manager@example.com",
        }),
      );
      const userId = fixture[who];

      await expect(
        callList(t, userId, { organizationId: fixture.organizationA }),
      ).rejects.toThrow(ACCESS_DENIED);

      const added = (await callAdd(t, userId, {
        organizationId: fixture.organizationA,
        category: "approvals",
        channel: "email",
        recipientEmail: "intruder@example.com",
      })) as { kind: string; error?: { code: string; message: string } };
      expect(added).toMatchObject({
        kind: "user_error",
        error: { code: "authorization_failed", message: ACCESS_DENIED },
      });

      // setEnabled/remove authorize against the ROW'S organization, so a
      // caller-supplied org can never open a cross-org manipulation hole.
      const toggled = (await callSetEnabled(t, userId, {
        subscriptionId,
        enabled: false,
      })) as { kind: string; error?: { code: string } };
      expect(toggled).toMatchObject({
        kind: "user_error",
        error: { code: "authorization_failed", message: ACCESS_DENIED },
      });

      const removed = (await callRemove(t, userId, { subscriptionId })) as {
        kind: string;
      };
      expect(removed).toMatchObject({
        kind: "user_error",
        error: { code: "authorization_failed", message: ACCESS_DENIED },
      });

      const row = await t.run((ctx) =>
        ctx.db.get("notificationSubscription", subscriptionId),
      );
      expect(row).toMatchObject({ enabled: true });

      const rows = await t.run((ctx) =>
        ctx.db.query("notificationSubscription").take(10),
      );
      expect(rows).toHaveLength(1);
    });

    it("full admin of the row's own org can toggle and remove it", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      const subscriptionId = await t.run((ctx) =>
        insertSubscription(ctx, {
          organizationId: fixture.organizationA,
          category: "approvals",
          recipientEmail: "manager@example.com",
        }),
      );

      const toggled = (await callSetEnabled(t, fixture.adminA, {
        subscriptionId,
        enabled: false,
      })) as { kind: string };
      expect(toggled).toMatchObject({ kind: "ok" });
      assertConformsToExportedReturns(setSubscriptionEnabled, toggled);
      expect(
        await t.run((ctx) =>
          ctx.db.get("notificationSubscription", subscriptionId),
        ),
      ).toMatchObject({ enabled: false });

      const removed = (await callRemove(t, fixture.adminA, {
        subscriptionId,
      })) as { kind: string };
      expect(removed).toMatchObject({ kind: "ok" });
      assertConformsToExportedReturns(removeSubscription, removed);
      expect(
        await t.run((ctx) =>
          ctx.db.get("notificationSubscription", subscriptionId),
        ),
      ).toBeNull();
    });
  });

  describe("add integrity", () => {
    it("rejects a duplicate of an existing normalized email", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      const first = (await callAdd(t, fixture.adminA, {
        organizationId: fixture.organizationA,
        category: "eod",
        channel: "email",
        recipientEmail: "manager@example.com",
      })) as { kind: string };
      expect(first.kind).toBe("ok");

      const duplicate = (await callAdd(t, fixture.adminA, {
        organizationId: fixture.organizationA,
        category: "eod",
        channel: "email",
        recipientEmail: "  MANAGER@example.com ",
      })) as { kind: string; error?: { code: string } };
      expect(duplicate).toMatchObject({
        kind: "user_error",
        error: { code: "conflict" },
      });

      // Same email in a DIFFERENT category is not a duplicate.
      const otherCategory = (await callAdd(t, fixture.adminA, {
        organizationId: fixture.organizationA,
        category: "approvals",
        channel: "email",
        recipientEmail: "manager@example.com",
      })) as { kind: string };
      expect(otherCategory.kind).toBe("ok");
    });

    it("rejects an invalid email format", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      for (const recipientEmail of ["not-an-email", "a@b", "a b@example.com"]) {
        const result = (await callAdd(t, fixture.adminA, {
          organizationId: fixture.organizationA,
          category: "eod",
          channel: "email",
          recipientEmail,
        })) as { kind: string; error?: { code: string } };
        expect(result).toMatchObject({
          kind: "user_error",
          error: { code: "validation_failed" },
        });
      }
      expect(
        await t.run((ctx) => ctx.db.query("notificationSubscription").take(5)),
      ).toHaveLength(0);
    });

    it("rejects the in_app channel", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      const result = (await callAdd(t, fixture.adminA, {
        organizationId: fixture.organizationA,
        category: "eod",
        channel: "in_app",
        recipientEmail: "manager@example.com",
      })) as { kind: string; error?: { code: string } };
      expect(result).toMatchObject({
        kind: "user_error",
        error: { code: "validation_failed" },
      });
      expect(
        await t.run((ctx) => ctx.db.query("notificationSubscription").take(5)),
      ).toHaveLength(0);
    });

    it("refuses an add at the per-category cap, counting disabled rows", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      // All rows disabled: the cap protects dispatch's bounded audience read,
      // which scans every row in the category regardless of enabled state.
      await t.run(async (ctx) => {
        for (let index = 0; index < SUBSCRIPTION_RESOLUTION_CAP; index += 1) {
          await insertSubscription(ctx, {
            organizationId: fixture.organizationA,
            category: "approvals",
            recipientEmail: `capped-${index}@example.com`,
            enabled: false,
          });
        }
      });

      const refused = (await callAdd(t, fixture.adminA, {
        organizationId: fixture.organizationA,
        category: "approvals",
        channel: "email",
        recipientEmail: "one-too-many@example.com",
      })) as { kind: string; error?: { code: string; message: string } };
      expect(refused).toMatchObject({
        kind: "user_error",
        error: { code: "precondition_failed" },
      });
      expect(refused.error!.message).toContain(
        String(SUBSCRIPTION_RESOLUTION_CAP),
      );

      // The cap is per category: the same org can still add elsewhere.
      const otherCategory = (await callAdd(t, fixture.adminA, {
        organizationId: fixture.organizationA,
        category: "eod",
        channel: "email",
        recipientEmail: "one-too-many@example.com",
      })) as { kind: string };
      expect(otherCategory.kind).toBe("ok");
    });
  });

  it("list reports N+ completeness when rows exceed the read budget", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    const total = SUBSCRIPTION_LIST_READ_BUDGET + 1;
    await t.run(async (ctx) => {
      for (let index = 0; index < total; index += 1) {
        const category =
          index % 2 === 0 ? ("cash_controls" as const) : ("eod" as const);
        await insertSubscription(ctx, {
          organizationId: fixture.organizationA,
          category,
          recipientEmail: `bulk-${index}@example.com`,
        });
      }
    });

    const result = (await callList(t, fixture.adminA, {
      organizationId: fixture.organizationA,
    })) as {
      complete: boolean;
      categories: Array<{ subscriptions: unknown[] }>;
    };

    expect(result.complete).toBe(false);
    const returned = result.categories.reduce(
      (count, group) => count + group.subscriptions.length,
      0,
    );
    expect(returned).toBe(SUBSCRIPTION_LIST_READ_BUDGET);
    assertConformsToExportedReturns(listSubscriptionsForOrganization, result);
  });

  it("denies a demo-org add even for an admitted full admin", async () => {
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedFixture);
    vi.stubEnv("ATHENA_SHARED_DEMO_ENABLED", "true");
    vi.stubEnv("STAGE", "qa");
    vi.stubEnv(
      "ATHENA_SHARED_DEMO_ORGANIZATION_ID",
      String(fixture.organizationA),
    );
    vi.stubEnv("ATHENA_SHARED_DEMO_ATHENA_USER_ID", "demo-user");
    vi.stubEnv("ATHENA_SHARED_DEMO_STORE_ID", "demo-store");

    const result = (await callAdd(t, fixture.adminA, {
      organizationId: fixture.organizationA,
      category: "approvals",
      channel: "email",
      recipientEmail: "demo-target@example.com",
    })) as { kind: string; error?: { code: string; message: string } };

    expect(result).toMatchObject({
      kind: "user_error",
      error: {
        code: "authorization_failed",
        message: "This action isn't allowed in the demo.",
      },
    });
    expect(
      await t.run((ctx) => ctx.db.query("notificationSubscription").take(5)),
    ).toHaveLength(0);
  });

  describe("dispatch integration", () => {
    it("uses the enabled approvals row as the audience, and a disabled row suppresses without re-arming the fallback", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      expect(ADMIN_EMAILS.length).toBeGreaterThan(0);

      const added = (await callAdd(t, fixture.adminA, {
        organizationId: fixture.organizationA,
        category: "approvals",
        channel: "email",
        recipientEmail: "approvals-manager@example.com",
      })) as { kind: string; data?: { subscriptionId: Id<"notificationSubscription"> } };
      expect(added.kind).toBe("ok");

      const firstIntent = await t.run((ctx) =>
        insertApprovalsIntent(ctx, fixture, "enabled-audience"),
      );
      const reserved = await t.mutation(
        internal.notifications.dispatch.reserveIntentDeliveries,
        { intentId: firstIntent },
      );
      // The audience is exactly the subscription row — not ADMIN_EMAILS.
      expect(reserved!.leased.map((lease) => lease.recipientEmail)).toEqual([
        "approvals-manager@example.com",
      ]);

      const toggled = (await callSetEnabled(t, fixture.adminA, {
        subscriptionId: added.data!.subscriptionId,
        enabled: false,
      })) as { kind: string };
      expect(toggled.kind).toBe("ok");

      const secondIntent = await t.run((ctx) =>
        insertApprovalsIntent(ctx, fixture, "disabled-audience"),
      );
      const reservedAfterDisable = await t.mutation(
        internal.notifications.dispatch.reserveIntentDeliveries,
        { intentId: secondIntent },
      );

      // Disabling the only subscriber must suppress with no_recipients — the
      // ADMIN_EMAILS fallback is a pre-seed bridge keyed off "no rows at
      // all", and a disabled row is a row. Re-arming it here would silently
      // re-broadcast to the hardcoded admin list.
      expect(reservedAfterDisable).toBeNull();
      expect(
        await t.run((ctx) => ctx.db.get("notificationIntent", secondIntent)),
      ).toMatchObject({
        status: "suppressed",
        suppressedReason: "no_recipients",
      });
      const deliveries = await t.run((ctx) =>
        ctx.db
          .query("notificationDelivery")
          .withIndex("by_intentId", (q) => q.eq("intentId", secondIntent))
          .take(10),
      );
      expect(deliveries).toHaveLength(0);
    });
  });

  describe("listOrganizationMemberRecipientCandidates", () => {
    it("lists org members with operationalRoles populated, including a manager", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      await t.run(async (ctx) => {
        const [adminMembership] = await ctx.db
          .query("organizationMember")
          .withIndex("by_organizationId_userId", (q) =>
            q
              .eq("organizationId", fixture.organizationA)
              .eq("userId", fixture.adminA),
          )
          .take(1);
        await ctx.db.patch("organizationMember", adminMembership!._id, {
          operationalRoles: ["manager"],
        });
      });

      const result = (await callListMemberCandidates(t, fixture.adminA, {
        organizationId: fixture.organizationA,
      })) as Array<{
        userId: Id<"athenaUser">;
        displayName: string;
        email: string;
        role: string;
        operationalRoles: string[];
      }>;

      expect(result).toHaveLength(2);
      const byUserId = new Map(result.map((row) => [row.userId, row]));
      expect(byUserId.get(fixture.adminA)).toMatchObject({
        email: "admin-a@example.com",
        role: "full_admin",
        operationalRoles: ["manager"],
      });
      // Only this org's members appear — org B's admin is never leaked.
      expect(byUserId.has(fixture.adminB)).toBe(false);

      assertConformsToExportedReturns(
        listOrganizationMemberRecipientCandidates,
        result,
      );
    });

    it("still lists a member without operationalRoles, projected as []", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);

      const result = (await callListMemberCandidates(t, fixture.adminA, {
        organizationId: fixture.organizationA,
      })) as Array<{ userId: Id<"athenaUser">; operationalRoles: string[] }>;

      const posOnly = result.find((row) => row.userId === fixture.posOnlyA);
      expect(posOnly).toBeDefined();
      expect(posOnly!.operationalRoles).toEqual([]);
      assertConformsToExportedReturns(
        listOrganizationMemberRecipientCandidates,
        result,
      );
    });

    it("projects only the documented fields — no extra athenaUser columns", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);

      const result = (await callListMemberCandidates(t, fixture.adminA, {
        organizationId: fixture.organizationA,
      })) as Array<Record<string, unknown>>;

      for (const row of result) {
        expect(Object.keys(row).sort()).toEqual(
          ["displayName", "email", "operationalRoles", "role", "userId"].sort(),
        );
      }
    });

    it.each([
      ["non-member", "outsider" as const],
      ["pos_only member", "posOnlyA" as const],
      ["full_admin of another org", "adminB" as const],
    ])("rejects a %s", async (_label, who) => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);

      await expect(
        callListMemberCandidates(t, fixture[who], {
          organizationId: fixture.organizationA,
        }),
      ).rejects.toThrow(ACCESS_DENIED);
    });
  });

  describe("seedApprovalsManagerSubscriptions", () => {
    it("seeds org-wide approvals rows from manager members, skips seeded orgs, and is idempotent", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      await t.run(async (ctx) => {
        // adminA is also an operational manager; posOnlyA is not.
        const [adminMembership] = await ctx.db
          .query("organizationMember")
          .withIndex("by_organizationId_userId", (q) =>
            q
              .eq("organizationId", fixture.organizationA)
              .eq("userId", fixture.adminA),
          )
          .take(1);
        await ctx.db.patch("organizationMember", adminMembership!._id, {
          operationalRoles: ["manager"],
        });
        // A second manager in org A with a duplicate (differently cased)
        // email collapses to one row.
        const duplicateManager = await ctx.db.insert("athenaUser", {
          email: "Admin-A@example.com",
        });
        await ctx.db.insert("organizationMember", {
          organizationId: fixture.organizationA,
          userId: duplicateManager,
          role: "pos_only",
          operationalRoles: ["manager", "cashier"],
        });
        // Org B already has an approvals row: skipped entirely.
        await insertSubscription(ctx, {
          organizationId: fixture.organizationB,
          category: "approvals",
          recipientEmail: "existing@example.com",
        });
        const [adminBMembership] = await ctx.db
          .query("organizationMember")
          .withIndex("by_organizationId_userId", (q) =>
            q
              .eq("organizationId", fixture.organizationB)
              .eq("userId", fixture.adminB),
          )
          .take(1);
        await ctx.db.patch("organizationMember", adminBMembership!._id, {
          operationalRoles: ["manager"],
        });
      });

      const first = await t.mutation(
        internal.notifications.seed.seedApprovalsManagerSubscriptions,
        {},
      );
      expect(first).toEqual({ inserted: 1 });

      const orgARows = await t.run((ctx) =>
        ctx.db
          .query("notificationSubscription")
          .withIndex("by_organizationId_and_category", (q) =>
            q
              .eq("organizationId", fixture.organizationA)
              .eq("category", "approvals"),
          )
          .take(10),
      );
      expect(orgARows).toHaveLength(1);
      expect(orgARows[0]).toMatchObject({
        category: "approvals",
        channel: "email",
        recipientEmail: "admin-a@example.com",
        enabled: true,
      });
      expect(orgARows[0]?.storeId).toBeUndefined();

      // Org B kept only its pre-existing row.
      const orgBRows = await t.run((ctx) =>
        ctx.db
          .query("notificationSubscription")
          .withIndex("by_organizationId_and_category", (q) =>
            q
              .eq("organizationId", fixture.organizationB)
              .eq("category", "approvals"),
          )
          .take(10),
      );
      expect(orgBRows).toHaveLength(1);
      expect(orgBRows[0]).toMatchObject({
        recipientEmail: "existing@example.com",
      });

      // Re-run: org A now has approvals rows, so nothing is inserted.
      const second = await t.mutation(
        internal.notifications.seed.seedApprovalsManagerSubscriptions,
        {},
      );
      expect(second).toEqual({ inserted: 0 });
    });

    it("does not touch other categories or seedAdminSubscriptions behavior", async () => {
      const t = convexTest(schema, modules);
      const fixture = await t.run(seedFixture);
      await t.run(async (ctx) => {
        const [membership] = await ctx.db
          .query("organizationMember")
          .withIndex("by_organizationId_userId", (q) =>
            q
              .eq("organizationId", fixture.organizationA)
              .eq("userId", fixture.adminA),
          )
          .take(1);
        await ctx.db.patch("organizationMember", membership!._id, {
          operationalRoles: ["manager"],
        });
      });

      await t.mutation(
        internal.notifications.seed.seedApprovalsManagerSubscriptions,
        {},
      );
      const nonApprovals = await t.run(async (ctx) => {
        const rows = await ctx.db.query("notificationSubscription").take(50);
        return rows.filter((row) => row.category !== "approvals");
      });
      expect(nonApprovals).toHaveLength(0);
    });
  });
});
