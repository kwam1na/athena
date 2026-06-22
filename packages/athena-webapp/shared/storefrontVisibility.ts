type StorefrontCategoryVisibility = {
  showOnStorefront?: boolean;
  slug?: string;
};

type StorefrontSubcategoryVisibility = {
  slug?: string;
};

const RESERVED_STOREFRONT_CATEGORY_SLUGS = new Set(["pos-quick-add"]);
const RESERVED_STOREFRONT_SUBCATEGORY_SLUGS = new Set(["uncategorized"]);

export const isStorefrontVisibleCategory = (
  category: StorefrontCategoryVisibility | null | undefined,
) => {
  return Boolean(
    category &&
      category.showOnStorefront !== false &&
      !RESERVED_STOREFRONT_CATEGORY_SLUGS.has(category.slug ?? ""),
  );
};

export const isStorefrontVisibleSubcategory = (
  subcategory: StorefrontSubcategoryVisibility | null | undefined,
) => {
  return Boolean(
    subcategory &&
      !RESERVED_STOREFRONT_SUBCATEGORY_SLUGS.has(subcategory.slug ?? ""),
  );
};

export const isStorefrontSelectableSubcategory = (
  subcategory: StorefrontSubcategoryVisibility | null | undefined,
  parentCategory: StorefrontCategoryVisibility | null | undefined,
) => {
  return (
    isStorefrontVisibleSubcategory(subcategory) &&
    isStorefrontVisibleCategory(parentCategory)
  );
};
