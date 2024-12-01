import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { HeartIcon } from "lucide-react";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getAllSubcategories } from "@/api/subcategory";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import CartIcon from "../shopping-bag/CartIcon";

type SubMenu = "wigs" | "wig-care-and-accessories";

export default function NavigationBar() {
  const { store } = useStoreContext();
  const { bagCount } = useShoppingBag();
  const [activeMenu, setActiveMenu] = useState<SubMenu | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["subcategories"],
    queryFn: () =>
      getAllSubcategories({
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
  });

  const WigSubMenu = () => {
    const subcategories = data
      ?.map((s) => ({ value: s._id, label: s.name }))
      .sort((a, b) => a.label.localeCompare(b.label));

    return (
      <div
        className="absolute w-full left-0 bg-white bg-opacity-95 shadow-lg px-8 animate-fadeIn z-50"
        onMouseEnter={() => setActiveMenu("wigs")}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <div className="max-w-7xl mx-auto px-8 py-8">
          <div className="flex flex-col font-medium gap-4">
            <Link
              to="/shop/hair"
              className="text-xs hover:text-gray-600 transition-colors"
            >
              Shop all
            </Link>
            {subcategories?.map((s) => (
              <Link
                key={s.value}
                to="/shop/hair/$subcategorySlug"
                params={(p) => ({
                  ...p,
                  subcategorySlug: s.label.toLowerCase(),
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

  const WigCareSubMenu = () => {
    return (
      <div
        className="absolute w-full left-0 bg-white bg-opacity-95 shadow-lg animate-fadeIn z-50"
        onMouseEnter={() => setActiveMenu("wig-care-and-accessories")}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <div className="flex h-[320px] gap-8 w-full py-4 px-8 max-w-7xl mx-auto">
          {/* Your existing wig care submenu content */}
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
                {/* Navigation Items */}
                <div
                  className="group relative h-full flex items-center"
                  onMouseEnter={() => setActiveMenu("wigs")}
                >
                  <Link
                    to="/"
                    className="text-xs hover:text-gray-600 transition-colors"
                  >
                    Hair
                  </Link>
                  {/* Invisible extender to prevent hover gap */}
                  <div className="absolute -bottom-6 left-0 w-full h-6" />
                </div>

                {/* <div
                  className="group relative h-full flex items-center"
                  onMouseEnter={() => setActiveMenu("wig-care-and-accessories")}
                >
                  <Link
                    to="/"
                    className="text-xs hover:text-gray-600 transition-colors"
                  >
                    Hair accessories
                  </Link>
                  <div className="absolute -bottom-6 left-0 w-full h-6" />
                </div> */}
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
        {activeMenu === "wigs" && <WigSubMenu />}
        {activeMenu === "wig-care-and-accessories" && <WigCareSubMenu />}
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
