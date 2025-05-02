import { createFileRoute } from "@tanstack/react-router";
import { AddComplimentaryProduct } from "~/src/components/products/complimentary/AddComplimentaryProduct";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/products/complimentary/new"
)({
  component: AddComplimentaryProduct,
});
