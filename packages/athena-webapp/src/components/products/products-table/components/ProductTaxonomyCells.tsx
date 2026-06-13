import { Link } from "@tanstack/react-router";
import { useQuery } from "convex/react";

import { api } from "~/convex/_generated/api";
import { Badge } from "~/src/components/ui/badge";
import { getOrigin } from "~/src/lib/navigationUtils";
import type { Product } from "~/types";

export function ProductCategoryCell({ product }: { product: Product }) {
  const canQueryCategory = Boolean(product.categoryId && product.storeId);
  const category = useQuery(
    api.inventory.categories.getById,
    canQueryCategory
      ? {
          id: product.categoryId,
          storeId: product.storeId,
        }
      : "skip",
  );
  const categoryName = category?.name ?? product.categoryName;

  return <ProductTaxonomyBadge product={product} value={categoryName} />;
}

export function ProductSubcategoryCell({ product }: { product: Product }) {
  const canQuerySubcategory = Boolean(product.subcategoryId && product.storeId);
  const subcategory = useQuery(
    api.inventory.subcategories.getById,
    canQuerySubcategory
      ? {
          id: product.subcategoryId,
          storeId: product.storeId,
        }
      : "skip",
  );
  const subcategoryName = subcategory?.name ?? product.subcategoryName;

  return <ProductTaxonomyBadge product={product} value={subcategoryName} />;
}

function ProductTaxonomyBadge({
  product,
  value,
}: {
  product: Product;
  value?: string;
}) {
  if (!value) return null;

  return (
    <div className="flex space-x-2">
      <Link
        to="/$orgUrlSlug/store/$storeUrlSlug/products/$productSlug"
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
          productSlug: product._id,
        })}
        search={{ o: getOrigin() }}
        className="flex items-center gap-8"
      >
        <div className="flex items-center gap-4">
          <Badge variant="outline" className="bg-gray-100 text-gray-700">
            <p className="text-xs">{value}</p>
          </Badge>
        </div>
      </Link>
    </div>
  );
}
