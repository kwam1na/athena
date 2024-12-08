import ProductPage from "@/components/product-page/ProductPage";
import { ProductNavigationBar } from "@/components/product-page/ProductsNavigationBar";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

const productPageSchema = z.object({
  variant: z.string().optional().catch(""),
});

export const Route = createFileRoute("/shop/product/$productSlug")({
  validateSearch: productPageSchema,
  component: () => <Component />,
});

const Component = () => {
  return (
    <div>
      <ProductNavigationBar />
      <ProductPage />
    </div>
  );
};
