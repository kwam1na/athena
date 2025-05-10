import { createFileRoute } from "@tanstack/react-router";
import { ReviewsView } from "~/src/components/reviews/ReviewsView";

export const Route = createFileRoute(
  "/_authed/$orgUrlSlug/store/$storeUrlSlug/reviews/"
)({
  component: ReviewsView,
});
