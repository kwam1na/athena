import { render } from "@react-email/components";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  OrderEmail,
  orderEmailPreviewProps,
  orderEmailPreviewVariants,
} from "./OrderEmail";

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
    expect(html).not.toContain("border-left:3px solid");
    expect(html).toContain("Order details");
    expect(html).toContain("Items");
    expect(html).toContain("Delivery details");
    expect(html).not.toContain("Store hours");
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
    ["ready", "Your order is ready"],
    ["complete", "Order complete"],
    ["canceled", "Order canceled"],
  ] as const)(
    "renders the %s lifecycle state without changing the order content",
    async (type, title) => {
      const html = await render(
        <OrderEmail {...orderEmailPreviewProps} type={type} />,
      );

      expect(html).toContain(title);
      expect(html).not.toContain("border-left:3px solid");
      expect(html).toContain(orderEmailPreviewProps.order_number);
      expect(html).toContain(orderEmailPreviewProps.items[0].text);
    },
  );

  it("uses the ready-state subheader for the customer", async () => {
    const html = await render(
      <OrderEmail {...orderEmailPreviewVariants.readyPickup} />,
    );

    expect(html).toContain("Get excited, John");
    expect(html).not.toContain("Your order is ready, John");
    expect(html).toContain("Your order is ready for pickup");
    expect(html).toContain("Store hours");
    expect(html).toContain("Mon–Fri");
    expect(html).toContain("9:00 AM–6:00 PM");
    expect(html).toContain("Sun");
    expect(html).toContain("Closed");
  });

  it("gives the out-for-delivery band its own state hierarchy", async () => {
    const html = await render(
      <OrderEmail {...orderEmailPreviewVariants.outForDelivery} />,
    );

    expect(html).toContain("Your order is on the way");
    expect(html).toContain("It’s headed to your delivery address.");
  });

  it.each([
    ["readyDelivery", "Your order is ready for delivery"],
    ["complete", "Order complete"],
    ["canceled", "Order canceled"],
  ] as const)("renders the %s preview content", async (variant, title) => {
    const html = await render(
      <OrderEmail {...orderEmailPreviewVariants[variant]} />,
    );

    expect(html).toContain(title);
    expect(html).toContain(orderEmailPreviewVariants[variant].pickup_details);
    expect(html).not.toContain("Store hours");
  });

  it("provides state-accurate fixtures for every preview variant", () => {
    expect(Object.keys(orderEmailPreviewVariants)).toEqual([
      "confirmation",
      "readyPickup",
      "readyDelivery",
      "outForDelivery",
      "complete",
      "canceled",
    ]);

    expect(orderEmailPreviewVariants.confirmation).toMatchObject({
      type: "confirmation",
      order_status_messaging:
        "We received your order and will let you know when it is ready.",
    });
    expect(orderEmailPreviewVariants.readyPickup).toMatchObject({
      type: "ready",
      status_title: "Your order is ready for pickup",
      pickup_type: "Pickup",
      order_status_messaging:
        "Pick it up at Wigclub during store hours. Bring this email when you visit us.",
    });
    expect(orderEmailPreviewVariants.readyDelivery).toMatchObject({
      type: "ready",
      status_title: "Your order is ready for delivery",
      pickup_type: "Delivery",
      pickup_details: "9 Cashew Link, Adjiriganor, Greater Accra, Ghana",
      order_status_messaging:
        "We’ll let you know as soon as it’s on the way.",
    });
    expect(orderEmailPreviewVariants.outForDelivery).toMatchObject({
      type: "ready",
      status_title: "Your order is on the way",
      pickup_type: "Delivery",
      pickup_details: "9 Cashew Link, Adjiriganor, Greater Accra, Ghana",
      order_status_messaging: "It’s headed to your delivery address.",
    });
    expect(orderEmailPreviewVariants.complete).toMatchObject({
      type: "complete",
      order_status_messaging:
        "Your order has been delivered. We hope you enjoy your purchase.",
    });
    expect(orderEmailPreviewVariants.canceled).toMatchObject({
      type: "canceled",
      order_status_messaging:
        "Your order has been canceled. Contact us if you have any questions.",
    });
  });

  it.each([
    ["Ready", "readyPickup"],
    ["ReadyDelivery", "readyDelivery"],
    ["OutForDelivery", "outForDelivery"],
    ["Complete", "complete"],
    ["Canceled", "canceled"],
  ])(
    "exposes the %s state as a dedicated React Email preview",
    (state, fixture) => {
      const source = readFileSync(
        join(process.cwd(), `convex/emails/OrderEmail${state}.tsx`),
        "utf8",
      );

      expect(source).toContain(`orderEmailPreviewVariants.${fixture}`);
      expect(source).toContain("export default function");
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
