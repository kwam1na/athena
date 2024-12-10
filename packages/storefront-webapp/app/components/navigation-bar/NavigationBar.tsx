import { useStoreContext } from "@/contexts/StoreContext";
import { Link } from "@tanstack/react-router";
import { AlignLeft, ChevronLeft, HeartIcon, XIcon } from "lucide-react";
import { useShoppingBag } from "@/hooks/useShoppingBag";
import { useState } from "react";
import { useGetStoreCategories } from "../navigation/hooks";
import { Button } from "../ui/button";
import { capitalizeWords, slugToWords } from "@/lib/utils";
import CartIcon from "../shopping-bag/CartIcon";
import SavedIcon from "../saved-items/SavedIcon";
import { AnimatePresence, easeInOut, motion } from "framer-motion";

function MobileMenu({ onCloseClick }: { onCloseClick: () => void }) {
  const { categories, categoryToSubcategoriesMap } = useGetStoreCategories();

  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const categoryItem = {
    hidden: { x: -8, opacity: 0 },
    show: {
      x: 0,
      opacity: 1,
      transition: {
        duration: 0.4,
        type: "spring",
        ease: easeInOut,
        bounce: 0,
      },
    },
    exit: { x: 0, opacity: 0 },
  };

  const subcategoryItem = {
    hidden: { x: 8, opacity: 0 },
    show: {
      x: 0,
      opacity: 1,
      transition: {
        duration: 0.4,
        type: "spring",
        ease: easeInOut,
        bounce: 0,
      },
    },
    exit: { x: 8, opacity: 0 },
  };

  return (
    <motion.div
      initial="hidden"
      animate="show"
      className="w-full h-screen bg-background"
    >
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
            <motion.div
              variants={categoryItem}
              key={s.value}
              className="group relative h-full flex items-center"
            >
              <p
                className="text-lg font-light hover:text-gray-600 transition-colors"
                onClick={() => setSelectedCategory(s.value)}
              >
                {s.label}
              </p>
            </motion.div>
          ))}
        </div>
      )}

      {selectedCategory && (
        <motion.div
          variants={subcategoryItem}
          className="flex flex-col gap-8 pt-16 px-12"
        >
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
        </motion.div>
      )}
    </motion.div>
  );
}

export default function NavigationBar() {
  const { store } = useStoreContext();
  const { bagCount, savedBagCount } = useShoppingBag();
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [isMobileMenuShowing, setIsMobileMenuShowing] = useState(false);

  const { categories, categoryToSubcategoriesMap } = useGetStoreCategories();

  const { navBarClassname, showNavbar, hideNavbar } = useStoreContext();

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: {
        type: "spring",
        ease: easeInOut,
        delay: 0.05,
        staggerChildren: 0.075,
        bounce: 0,
      },
    },
  };

  const item = {
    hidden: { y: -2, opacity: 0 },
    show: { y: 0, opacity: 1 },
    exit: { y: 0, opacity: 0 },
  };

  const LinkSubmenu = ({
    slug,
    subMenuItems,
  }: {
    slug: string;
    subMenuItems: Array<{ value: string; label: string }>;
  }) => {
    return (
      <motion.div
        layoutId="link-submenu"
        key="link-menu"
        variants={container}
        initial="hidden"
        animate="show"
        exit={"exit"}
        className="absolute w-full left-0 bg-white bg-opacity-95 px-8 animate-fadeIn z-50"
        onMouseEnter={() => setActiveMenu(slug)}
        onMouseLeave={() => setActiveMenu(null)}
      >
        <div className="max-w-7xl mx-auto px-8 py-8">
          <div className="flex flex-col font-bold gap-4">
            <motion.div variants={item}>
              <Link
                to="/shop/$categorySlug"
                params={(p) => ({
                  ...p,
                  categorySlug: slug,
                })}
                className="text-xs hover:text-gray-600 transition-colors"
                onClick={() => setActiveMenu(null)}
              >
                Shop all
              </Link>
            </motion.div>
            {subMenuItems?.map((s) => (
              <motion.div variants={item} key={s.value}>
                <Link
                  key={s.value}
                  to="/shop/$categorySlug/$subcategorySlug"
                  params={(p) => ({
                    ...p,
                    categorySlug: slug,
                    subcategorySlug: s.value,
                  })}
                  className="text-xs hover:text-gray-600 transition-colors"
                  onClick={() => setActiveMenu(null)}
                >
                  {s.label}
                </Link>
              </motion.div>
            ))}
          </div>
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

  return (
    <div className="relative bg-background border border-b">
      <AnimatePresence initial={false}>
        <div className="relative z-50">
          <nav className={navBarClassname}>
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
              <div className="flex gap-4">
                <Link to="/shop/saved" className="flex items-center">
                  <SavedIcon notificationCount={savedBagCount} />
                </Link>
                <Link to="/shop/bag" className="flex gap-2">
                  <CartIcon notificationCount={bagCount} />
                </Link>
                <AlignLeft
                  className="lg:hidden w-5 h-5"
                  onClick={onHideNavbarClick}
                />
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
            className="fixed inset-0 mt-20 bg-white bg-opacity-20 backdrop-blur-md z-40"
            onMouseEnter={() => setActiveMenu(null)}
          />
        )}

        {isMobileMenuShowing && <MobileMenu onCloseClick={onShowNavbarClick} />}
      </AnimatePresence>
    </div>
  );
}
