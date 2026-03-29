import { Checkbox } from "../ui/checkbox";
import { Label } from "../ui/label";
import { Id } from "~/convex/_generated/dataModel";

interface Category {
  _id: Id<"category">;
  name: string;
}

interface SelectableCategoriesProps {
  categories: Category[];
  selectedCategoryIds: Set<Id<"category">>;
  setSelectedCategoryIds: React.Dispatch<
    React.SetStateAction<Set<Id<"category">>>
  >;
}

export default function SelectableCategories({
  categories,
  selectedCategoryIds,
  setSelectedCategoryIds,
}: SelectableCategoriesProps) {
  const toggle = (id: Id<"category">, checked: boolean) => {
    setSelectedCategoryIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  if (categories.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No categories found.</p>
    );
  }

  return (
    <div className="space-y-3">
      {categories.map((category) => (
        <div key={category._id} className="flex items-center gap-3">
          <Checkbox
            id={`category-${category._id}`}
            checked={selectedCategoryIds.has(category._id)}
            onCheckedChange={(checked) =>
              toggle(category._id, checked as boolean)
            }
          />
          <Label
            htmlFor={`category-${category._id}`}
            className="cursor-pointer font-normal"
          >
            {category.name}
          </Label>
        </div>
      ))}
    </div>
  );
}
