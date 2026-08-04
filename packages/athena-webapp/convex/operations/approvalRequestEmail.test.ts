/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, it } from "vitest";

import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import schema from "../schema";

const modules = Object.fromEntries(
  Object.entries(import.meta.glob("../**/*.ts")).map(([path, loader]) => [
    path.startsWith("../")
      ? path.replace(/^\.\.\//, "./")
      : path.replace(/^\.\//, "./operations/"),
    loader,
  ]),
);

describe("getApprovalRequestPendingPayload", () => {
  async function seedStore(ctx: MutationCtx) {
    const userId = await ctx.db.insert("athenaUser", {
      email: "owner@example.com",
      normalizedEmail: "owner@example.com",
    });
    const organizationId = await ctx.db.insert("organization", {
      createdByUserId: userId,
      name: "Wigclub",
      slug: "wigclub",
    });
    const storeId = await ctx.db.insert("store", {
      createdByUserId: userId,
      currency: "GHS",
      name: "Wigclub",
      organizationId,
      slug: "wigclub",
    });
    return { organizationId, storeId };
  }

  function insertPaymentCorrection(
    ctx: MutationCtx,
    storeId: Id<"store">,
    overrides: {
      notes?: string;
      transactionNumber?: string;
    } = {},
  ) {
    return ctx.db.insert("approvalRequest", {
      createdAt: 1,
      metadata: {
        amount: 159000,
        paymentMethod: "mobile_money",
        previousPaymentMethod: "cash",
        transactionNumber: overrides.transactionNumber ?? "532044",
      },
      reason:
        "Manager approval is required to correct a completed transaction payment method.",
      requestType: "payment_method_correction",
      status: "pending",
      storeId,
      subjectId: "txn-1",
      subjectType: "pos_transaction",
      ...(overrides.notes === undefined ? {} : { notes: overrides.notes }),
    });
  }

  const ask = (
    t: ReturnType<typeof convexTest>,
    approvalRequestId: Awaited<ReturnType<typeof insertPaymentCorrection>>,
  ) =>
    t.query(
      internal.operations.approvalRequestEmail
        .getApprovalRequestPendingPayload,
      { approvalRequestId },
    );

  it("prefixes the transaction number everywhere it is surfaced", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    const approvalRequestId = await t.run((ctx) =>
      insertPaymentCorrection(ctx, seeded.storeId),
    );

    const payload = await ask(t, approvalRequestId);

    expect(payload?.data?.transactionNumber).toBe("#532044");
    // The subtitle and the subject both resolve from the identifier, so the
    // prefix must reach it too.
    expect(payload?.identifier).toBe("#532044");
  });

  it("does not double up on a producer that already stamped a hash", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    const approvalRequestId = await t.run((ctx) =>
      insertPaymentCorrection(ctx, seeded.storeId, {
        transactionNumber: "#532044",
      }),
    );

    expect((await ask(t, approvalRequestId))?.data?.transactionNumber).toBe(
      "#532044",
    );
  });

  it("capitalizes both payment methods", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    const approvalRequestId = await t.run((ctx) =>
      insertPaymentCorrection(ctx, seeded.storeId),
    );

    const payload = await ask(t, approvalRequestId);

    expect(payload?.data?.previousPaymentMethod).toBe("Cash");
    expect(payload?.data?.paymentMethod).toBe("Mobile Money");
  });

  it("surfaces the requester's note alongside the policy reason", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    const approvalRequestId = await t.run((ctx) =>
      insertPaymentCorrection(ctx, seeded.storeId, {
        notes: "Customer paid with card, I rang it as cash.",
      }),
    );

    const payload = await ask(t, approvalRequestId);

    expect(payload?.requesterNote).toBe(
      "Customer paid with card, I rang it as cash.",
    );
    expect(payload?.reason).toContain("Manager approval is required");
  });

  it("leaves the note undefined when absent or blank", async () => {
    const t = convexTest(schema, modules);
    const seeded = await t.run(seedStore);
    const [withoutNote, withBlankNote] = await t.run(async (ctx) => [
      await insertPaymentCorrection(ctx, seeded.storeId),
      await insertPaymentCorrection(ctx, seeded.storeId, { notes: "   " }),
    ]);

    expect((await ask(t, withoutNote))?.requesterNote).toBeUndefined();
    expect((await ask(t, withBlankNote))?.requesterNote).toBeUndefined();
  });
});
