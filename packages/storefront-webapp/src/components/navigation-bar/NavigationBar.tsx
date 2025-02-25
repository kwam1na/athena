import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { AlignLeft } from "lucide-react";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import React, { useState } from "react";
import { useGetStoreCategories } from "../navigation/hooks";
import CartIcon from "../shopping-bag/CartIcon";

import { AnimatePresence, easeInOut, motion } from "framer-motion";
import { BagMenu } from "./BagMenu";
import { MobileBagMenu } from "./MobileBagMenu";
import { MobileMenu } from "./MobileMenu";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { SiteBanner } from "./SiteBanner";
import { cn } from "@/lib/utils";

const item = {
  hidden: { y: -2, opacity: 0 },
  show: { y: 0, opacity: 1 },
  exit: { y: 0, opacity: 0 },
};

export default function NavigationBar() {
  const { store } = useStoreContext();
  const { bagCount } = useShoppingBag();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isMobileMenuShowing, setIsMobileMenuShowing] = useState(false);

  const [isMobileBagMenuShowing, setIsMobileBagMenuShowing] = useState(false);

  const { categories, categoryToSubcategoriesMap } = useGetStoreCategories();

  const { navBarClassname, showNavbar, hideNavbar } = useStoreContext();

  const { navBarLayout, appLocation } = useNavigationBarContext();

  const hoverClass =
    navBarLayout == "sticky" && appLocation == "homepage"
      ? "hover:text-gray-300 text-white"
      : "hover:text-gray-500";

  const container = {
    hidden: { opacity: 1 },
    show: {
      opacity: 1,
      transition: {
        type: "spring",
        ease: easeInOut,
        delay: 0.05,
        staggerChildren: 0.025,
        bounce: 0,
      },
    },
  };

  const StoreCategoriesSubmenu = () => {
    if (!activeMenu) return null;

    const subMenuItems = categoryToSubcategoriesMap?.[activeMenu];

    return (
      <>
        <motion.div variants={item}>
          <Link
            to="/shop/$categorySlug"
            params={(p) => ({
              ...p,
              categorySlug: activeMenu,
            })}
            className={`text-xs ${hoverClass} transition-colors`}
            onClick={() => setActiveMenu(null)}
          >
            Shop all
          </Link>
        </motion.div>
        <div
          className={`grid ${subMenuItems?.length && subMenuItems?.length > 5 ? "grid-cols-2" : "grid-cols-1"} gap-4`}
        >
          {subMenuItems?.map((s) => (
            <motion.div variants={item} key={s.value}>
              <Link
                key={s.value}
                to="/shop/$categorySlug/$subcategorySlug"
                params={(p) => ({
                  ...p,
                  categorySlug: activeMenu,
                  subcategorySlug: s.value,
                })}
                className={`text-xs ${hoverClass} transition-colors`}
                onClick={() => setActiveMenu(null)}
              >
                {s.label}
              </Link>
            </motion.div>
          ))}
        </div>
      </>
    );
  };

  const LinkSubmenu = ({
    slug,
    children,
  }: {
    slug: string;
    children: React.ReactNode;
  }) => {
    return (
      <motion.div
        layoutId="link-submenu"
        key="link-menu"
        variants={container}
        initial="hidden"
        animate="show"
        exit={"exit"}
        className={`absolute w-full ${navBarLayout == "fixed" ? "bg-accent5" : ""} left-0 bg-opacity-95 animate-fadeIn z-50`}
        onMouseEnter={() => setActiveMenu(slug)}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <div className="py-8 container mx-auto max-w-[1024px]">
          <div className="flex flex-col font-medium gap-4">{children}</div>
        </div>
      </motion.div>
    );
  };

  const onHideNavbarClick = () => {
    setIsMobileMenuShowing(true);
    hideNavbar();
  };

  const onShowNavbarClick = () => {
    setIsMobileMenuShowing(false);
    showNavbar();
  };

  const handleShowMobileBagMenu = () => {
    setIsMobileBagMenuShowing(true);
    hideNavbar();
  };

  const handleHideMobileBagMenu = () => {
    setIsMobileBagMenuShowing(false);
    showNavbar();
  };

  if (!store || !appLocation) return null;

  const mainWrapperlass = navBarLayout == "sticky" ? "absolute" : "bg-accent5";

  const navBGClass = activeMenu
    ? `${navBarLayout == "sticky" ? "bg-white bg-opacity-20 backdrop-blur-md" : "bg-accent5"}`
    : "bg-transparent";

  return (
    <div className="flex flex-col relative">
      <div className={`top-0 w-full z-50 ${mainWrapperlass}`}>
        <AnimatePresence>
          <SiteBanner />

          <div key="nav-bar">
            <div className={`w-full ${navBGClass} transition-all ease-out`}>
              <motion.nav
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  transition: {
                    duration: 1,
                    delay: appLocation == "homepage" ? 2.2 : 0,
                    ease: [0.6, 0.05, 0.04, 0.9],
                  },
                }}
                className={`${navBarClassname} container mx-auto max-w-[1024px]`}
              >
                <div className="flex items-center justify-between w-full">
                  <div className="flex gap-16">
                    <div onMouseEnter={() => setActiveMenu(null)}>
                      <Link to="/">
                        <h1
                          className={`text-md font-medium ${hoverClass} tracking-widest`}
                        >
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
                            className={`text-xs ${hoverClass} transition-colors`}
                            onClick={() => setActiveMenu(null)}
                          >
                            {s.label}
                          </Link>
                          {/* Invisible extender to prevent hover gap */}
                          <div className="absolute -bottom-6 left-0 w-full h-6" />
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="flex gap-8">
                    <div
                      onMouseEnter={() => setActiveMenu(null)}
                      className="flex items-center gap-4"
                    >
                      <span
                        className="hidden lg:flex cursor-pointer hover:-rotate-6 transition-all duration-300 ease-out"
                        onClick={() => setActiveMenu("bag")}
                      >
                        <CartIcon
                          notificationCount={bagCount}
                          hoverClass={hoverClass}
                        />
                      </span>

                      <span
                        className="flex lg:hidden"
                        onClick={handleShowMobileBagMenu}
                      >
                        <CartIcon
                          notificationCount={bagCount}
                          hoverClass={hoverClass}
                        />
                      </span>
                      <AlignLeft
                        className={`lg:hidden w-5 h-5 ${hoverClass}`}
                        onClick={onHideNavbarClick}
                      />
                    </div>
                  </div>
                </div>
              </motion.nav>
            </div>

            {/* Submenus */}
            {activeMenu && (
              <LinkSubmenu slug={activeMenu}>
                {activeMenu == "bag" ? (
                  <BagMenu setActiveMenu={setActiveMenu} />
                ) : (
                  <StoreCategoriesSubmenu />
                )}
              </LinkSubmenu>
            )}
          </div>

          {/* Content Overlay */}
          {activeMenu && (
            <motion.div
              key="overlay"
              initial={{ opacity: 0 }}
              animate={{
                opacity: 1,
                transition: {
                  duration: 0.175,
                  delay: 0.2,
                  ease: "easeOut",
                },
              }}
              exit={{
                opacity: 0,
                transition: {
                  duration: 0.2,
                  ease: "easeInOut",
                },
              }}
              className={cn(
                "w-full bg-white bg-opacity-20 backdrop-blur-md z-10",
                navBarLayout == "sticky" && "h-screen"
              )}
              onMouseEnter={() => setActiveMenu(null)}
            />
          )}

          {isMobileMenuShowing && (
            <MobileMenu key={"mobile-menu"} onCloseClick={onShowNavbarClick} />
          )}

          {isMobileBagMenuShowing && (
            <MobileBagMenu
              key={"mobile-bag-menu"}
              setActiveMenu={setActiveMenu}
              onCloseClick={handleHideMobileBagMenu}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
