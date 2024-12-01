import HomePage from "@/components/HomePage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_shopLayout/shop/hair/")({
  component: HomePage,
});
