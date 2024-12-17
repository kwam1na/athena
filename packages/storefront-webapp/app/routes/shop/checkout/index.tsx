import { createFileRoute } from "@tanstack/react-router";
import { Checkout } from "@/components/checkout/Checkout";

export const Route = createFileRoute("/shop/checkout/")({
  component: () => <Checkout />,
});
