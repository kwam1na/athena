import { Link } from "@tanstack/react-router";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Button } from "../ui/button";
import { PlusIcon } from "lucide-react";
import { useGetUnresolvedProducts } from "~/src/hooks/useGetProducts";

export default function Products() {
  const categories = useGetCategories();

  const unresolvedProducts = useGetUnresolvedProducts();

  return (
    <div className="space-y-12">
      <div className="flex w-[50vw] flex-wrap gap-4">
        {categories?.map((category) => (
          <Link
            to={"/$orgUrlSlug/store/$storeUrlSlug/products"}
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
            })}
            search={{ categorySlug: category.slug, o: getOrigin() }}
            key={category._id}
          >
            <Button variant="outline">
              <p className="text-md">{category.name}</p>
            </Button>
          </Link>
        ))}
      </div>

      {Boolean(unresolvedProducts?.length) && (
        <div>
          <Link
            to={"/$orgUrlSlug/store/$storeUrlSlug/products/unresolved"}
            params={(prev) => ({
              ...prev,
              orgUrlSlug: prev.orgUrlSlug!,
              storeUrlSlug: prev.storeUrlSlug!,
            })}
            search={{ o: getOrigin() }}
          >
            <Button
              variant="outline"
              className="text-amber-700 bg-amber-50 border-amber-200 hover:bg-amber-100 hover:text-amber-700"
            >
              <span>
                <b>{unresolvedProducts?.length}</b>{" "}
                <span className="text-xs">
                  {unresolvedProducts?.length === 1 ? "product" : "products"}{" "}
                  missing information
                </span>
              </span>
            </Button>
          </Link>
        </div>
      )}

      <Link
        to={"/$orgUrlSlug/store/$storeUrlSlug/products/new"}
        params={(prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
          storeUrlSlug: prev.storeUrlSlug!,
        })}
        search={{ o: getOrigin() }}
        className="flex items-center gap-2"
      >
        <Button variant="ghost">
          <PlusIcon className="w-4 h-4" />
          <p className="text-md">New Product</p>
        </Button>
      </Link>
    </div>
  );
}
