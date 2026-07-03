import type { ProductAvailability } from "~/src/hooks/useGetProducts";

type CategoryProductQueryOptions = {
  availability?: ProductAvailability;
  isVisible?: boolean;
};

export const CATEGORY_PRODUCT_PAGE_SIZE = 10;

export function getCategoryProductPageIndex(
  page: number | string | undefined,
): number {
  const parsedPage = Number(page ?? 1);

  if (!Number.isFinite(parsedPage) || parsedPage < 1) {
    return 0;
  }

  return Math.floor(parsedPage) - 1;
}

export function writeCategoryProductPageSearch<
  TSearch extends Record<string, unknown>,
>(current: TSearch, pageIndex: number): TSearch {
  const next: Record<string, unknown> = { ...current };
  const page = Math.max(0, Math.floor(pageIndex)) + 1;

  if (page > 1) {
    next.page = page;
  } else {
    delete next.page;
  }

  return next as TSearch;
}

export function getCategoryProductQueryOptions(
  categorySlug: string | undefined,
): CategoryProductQueryOptions {
  if (
    categorySlug === "legacy-import" ||
    categorySlug === "pos-pending-checkout"
  ) {
    if (categorySlug === "pos-pending-checkout") {
      return {
        availability: "unarchived",
      };
    }

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
