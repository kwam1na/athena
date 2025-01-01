import MobileProductPage from "@/components/product-page/MobileProductPage";
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
  // component: () => <MobileProductPage />,
});

const Component = () => {
  return (
    <div>
      <ProductNavigationBar />
      <div className="hidden lg:block">
        <ProductPage />
      </div>
      <div className="lg:hidden">
        <MobileProductPage />
      </div>
    </div>
  );
};
