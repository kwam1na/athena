import { Link } from "@tanstack/react-router";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { getOrigin } from "~/src/lib/navigationUtils";
import { Button } from "../ui/button";
import { PlusIcon } from "lucide-react";

export default function Products() {
  const categories = useGetCategories();
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
            className="border rounded-lg w-fit px-4 py-2"
          >
            <p className="text-md">{category.name}</p>
          </Link>
        ))}
      </div>
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
