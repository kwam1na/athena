import type { ProductAvailability } from "~/src/hooks/useGetProducts";

type CategoryProductQueryOptions = {
  availability?: ProductAvailability;
  isVisible?: boolean;
};

export function getCategoryProductQueryOptions(
  categorySlug: string | undefined,
): CategoryProductQueryOptions {
  if (
    categorySlug === "legacy-import" ||
    categorySlug === "pos-pending-checkout"
  ) {
    return {
      availability: "draft",
      isVisible: false,
    };
  }

  if (categorySlug === "pos-quick-add") {
    return { availability: "live" };
  }

  return {};
}
