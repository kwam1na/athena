import { useSearch } from "@tanstack/react-router";
import CategoryListView from "./CategoryListView";
import ProductsListView from "./ProductsListView";

export default function ProductsView() {
  const { categorySlug } = useSearch({ strict: false });

  // Show category list when no categorySlug is present
  if (!categorySlug) {
    return <CategoryListView />;
  }

  // Show filtered products table when categorySlug is present
  return <ProductsListView />;
}
