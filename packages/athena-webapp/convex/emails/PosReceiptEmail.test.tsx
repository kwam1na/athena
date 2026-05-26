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
});
