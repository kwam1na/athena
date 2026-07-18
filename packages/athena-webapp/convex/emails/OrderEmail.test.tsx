import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import { OrderEmail, orderEmailPreviewProps } from "./OrderEmail";

describe("OrderEmail", () => {
  it("renders a restrained customer order report with clear fulfillment hierarchy", async () => {
    const html = await render(<OrderEmail {...orderEmailPreviewProps} />);

    expect(html).toContain("font-family:Inter, -apple-system");
    expect(html).toContain("max-width:640px;background-color:#ffffff");
    expect(html).toContain("Wigclub");
    expect(html).toContain("Order confirmed");
    expect(html).toContain("Thanks for your order, John");
    expect(html).not.toContain("Order update");
    expect(html).not.toContain("Order status");
    expect(html).toContain("border-left:3px solid #2d7d4f");
    expect(html).toContain("Order details");
    expect(html).toContain("Items");
    expect(html).toContain("Delivery details");
    expect(html).toContain("Order summary");
    expect(html).toContain("Sample Product");
    expect(html).toContain("Black · 16 inches · Qty 2");
    expect(html).toContain("$45.00");
    expect(html).toContain("text-decoration:line-through");
    expect(html).toContain("Total");
    expect(html).toContain("$100.00");
    expect(html).not.toContain("THANKS FOR YOUR ORDER");
    expect(html).not.toContain("#faeaf0");
  });

  it.each([
    ["ready", "Your order is ready", "#2867b2"],
    ["complete", "Order complete", "#2d7d4f"],
    ["canceled", "Order canceled", "#b5483f"],
  ] as const)(
    "renders the %s lifecycle state without changing the order content",
    async (type, title, accent) => {
      const html = await render(
        <OrderEmail {...orderEmailPreviewProps} type={type} />,
      );

      expect(html).toContain(title);
      expect(html).toContain(`border-left:3px solid ${accent}`);
      expect(html).toContain(orderEmailPreviewProps.order_number);
      expect(html).toContain(orderEmailPreviewProps.items[0].text);
    },
  );

  it("does not invent preview items in a production render", async () => {
    const html = await render(
      <OrderEmail {...orderEmailPreviewProps} items={[]} />,
    );

    expect(html).toContain("No items were included in this order.");
    expect(html).not.toContain(orderEmailPreviewProps.items[0].text);
  });
});
