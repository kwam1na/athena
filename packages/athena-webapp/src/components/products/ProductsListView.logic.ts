import type { ProductAvailability } from "~/src/hooks/useGetProducts";

const POS_OPERATIONAL_CATEGORY_SLUGS = new Set([
  "pos-pending-checkout",
  "pos-quick-add",
]);

type CategoryProductQueryOptions = {
  availability?: ProductAvailability;
  isVisible?: boolean;
};

export function getCategoryProductQueryOptions(
  categorySlug: string | undefined,
): CategoryProductQueryOptions {
  if (categorySlug === "legacy-import") {
    return {
      availability: "draft",
      isVisible: false,
    };
  }

  if (categorySlug && POS_OPERATIONAL_CATEGORY_SLUGS.has(categorySlug)) {
    return { availability: "live" };
  }

  return {};
}
