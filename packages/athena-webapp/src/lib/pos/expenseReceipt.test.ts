import { describe, expect, it } from "vitest";

import { currencyFormatter } from "~/convex/utils";

import type { CartItem } from "@/components/pos/types";

import { buildExpenseReceiptHtml } from "./expenseReceipt";

describe("buildExpenseReceiptHtml", () => {
  it("renders expense receipt facts from the completed expense data", async () => {
    const html = await buildExpenseReceiptHtml({
      store: {
        name: "Wigclub Osu",
        config: {
          contact: {
            phoneNumber: "+233 555 0100",
            location: "Oxford Street, Accra, Greater Accra, Ghana",
          },
        },
      },
      formatter: currencyFormatter("GHS"),
      reportNumber: "EXP-123456",
      completedAt: new Date("2026-05-18T15:46:00Z"),
      recordedBy: "Ama K.",
      registerNumber: "3",
      cartItems: [
        {
          id: "item-1",
          name: "nicca",
          barcode: "6935721830015",
          sku: "6N2Y-WMA-EAW",
          price: 6_500,
          quantity: 2,
          productId: "product-1",
          skuId: "sku-1",
          color: "Natural",
          length: 18,
          size: "Large",
        } as CartItem,
      ],
      totalValue: 13_000,
      notes: "Counter stock adjustment.",
    });

    expect(html).toContain("Wigclub Osu");
    expect(html).toContain("EXP-123456");
    expect(html).toContain("Ama K.");
    expect(html).toContain("Register:");
    expect(html).toContain("Nicca");
    expect(html).toContain("Large");
    expect(html).toContain("18&quot;");
    expect(html).toContain("Natural");
    expect(html).toContain("2 × GH₵65");
    expect(html).toContain("GH₵130");
    expect(html).toContain("Counter stock adjustment.");
    expect(html).toContain("+233 555 0100");
  });
});
