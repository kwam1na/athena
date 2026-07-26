import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { Menu, ShoppingBag } from "lucide-react";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useEffect, useState } from "react";
import { useGetStoreCategories } from "../navigation/hooks";
import { BagMenu } from "./BagMenu";
import { MobileBagMenu } from "./MobileBagMenu";
import { MobileMenu } from "./MobileMenu";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { SiteBanner } from "./SiteBanner";
import {
  getHoverClass,
  getNavBGClass,
  getSubmenuBGClass,
} from "./navBarStyles";

export default function NavigationBar() {
  const { store } = useStoreContext();
  const shell = useNavigationBarContext();
  const { categories, categoryToSubcategoriesMap } = useGetStoreCategories();
  const { bagCount } = useShoppingBag({
    enabled:
      shell.appLocation !== "homepage" ||
      shell.activeOverlay === "desktop-bag" ||
      shell.activeOverlay === "mobile-bag",
  });

  useEffect(() => {
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") shell.closeOverlay();
    };
    document.addEventListener("keydown", onEscape);
    return () => document.removeEventListener("keydown", onEscape);
  }, [shell]);

  if (!store || !shell.appLocation) return null;
  const hover = getHoverClass(shell.navBarLayout, shell.appLocation);
  const desktopOpen =
    shell.activeOverlay === "desktop-menu" ||
    shell.activeOverlay === "desktop-bag";
  const subcategories = shell.activeMenu
    ? categoryToSubcategoriesMap?.[shell.activeMenu]
    : undefined;

  return (
    <header className="w-full">
      <SiteBanner />
      <div
        className={getNavBGClass(
          desktopOpen,
          shell.navBarLayout,
          shell.appLocation,
        )}
      >
        <nav
          aria-label="Storefront navigation"
          className="mx-auto flex max-w-content items-center justify-between px-gutter py-layout-sm"
        >
          <div className="flex items-center gap-layout-2xl">
            <Link to="/" className={`text-sm font-medium tracking-widest ${hover}`}>
              {String(store.name ?? "").toUpperCase()}
            </Link>
            <div className="hidden gap-layout-xl lg:flex">
              {categories?.map((category) => (
                <Link
                  key={category.value}
                  to="/shop/$categorySlug"
                  params={(params) => ({
                    ...params,
                    categorySlug: category.value,
                  })}
                  className={`text-xs ${hover}`}
                  onFocus={(event) =>
                    shell.openOverlay(
                      "desktop-menu",
                      event.currentTarget,
                      category.value,
                    )
                  }
                  onMouseEnter={(event) =>
                    shell.openOverlay(
                      "desktop-menu",
                      event.currentTarget,
                      category.value,
                    )
                  }
                >
                  {category.label}
                </Link>
              ))}
            </div>
          </div>
          <div className="flex gap-layout-xs">
            <button
              type="button"
              aria-label={`Open shopping bag${bagCount ? `, ${bagCount} items` : ""}`}
              className={`hidden h-11 w-11 items-center justify-center rounded-md lg:flex ${hover}`}
              onClick={(event) =>
                shell.openOverlay("desktop-bag", event.currentTarget, "bag")
              }
            >
              <ShoppingBag className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Open shopping bag"
              className={`flex h-11 w-11 items-center justify-center rounded-md lg:hidden ${hover}`}
              onClick={(event) =>
                shell.openOverlay("mobile-bag", event.currentTarget)
              }
            >
              <ShoppingBag className="h-5 w-5" />
            </button>
            <button
              type="button"
              aria-label="Open menu"
              className={`flex h-11 w-11 items-center justify-center rounded-md lg:hidden ${hover}`}
              onClick={(event) =>
                shell.openOverlay("mobile-menu", event.currentTarget)
              }
            >
              <Menu className="h-5 w-5" />
            </button>
          </div>
        </nav>
      </div>
      {desktopOpen && (
        <section
          aria-label="Storefront navigation menu"
          className={`absolute left-0 z-50 w-full ${getSubmenuBGClass(
            shell.navBarLayout,
            shell.appLocation,
          )}`}
          onMouseLeave={() => shell.closeOverlay({ restoreFocus: false })}
        >
          <div className="mx-auto max-w-content px-gutter py-layout-xl">
            {shell.activeOverlay === "desktop-bag" ? (
              <BagMenu
                setActiveMenu={() =>
                  shell.closeOverlay({ restoreFocus: false })
                }
              />
            ) : (
              <div className="flex flex-col gap-layout-md">
                {shell.activeMenu && (
                  <Link
                    to="/shop/$categorySlug"
                    params={(params) => ({
                      ...params,
                      categorySlug: shell.activeMenu!,
                    })}
                    onClick={() =>
                      shell.closeOverlay({ restoreFocus: false })
                    }
                  >
                    Shop all
                  </Link>
                )}
                {shell.activeMenu &&
                  subcategories?.map((item) => (
                    <Link
                      key={item.value}
                      to="/shop/$categorySlug/$subcategorySlug"
                      params={(params) => ({
                        ...params,
                        categorySlug: shell.activeMenu!,
                        subcategorySlug: item.value,
                      })}
                      onClick={() =>
                        shell.closeOverlay({ restoreFocus: false })
                      }
                    >
                      {item.label}
                    </Link>
                  ))}
              </div>
            )}
          </div>
        </section>
      )}
      {shell.activeOverlay === "mobile-menu" && (
        <MobileMenu onCloseClick={() => shell.closeOverlay()} />
      )}
      {shell.activeOverlay === "mobile-bag" && (
        <MobileBagMenu
          setActiveMenu={() => shell.closeOverlay()}
          onCloseClick={() => shell.closeOverlay()}
        />
      )}
    </header>
  );
}
