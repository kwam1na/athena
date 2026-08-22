import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import PosReceiptEmail from "./PosReceiptEmail";

describe("PosReceiptEmail", () => {
  it("renders the transaction status when provided", async () => {
    const html = await render(
      <PosReceiptEmail
        storeName="Wig Club"
        receiptNumber="158503"
        completedDate="5/25/2026"
        completedTime="1:30 PM"
        items={[]}
        itemsCount={0}
        subtotal="GHS 0"
        total="GHS 0"
        paymentMethodLabel="Cash"
        statusLabel="Voided"
      />,
    );

    expect(html).toContain("Voided");
    expect(html).toContain("border-top:1px dashed #111111");
  });

  it("renders the receipt header, line items, totals, and tender detail", async () => {
    const html = await render(
      <PosReceiptEmail
        storeName="Wig Club"
        storeContact={{
          street: "2 Jungle Avenue",
          city: "East Legon",
          state: "Accra",
          country: "Ghana",
          phone: "+233555555555",
          website: "www.wigclub.store",
        }}
        receiptNumber="158503"
        completedDate="5/25/2026"
        completedTime="1:30 PM"
        registerNumber="2"
        cashierName="Ama K."
        items={[
          {
            name: "Body Wave Bundle",
            totalPrice: "GH₵1,200",
            quantityLabel: "2 x GH₵600",
            skuOrBarcode: "SKU-1001",
          },
        ]}
        itemsCount={2}
        subtotal="GH₵1,200"
        tax="GH₵60"
        total="GH₵1,260"
        paymentMethodLabel="Split payment"
        payments={[
          { method: "Cash", amount: "GH₵1,000" },
          { method: "Card", amount: "GH₵260" },
        ]}
        amountPaid="GH₵1,300"
        changeGiven="GH₵40"
      />,
    );

    expect(html).toContain("Wig Club");
    expect(html).toContain("158503");
    expect(html).toContain("Ama K.");
    expect(html).toContain("Body Wave Bundle");
    expect(html).toContain("2 x GH₵600");
    expect(html).toContain("SKU-1001");
    expect(html).toContain("GH₵1,260");
    // A split tender renders its per-method rows instead of the single
    // payment-method label.
    expect(html).not.toContain("Split payment");
    expect(html).toContain(">Cash</p>");
    expect(html).toContain("GH₵1,000");
    expect(html).toContain(">Card</p>");
    expect(html).toContain("GH₵260");
    expect(html).toContain(">Tendered</p>");
    expect(html).toContain(">Change</p>");
    expect(html).toContain("GH₵40");
    expect(html).toContain(
      "In-store purchases may be returned or exchanged within 7 days",
    );
  });
});
