import ShoppingBag from "@/components/shopping-bag/ShoppingBag";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shop/bag/")({
  component: ShoppingBag,
});
