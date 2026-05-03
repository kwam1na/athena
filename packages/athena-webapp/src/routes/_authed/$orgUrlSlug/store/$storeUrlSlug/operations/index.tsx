import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/operations/"
)({
  beforeLoad: ({ params }) => {
    throw redirect({
      params,
      to: "/$orgUrlSlug/store/$storeUrlSlug/operations/stock-adjustments",
    });
  },
});
