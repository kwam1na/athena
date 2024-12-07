import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import {
  AlignLeft,
  ChevronLeft,
  HeartIcon,
  MenuIcon,
  XIcon,
} from "lucide-react";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAllSubcategories } from "@/api/subcategory";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import CartIcon from "../shopping-bag/CartIcon";
import {
  useGetStoreCategories,
  useGetStoreSubcategories,
} from "../navigation/hooks";
import { Button } from "../ui/button";
import {
  capitalizeFirstLetter,
  capitalizeWords,
  slugToWords,
} from "@/lib/utils";

type SubMenu = "wigs" | "wig-care-and-accessories";

function MobileMenu({ onCloseClick }: { onCloseClick: () => void }) {
  const { categories, categoryToSubcategoriesMap } = useGetStoreCategories();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  return (
    <div className="w-full h-screen bg-background">
      <div className="flex pt-4 px-2">
        {selectedCategory && (
          <Button
            className="mr-auto"
            variant={"clear"}
            onClick={() => setSelectedCategory(null)}
          >
            <ChevronLeft className="w-5 h-5" />
          </Button>
        )}

        <Button className="ml-auto" variant={"clear"} onClick={onCloseClick}>
          <XIcon className="w-5 h-5" />
        </Button>
      </div>

      {!selectedCategory && (
        <div className="flex flex-col gap-8 pt-16 px-12">
          {categories?.map((s) => (
            <div
              key={s.value}
              className="group relative h-full flex items-center"
            >
              <p
                className="text-lg font-light hover:text-gray-600 transition-colors"
                onClick={() => setSelectedCategory(s.value)}
              >
                {s.label}
              </p>
            </div>
          ))}
        </div>
      )}

      {selectedCategory && (
        <div className="flex flex-col gap-8 pt-16 px-12">
          <Link
            to="/shop/$categorySlug"
            params={(p) => ({
              ...p,
              categorySlug: selectedCategory,
            })}
            onClick={onCloseClick}
            className="text-lg font-light hover:text-gray-600 transition-colors"
          >
            {`Shop all ${capitalizeWords(slugToWords(selectedCategory))}`}
          </Link>

          {categoryToSubcategoriesMap[selectedCategory]?.map((s) => (
            <Link
              key={s.value}
              onClick={onCloseClick}
              to="/shop/$categorySlug/$subcategorySlug"
              params={(p) => ({
                ...p,
                categorySlug: selectedCategory,
                subcategorySlug: s.value,
              })}
              className="text-lg font-light hover:text-gray-600 transition-colors"
            >
              {s.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function NavigationBar() {
  const { store } = useStoreContext();
  const { bagCount } = useShoppingBag();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isMobileMenuShowing, setIsMobileMenuShowing] = useState(false);

  const { categories, categoryToSubcategoriesMap } = useGetStoreCategories();

  const LinkSubmenu = ({
    slug,
    subMenuItems,
  }: {
    slug: string;
    subMenuItems: Array<{ value: string; label: string }>;
  }) => {
    return (
      <div
        className="absolute w-full left-0 bg-white bg-opacity-95 shadow-lg px-8 animate-fadeIn z-50"
        onMouseEnter={() => setActiveMenu(slug)}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <div className="max-w-7xl mx-auto px-8 py-8">
          <div className="flex flex-col font-medium gap-4">
            <Link
              to="/shop/$categorySlug"
              params={(p) => ({
                ...p,
                categorySlug: slug,
              })}
              className="text-xs hover:text-gray-600 transition-colors"
            >
              Shop all
            </Link>
            {subMenuItems?.map((s) => (
              <Link
                key={s.value}
                to="/shop/$categorySlug/$subcategorySlug"
                params={(p) => ({
                  ...p,
                  categorySlug: slug,
                  subcategorySlug: s.value,
                })}
                className="text-xs hover:text-gray-600 transition-colors"
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>
      </div>
    );
  };

  const hiddenNavClassname =
    "hidden w-full flex flex-col items-center justify-center p-6 lg:px-16 lg:py-6";
  const navClassname =
    "w-full flex flex-col items-center justify-center p-6 lg:px-16 lg:py-6";

  const [activeNavClassname, setActiveClassname] = useState(navClassname);

  const hideNavbar = () => {
    setIsMobileMenuShowing(true);
    setActiveClassname(hiddenNavClassname);
  };

  const showNavbar = () => {
    setIsMobileMenuShowing(false);
    setActiveClassname(navClassname);
  };

  return (
    <div className="relative bg-background">
      {/* Navigation Container */}
      <div className="relative z-50">
        <nav className={activeNavClassname}>
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-24">
              <div>
                <Link to="/">
                  <h1 className="text-lg font-medium tracking-widest">
                    {store?.name && (store?.name as string).toUpperCase()}
                  </h1>
                </Link>
              </div>
              <div className="hidden lg:flex gap-12">
                {categories?.map((s) => (
                  <div
                    key={s.value}
                    className="group relative h-full flex items-center"
                    onMouseEnter={() => setActiveMenu(s.value)}
                  >
                    <Link
                      to="/shop/$categorySlug"
                      params={(p) => ({
                        ...p,
                        categorySlug: s.value,
                      })}
                      className="text-xs hover:text-gray-600 transition-colors"
                    >
                      {s.label}
                    </Link>
                    {/* Invisible extender to prevent hover gap */}
                    <div className="absolute -bottom-6 left-0 w-full h-6" />
                  </div>
                ))}
              </div>
            </div>
            <div className="flex gap-4">
              <Link to="/shop/bag" className="flex items-center">
                <HeartIcon className="w-5 h-5" />
              </Link>
              <Link to="/shop/bag" className="flex gap-2">
                <CartIcon notificationCount={bagCount} />
              </Link>
              <AlignLeft className="lg:hidden w-5 h-5" onClick={hideNavbar} />
            </div>
          </div>
        </nav>

        {/* Submenus */}
        {activeMenu && (
          <LinkSubmenu
            slug={activeMenu}
            subMenuItems={categoryToSubcategoriesMap[activeMenu]}
          />
        )}
      </div>

      {/* Content Overlay */}
      {activeMenu && (
        <div
          className="fixed inset-0 mt-20 bg-white bg-opacity-20 backdrop-blur-sm z-40"
          onMouseEnter={() => setActiveMenu(null)}
        />
      )}

      {isMobileMenuShowing && <MobileMenu onCloseClick={showNavbar} />}
    </div>
  );
}
