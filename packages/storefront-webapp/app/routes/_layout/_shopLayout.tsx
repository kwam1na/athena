import ProductFilter from "@/components/filter/ProductFilter";
import ProductFilterBar from "@/components/filter/ProductFilterBar";
import Footer from "@/components/footer/Footer";
import { useGetShopSearchParams } from "@/components/navigation/hooks";
import { Button } from "@/components/ui/button";
import { useStoreContext } from "@/contexts/StoreContext";
import {
  createFileRoute,
  Outlet,
  useNavigate,
  useParams,
} from "@tanstack/react-router";
import { XIcon } from "lucide-react";
import { useState } from "react";
import { z } from "zod";

const productsPageSchema = z.object({
  color: z.string().optional(),
  length: z.string().optional(),
});

export const Route = createFileRoute("/_layout/_shopLayout")({
  component: LayoutComponent,
  validateSearch: productsPageSchema,
});

function LayoutComponent() {
  const [showFilters, setShowFilters] = useState(false);
  const [showMobileFilters, setShowMobileFilters] = useState(false);

  const { hideNavbar, showNavbar } = useStoreContext();

  const searchParams = useGetShopSearchParams();

  const navigate = useNavigate();

  const { subcategorySlug } = useParams({ strict: false });

  const hasActiveFilters = Boolean(searchParams.color || searchParams.length);

  const getSelectedFiltersCount = () => {
    return (
      (searchParams?.color?.split(",")?.length || 0) +
      (searchParams?.length?.split(",")?.length || 0)
    );
  };

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

  return (
    <>
      <div className="grid grid-cols-12 gap-4 pb-40">
        <div className="col-span-12 sticky top-0 z-20">
          <ProductFilterBar
            showFilters={showFilters}
            setShowFilters={setShowFilters}
            onFilterClickOnMobile={onClickOnMobileFilters}
          />
        </div>

        {showFilters && (
          <div className="hidden lg:flex flex-col gap-16 col-span-2 h-[calc(100vh-124px)] sticky top-16 lg:py-16 lg:px-16 overflow-auto">
            {hasActiveFilters && (
              <Button
                variant={"outline"}
                className="px-16"
                onClick={clearFilters}
              >
                {`Clear (${getSelectedFiltersCount()})`}
              </Button>
            )}

            <ProductFilter />
          </div>
        )}

        {showMobileFilters && (
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
                    {`Clear (${getSelectedFiltersCount()})`}
                  </Button>
                )}

                <Button className="px-16" onClick={onMobileFiltersCloseClick}>
                  Apply
                </Button>
              </div>
            </div>
          </div>
        )}

        <div
          className={
            showFilters
              ? "col-span-12 px-6 lg:col-span-10 lg:px-12"
              : "col-span-12 lg:px-12"
          }
        >
          <Outlet />
        </div>
      </div>

      <Footer />
    </>
  );
}
