import ProductFilter from "@/components/filter/ProductFilter";
import ProductFilterBar from "@/components/filter/ProductFilterBar";
import { useGetShopSearchParams } from "@/components/navigation/hooks";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import { useGetProductFilters } from "@/hooks/useGetProductFilters";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useEffect, useState } from "react";
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
  useEffect(() => {
    // Disable scrolling when component mounts
    document.body.style.overflow = "hidden";

    // Re-enable scrolling when component unmounts
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  return (
    <div className="fixed inset-0 z-40 w-full h-screen bg-background">
      <div className="absolute z-40 w-full h-screen bg-background">
        <div className="flex pt-4 px-2">
          <Button
            className="ml-auto"
            variant={"clear"}
            onClick={onMobileFiltersCloseClick}
          >
            <XIcon className="w-5 h-5" />
          </Button>
        </div>

        <div className="space-y-40">
          <div className="pt-16 px-12 space-y-12">
            <p>Filter</p>
            <ProductFilter />
          </div>

          <div className="w-full flex gap-4 justify-center">
            {hasActiveFilters && (
              <Button
                variant={"outline"}
                className="px-16"
                onClick={clearFilters}
              >
                {`Clear (${filtersCount})`}
              </Button>
            )}

            <Button className="px-16" onClick={onMobileFiltersCloseClick}>
              Apply
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LayoutComponent() {
  const [showFilters, setShowFilters] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  // TODO: combine this into useNavigationBarContext
  const { hideNavbar, showNavbar } = useStoreContext();

  const { setNavBarLayout } = useNavigationBarContext();

  const searchParams = useGetShopSearchParams();

  const navigate = useNavigate();

  const { subcategorySlug } = useParams({ strict: false });

  const hasActiveFilters = Boolean(searchParams.color || searchParams.length);

  const onClickOnMobileFilters = () => {
    setShowMobileFilters(true);
    hideNavbar();
  };

  const onMobileFiltersCloseClick = () => {
    setShowMobileFilters(false);
    showNavbar();
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
    <div className="pb-40">
      <div className="bg-accent5 border-b col-span-12 sticky top-0 z-40">
        <ProductFilterBar
          showFilters={showFilters}
          setShowFilters={setShowFilters}
          onFilterClickOnMobile={onClickOnMobileFilters}
          selectedFiltersCount={filtersCount}
        />
      </div>

      <div className="hidden xl:block sticky top-0">
        <div className="absolute w-[20%] h-[480px]">
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
                className="p-16 space-y-8"
              >
                <p>Filters</p>
                {hasActiveFilters && (
                  <Button
                    variant={"outline"}
                    className="px-16"
                    onClick={clearFilters}
                  >
                    {`Clear (${filtersCount})`}
                  </Button>
                )}

                <ProductFilter />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="container mx-auto max-w-[1024px] flex py-8 gap-4">
        <div className={"col-span-12 container mx-auto px-6 lg:px-0"}>
          <Outlet />
        </div>
      </div>

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
