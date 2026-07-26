import { useState } from "react";
import { useGetStoreCategories } from "../navigation/hooks";
import { Button } from "../ui/button";
import { ChevronLeft } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { capitalizeWords, slugToWords } from "@/lib/utils";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "../ui/sheet";

export function MobileMenu({ onCloseClick }: { onCloseClick: () => void }) {
  const { categories, categoryToSubcategoriesMap } = useGetStoreCategories();
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  return (
    <Sheet open onOpenChange={(open) => !open && onCloseClick()}>
      <SheetContent
        side="left"
        className="w-full max-w-none overflow-y-auto px-gutter pb-safe-bottom sm:max-w-none"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Storefront menu</SheetTitle>
          <SheetDescription>Browse product categories.</SheetDescription>
        </SheetHeader>
        {selectedCategory && (
          <Button variant="clear" onClick={() => setSelectedCategory(null)}>
            <ChevronLeft className="mr-2 h-5 w-5" />
            All categories
          </Button>
        )}
        {!selectedCategory && (
          <div className="flex flex-col gap-layout-lg pt-layout-3xl">
            {categories?.map((category) => (
              <button
                key={category.value}
                type="button"
                className="min-h-11 rounded-md text-left text-lg font-light hover:text-muted-foreground"
                onClick={() => setSelectedCategory(category.value)}
              >
                {category.label}
              </button>
            ))}
          </div>
        )}
        {selectedCategory && (
          <div className="flex flex-col gap-layout-lg pt-layout-xl">
            <Link
              to="/shop/$categorySlug"
              params={(params) => ({
                ...params,
                categorySlug: selectedCategory,
              })}
              onClick={onCloseClick}
              className="flex min-h-11 items-center text-lg"
            >
              {`Shop all ${capitalizeWords(slugToWords(selectedCategory))}`}
            </Link>
            {categoryToSubcategoriesMap?.[selectedCategory]?.map((item) => (
              <Link
                key={item.value}
                to="/shop/$categorySlug/$subcategorySlug"
                params={(params) => ({
                  ...params,
                  categorySlug: selectedCategory,
                  subcategorySlug: item.value,
                })}
                onClick={onCloseClick}
                className="flex min-h-11 items-center text-lg"
              >
                {item.label}
              </Link>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
