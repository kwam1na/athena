import { ReviewEditor } from "@/components/product-reviews/ReviewEditor";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute(
  "/_layout/_ordersLayout/shop/orders/$orderId/$orderItemId/review"
)({
  component: ReviewEditor,
});
