import { useEffect, useState } from "react";
import { useGetStoreCategories } from "../navigation/hooks";
import { easeInOut, motion } from "framer-motion";
import { Button } from "../ui/button";
import { ChevronLeft, XIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { capitalizeWords, slugToWords } from "@/lib/utils";

export function MobileMenu({ onCloseClick }: { onCloseClick: () => void }) {
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

  useEffect(() => {
    // Disable scrolling when component mounts
    document.body.style.overflow = "hidden";

    // Re-enable scrolling when component unmounts
    return () => {
      document.body.style.overflow = "unset";
    };
  }, []);

  return (
    <motion.div
      initial="hidden"
      animate="show"
      className="fixed inset-0 z-50 w-full h-screen bg-background"
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

          {categoryToSubcategoriesMap?.[selectedCategory]?.map((s) => (
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
