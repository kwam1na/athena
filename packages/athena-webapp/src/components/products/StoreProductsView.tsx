import StoreProducts from "./StoreProducts";
import View from "../View";
import { useGetProducts } from "../../hooks/useGetProducts";
import {
  ProductsTableProvider,
  useProductsTableState,
} from "./ProductsTableContext";
import { FadeIn } from "../common/FadeIn";
import { useSearch } from "@tanstack/react-router";
import { slugToWords } from "~/src/lib/utils";

const Navigation = () => {
  const { categorySlug } = useSearch({ strict: false });
  return (
    <div className="container mx-auto flex gap-2 h-[40px]">
      <div className="flex items-center">
        <p className="text-xl font-medium capitalize">
          {slugToWords(categorySlug ?? "Products")}
        </p>
      </div>
    </div>
  );
};

function Body() {
  const { productsTableState } = useProductsTableState();
  const { categorySlug } = useSearch({ strict: false });
  const { subcategorySlug } = productsTableState;
  const products = useGetProducts({
    subcategorySlug: subcategorySlug ?? undefined,
    categorySlug: categorySlug ?? undefined,
  });

  if (!products) return null;

  const hasProducts = products.length > 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      header={hasProducts && <Navigation />}
    >
      <FadeIn>
        <StoreProducts products={products} />
      </FadeIn>
    </View>
  );
}

export default function StoreProductsView() {
  return (
    <ProductsTableProvider>
      <Body />
    </ProductsTableProvider>
  );
}
