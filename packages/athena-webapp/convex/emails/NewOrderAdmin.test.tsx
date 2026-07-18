import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import { NewOrderAdmin, newOrderAdminPreviewProps } from "./NewOrderAdmin";

describe("NewOrderAdmin", () => {
  it("renders a compact operational new-order report", async () => {
    const html = await render(
      <NewOrderAdmin {...newOrderAdminPreviewProps} />,
    );

    expect(html).toContain("font-family:Inter, -apple-system");
    expect(html).toContain("max-width:640px;background-color:#ffffff");
    expect(html).toContain("New order received");
    expect(html).toContain("Order WC-001");
    expect(html).toContain("John Doe");
    expect(html).toContain("Pending");
    expect(html).toContain("border-left:3px solid #2867b2");
    expect(html).toContain("Items");
    expect(html).toContain("Delivery details");
    expect(html).toContain("Order summary");
    expect(html).toContain("Sample Product");
    expect(html).toContain("Black · 16 inches · Qty 2");
    expect(html).toContain("GH₵150");
    expect(html).toContain("View order");
    expect(html).toContain(newOrderAdminPreviewProps.appUrl);
    expect(html).toContain("background-color:#1b1c1f");
    expect(html).not.toContain("#faeaf0");
    expect(html).not.toContain("border-radius:999px");
  });

  it("renders a useful empty state without preview products", async () => {
    const html = await render(
      <NewOrderAdmin {...newOrderAdminPreviewProps} items={[]} />,
    );

    expect(html).toContain("No items were included in this order.");
    expect(html).not.toContain(newOrderAdminPreviewProps.items[0].text);
  });
});
