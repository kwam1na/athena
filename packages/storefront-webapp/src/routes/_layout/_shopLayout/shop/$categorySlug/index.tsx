import EntityPage from "@/components/EntityPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/_shopLayout/shop/$categorySlug/"
)({
  component: EntityPage,
});
