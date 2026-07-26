import ProductFilter from "@/components/filter/ProductFilter";
import ProductFilterBar from "@/components/filter/ProductFilterBar";
import { StorefrontPage } from "@/components/common/StorefrontPage";
import { useGetShopSearchParams } from "@/components/navigation/hooks";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useGetProductFilters } from "@/hooks/useGetProductFilters";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";

const productsPageSchema = z.object({
  color: z.string().optional(),
  length: z.string().optional(),
});

export const Route = createFileRoute("/_layout/_shopLayout")({
  component: LayoutComponent,
  validateSearch: productsPageSchema,
});

function MobileFilters({
  onMobileFiltersCloseClick,
  hasActiveFilters,
  clearFilters,
  filtersCount,
}: {
  onMobileFiltersCloseClick: () => void;
  hasActiveFilters: boolean;
  clearFilters: () => void;
  filtersCount: number;
}) {
  return (
    <Sheet
      onOpenChange={(open) => {
        if (!open) onMobileFiltersCloseClick();
      }}
      open
    >
      <SheetContent className="flex w-full flex-col gap-layout-xl sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Filter products</SheetTitle>
          <SheetDescription>
            Narrow this collection by color or length.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <ProductFilter />
        </div>

        <SheetFooter className="gap-layout-sm">
            {hasActiveFilters && (
              <Button
                variant={"outline"}
                onClick={clearFilters}
              >
                {`Clear (${filtersCount})`}
              </Button>
            )}

            <Button onClick={onMobileFiltersCloseClick}>
              Apply
            </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

function LayoutComponent() {
  const [showFilters, setShowFilters] = useState(false);
  const { activeOverlay, closeOverlay, openOverlay } =
    useNavigationBarContext();
  const showMobileFilters = activeOverlay === "mobile-filter";

  const searchParams = useGetShopSearchParams();

  const navigate = useNavigate();

  const { subcategorySlug } = useParams({ strict: false });

  const hasActiveFilters = Boolean(searchParams.color || searchParams.length);

  const onClickOnMobileFilters = (
    trigger?: HTMLElement | null,
  ) => {
    openOverlay("mobile-filter", trigger);
  };

  const onMobileFiltersCloseClick = () => {
    closeOverlay();
  };

  const clearFilters = () => {
    if (subcategorySlug) {
      navigate({
        to: "/shop/$categorySlug/$subcategorySlug",
        params: (prev) => ({
          ...prev,
          categorySlug: prev.categorySlug!,
          subcategorySlug,
        }),
        search: {},
      });
    } else {
      navigate({
        to: "/shop/$categorySlug",
        params: (p) => ({ ...p, categorySlug: p.categorySlug! }),
        search: {},
      });
    }

    onMobileFiltersCloseClick();
    setShowFilters(false);
  };

  const { filtersCount } = useGetProductFilters();

  return (
    <div className="pb-layout-3xl">
      <div className="sticky top-0 z-40 border-b border-border bg-surface">
        <ProductFilterBar
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          onFilterClickOnMobile={onClickOnMobileFilters}
          selectedFiltersCount={filtersCount}
        />
      </div>

      <StorefrontPage as="div" className="flex gap-layout-xl" spacing="compact">
        <aside className="hidden w-64 shrink-0 xl:block" aria-label="Catalog filters">
          <AnimatePresence initial={false}>
            {showFilters && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{
                  opacity: 1,
                  x: 0,
                  transition: { ease: "easeInOut" },
                }}
                exit={{ opacity: 0, x: -8 }}
                className="sticky top-24 space-y-layout-lg"
              >
                <h2 className="text-lg font-semibold">Filters</h2>
                {hasActiveFilters && (
                  <Button
                    variant={"outline"}
                    onClick={clearFilters}
                  >
                    {`Clear (${filtersCount})`}
                  </Button>
                )}

                <ProductFilter />
              </motion.div>
            )}
          </AnimatePresence>
        </aside>

        <div className="min-w-0 flex-1">
          <Outlet />
        </div>
      </StorefrontPage>

      {showMobileFilters && (
        <MobileFilters
          onMobileFiltersCloseClick={onMobileFiltersCloseClick}
          hasActiveFilters={hasActiveFilters}
          clearFilters={clearFilters}
          filtersCount={filtersCount}
        />
      )}
    </div>
  );
}
