import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { HeartIcon } from "lucide-react";
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

type SubMenu = "wigs" | "wig-care-and-accessories";

export default function NavigationBar() {
  const { store } = useStoreContext();
  const { bagCount } = useShoppingBag();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);

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

  return (
    <div className="relative">
      {/* Navigation Container */}
      <div className="relative z-50">
        <nav className="w-full flex flex-col items-center justify-center px-16 py-6">
          <div className="flex items-center justify-between w-full">
            <div className="flex gap-24">
              <div>
                <Link to="/">
                  <h1 className="text-lg font-medium tracking-widest">
                    {store?.name && (store?.name as string).toUpperCase()}
                  </h1>
                </Link>
              </div>
              <div className="flex gap-12">
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
                  </div>
                ))}

                {/* <div>
                  
                  <div className="absolute -bottom-6 left-0 w-full h-6" />
                </div> */}

                {/* <div
                  className="group relative h-full flex items-center"
                  onMouseEnter={() => setActiveMenu("wigs")}
                > */}
                {/* <Link
                    to="/shop/hair"
                    className="text-xs hover:text-gray-600 transition-colors"
                  >
                    Hair
                  </Link> */}

                {/* Invisible extender to prevent hover gap */}
                {/* <div className="absolute -bottom-6 left-0 w-full h-6" /> */}
                {/* </div> */}
              </div>
            </div>
            <div className="flex gap-4">
              <Link to="/shop/bag" className="flex items-center">
                <HeartIcon className="w-5 h-5" />
              </Link>
              <Link to="/shop/bag" className="flex gap-2">
                <CartIcon notificationCount={bagCount} />
              </Link>
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
    </div>
  );
}
