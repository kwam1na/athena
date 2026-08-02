/// <reference types="vite/client" />

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { convexTest } from "convex-test";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";
import { emitNotificationWithCtx } from "../notifications/emit";
import { insertApprovalRequestWithCtx } from "./approvalRequestHelpers";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.replace(/^\.\.\//, "./"),
    loader,
  ]),
);

const NOW = Date.parse("2026-07-29T12:00:00Z");

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

function listIntents(t: ReturnType<typeof convexTest>) {
  return t.run((ctx) => ctx.db.query("notificationIntent").take(10));
}

describe("insertApprovalRequestWithCtx", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("inserts the request and emits exactly one approvals.request_created intent for non-variance types", async () => {
    // Fake timers keep the emit-scheduled dispatch inert; this test is about
    // the in-transaction insert + intent seam only.
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);

    const approvalRequestId = await t.run((ctx) =>
      insertApprovalRequestWithCtx(ctx, {
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        requestType: "pos_transaction_void",
        subjectType: "pos_transaction",
        subjectId: "tx-1",
        reason: "Manager approval is required to void a completed sale.",
      }),
    );

    const request = await t.run((ctx) =>
      ctx.db.get("approvalRequest", approvalRequestId),
    );
    expect(request).toMatchObject({
      requestType: "pos_transaction_void",
      status: "pending",
      storeId: fixture.storeId,
      subjectId: "tx-1",
      subjectType: "pos_transaction",
    });
    expect(request?.createdAt).toEqual(expect.any(Number));

    const intents = await listIntents(t);
    expect(intents).toHaveLength(1);
    expect(intents[0]).toMatchObject({
      kind: "approvals.request_created",
      category: "approvals",
      dedupeKey: `approvals.request_created:${approvalRequestId}`,
      storeId: fixture.storeId,
      organizationId: fixture.organizationId,
      subjectType: "approvalRequest",
      subjectId: String(approvalRequestId),
      payload: {
        approvalRequestId,
        storeId: fixture.storeId,
        requestType: "pos_transaction_void",
      },
      status: "pending",
    });
  });

  it("inserts variance_review requests WITHOUT emitting — that lane is owned by register.closeout_variance", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);

    const approvalRequestId = await t.run((ctx) =>
      insertApprovalRequestWithCtx(ctx, {
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        requestType: "variance_review",
        subjectType: "register_session",
        subjectId: "register-session-1",
        reason: "Variance exceeded threshold",
      }),
    );

    expect(
      await t.run((ctx) => ctx.db.get("approvalRequest", approvalRequestId)),
    ).toMatchObject({
      requestType: "variance_review",
      status: "pending",
    });

    expect(await listIntents(t)).toHaveLength(0);
  });

  it("re-emitting for the same request id is idempotent (created:false, still one intent)", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const t = convexTest(schema, modules);
    const fixture = await t.run(seedOrgStore);

    const approvalRequestId = await t.run((ctx) =>
      insertApprovalRequestWithCtx(ctx, {
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        requestType: "inventory_adjustment_review",
        subjectType: "stock_adjustment_batch",
        subjectId: "batch-1",
      }),
    );

    const replay = await t.run((ctx) =>
      emitNotificationWithCtx(ctx, {
        kind: "approvals.request_created",
        storeId: fixture.storeId,
        organizationId: fixture.organizationId,
        subjectType: "approvalRequest",
        subjectId: String(approvalRequestId),
        payload: {
          approvalRequestId,
          storeId: fixture.storeId,
          requestType: "inventory_adjustment_review",
        },
      }),
    );

    expect(replay.created).toBe(false);
    expect(await listIntents(t)).toHaveLength(1);
  });

  it("keeps the variance carve-out visible at the helper choke point", () => {
    const source = readFileSync(
      join(process.cwd(), "convex/operations/approvalRequestHelpers.ts"),
      "utf8",
    );
    expect(source).toContain('"approvalRequest"');
    expect(source).toContain("REQUEST_TYPES_WITHOUT_CREATED_NOTIFICATION");
    expect(source).toContain('"variance_review"');
    expect(source).toContain("register.closeout_variance");
  });
});
