import { describe, expect, it, vi } from "vitest";

import type { Id } from "../_generated/dataModel";
import {
  createOrReuseReceiptShareToken,
  createReceiptDeliveryAttempt,
  markReceiptDeliveryProviderAccepted,
  updateDeliveryByProviderMessageId,
} from "./repository";
import * as token from "./token";

function queryResult(firstValue: unknown) {
  return {
    withIndex: vi.fn((_indexName: string, builder: any) => {
      builder({
        eq: vi.fn().mockReturnThis(),
      });
      return queryResult(firstValue);
    }),
    first: vi.fn().mockResolvedValue(firstValue),
    collect: vi.fn().mockResolvedValue([]),
  };
}

describe("customer messaging repository", () => {
  it("does not revoke existing active receipt links when resending", async () => {
    vi.spyOn(token, "createReceiptShareToken").mockReturnValue("new-token");
    vi.spyOn(token, "hashReceiptShareToken").mockResolvedValue("new-token-hash");
    const ctx = {
      db: {
        insert: vi.fn().mockResolvedValue("token_id"),
        patch: vi.fn(),
        query: vi.fn().mockReturnValue(
          queryResult({
            _id: "existing_token_id",
            storeId: "store_123",
            status: "active",
          }),
        ),
      },
    } as any;

    await expect(
      createOrReuseReceiptShareToken(ctx, {
        storeId: "store_123" as Id<"store">,
        transactionId: "tx_123" as Id<"posTransaction">,
        now: 1_000,
      }),
    ).resolves.toEqual({
      token: "new-token",
      tokenId: "token_id",
      reused: true,
    });

    expect(ctx.db.patch).not.toHaveBeenCalled();
    expect(ctx.db.insert).toHaveBeenCalledWith(
      "receiptShareToken",
      expect.objectContaining({
        status: "active",
        tokenHash: "new-token-hash",
      }),
    );
  });

  it("creates receipt delivery attempts with POS receipt WhatsApp policy fields", async () => {
    const ctx = {
      db: {
        insert: vi.fn().mockResolvedValue("delivery_id"),
      },
    } as any;

    await expect(
      createReceiptDeliveryAttempt(ctx, {
        storeId: "store_123" as Id<"store">,
        transactionId: "tx_123" as Id<"posTransaction">,
        receiptShareTokenId: "token_123" as Id<"receiptShareToken">,
        recipient: {
          source: "one_time_override",
          phone: "+233555123456",
          display: "+********3456",
        },
        actorStaffProfileId: "staff_123" as Id<"staffProfile">,
        now: 1_000,
      }),
    ).resolves.toBe("delivery_id");

    expect(ctx.db.insert).toHaveBeenCalledWith(
      "customerMessageDelivery",
      expect.objectContaining({
        subjectType: "pos_transaction",
        subjectId: "tx_123",
        intent: "pos_receipt_link",
        channel: "whatsapp_business",
        recipientSource: "one_time_override",
        recipientPhone: "+233555123456",
        status: "pending",
      }),
    );
  });

  it("marks accepted provider messages as sent", async () => {
    const ctx = {
      db: {
        patch: vi.fn(),
      },
    } as any;

    await markReceiptDeliveryProviderAccepted(ctx, {
      deliveryId: "delivery_id" as Id<"customerMessageDelivery">,
      providerMessageId: "wamid.123",
      now: 1_000,
    });

    expect(ctx.db.patch).toHaveBeenCalledWith(
      "customerMessageDelivery",
      "delivery_id",
      {
        providerMessageId: "wamid.123",
        providerStatus: "accepted",
        status: "sent",
        sentAt: 1_000,
        updatedAt: 1_000,
      },
    );
  });

  it("updates delivery status by provider message id", async () => {
    const ctx = {
      db: {
        query: vi.fn().mockReturnValue(
          queryResult({
            _id: "delivery_id",
            deliveredAt: undefined,
            readAt: undefined,
            failedAt: undefined,
          }),
        ),
        patch: vi.fn(),
      },
    } as any;

    await expect(
      updateDeliveryByProviderMessageId(ctx, {
        providerMessageId: "wamid.123",
        status: "delivered",
        providerStatus: "delivered",
        now: 2_000,
      }),
    ).resolves.toBe("delivery_id");

    expect(ctx.db.query).toHaveBeenCalledWith("customerMessageDelivery");
    expect(ctx.db.patch).toHaveBeenCalledWith(
      "customerMessageDelivery",
      "delivery_id",
      expect.objectContaining({
        status: "delivered",
        providerStatus: "delivered",
        deliveredAt: 2_000,
      }),
    );
  });
});
