import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useProductsTableState } from "./ProductsTableContext";
import { useGetSubcategories } from "~/src/hooks/useGetSubcategories";

function ProductSubcategoryToggleGroup() {
  const { updateProductsTableState, productsTableState } =
    useProductsTableState();

  const subcategories = useGetSubcategories();

  return (
    <ToggleGroup
      type="single"
      value={productsTableState.subcategorySlug ?? undefined}
      onValueChange={(value) => {
        updateProductsTableState({
          subcategorySlug: value,
        });
      }}
      className="flex-wrap gap-4"
    >
      {subcategories?.map((s) => (
        <ToggleGroupItem
          key={s._id}
          className="rounded-lg border"
          value={s.slug}
          aria-label={`Toggle ${s.name}`}
        >
          {s.name}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  );
}

export default ProductSubcategoryToggleGroup;
