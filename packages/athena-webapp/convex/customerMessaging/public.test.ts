import { describe, expect, it } from "vitest";

import { toPublicReceiptTransaction } from "./public";

describe("customer messaging public receipt payload", () => {
  it("omits operator-only transaction fields from customer receipt responses", () => {
    const receipt = toPublicReceiptTransaction({
      _id: "txn_1",
      transactionNumber: "POS-1",
      subtotal: 100,
      tax: 10,
      total: 110,
      hasTrace: true,
      sessionTraceId: "trace_1",
      registerNumber: "R1",
      registerSessionId: "register_session_1",
      paymentMethod: "cash",
      payments: [{ method: "cash", amount: 110, timestamp: 1 }],
      totalPaid: 110,
      changeGiven: 0,
      status: "completed",
      completedAt: 1,
      notes: "operator note",
      cashier: {
        _id: "staff_1",
        firstName: "Ada",
        lastName: "Lovelace",
        name: "Ada Lovelace",
        email: "ada@example.com",
        phone: "+233555123456",
      },
      customer: {
        _id: "customer_1",
        name: "Customer",
        phone: "+233555000000",
      },
      customerInfo: {
        name: "Customer",
        phone: "+233555000000",
      },
      receiptDeliveryHistory: [
        {
          recipientDisplay: "+********0000",
          status: "sent",
        },
      ],
      correctionHistory: [{ eventType: "correction" }],
      items: [
        {
          _id: "item_1",
          productId: "product_1",
          productSkuId: "sku_1",
          productName: "Product",
          productSku: "SKU-1",
          quantity: 1,
          unitPrice: 110,
          totalPrice: 110,
        },
      ],
    } as any);

    expect(receipt).toEqual(
      expect.objectContaining({
        transactionNumber: "POS-1",
        total: 110,
      }),
    );
    expect(receipt).not.toHaveProperty("_id");
    expect(receipt).not.toHaveProperty("customer");
    expect(receipt).not.toHaveProperty("customerInfo");
    expect(receipt).not.toHaveProperty("notes");
    expect(receipt).not.toHaveProperty("receiptDeliveryHistory");
    expect(receipt).not.toHaveProperty("correctionHistory");
    expect(receipt.items[0]).not.toHaveProperty("_id");
    expect(receipt.items[0]).not.toHaveProperty("productId");
    expect(receipt.items[0]).not.toHaveProperty("productSkuId");
    expect(receipt.cashier).toBeNull();
  });
});
