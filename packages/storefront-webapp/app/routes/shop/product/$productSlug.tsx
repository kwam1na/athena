import ProductPage from "@/components/product-page/ProductPage";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shop/product/$productSlug")({
  component: ProductPage,
});
