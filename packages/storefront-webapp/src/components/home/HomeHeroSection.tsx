import { useRef } from "react";
import { motion } from "framer-motion";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { HomeHero } from "./HomeHero";
import { useStoreContext } from "@/contexts/StoreContext";

interface HomeHeroSectionProps {
  shopLookProduct: any;
  origin: string;
  nextSectionRef?: React.RefObject<HTMLDivElement>;
}

/**
 * Hero section component for the homepage
 * Contains the hero image, video, and shop the look section
 */
export function HomeHeroSection({
  shopLookProduct,
  origin,
  nextSectionRef,
}: HomeHeroSectionProps) {
  const homeHeroRef = useRef<HTMLDivElement>(null);
  const shopTheLookRef = useRef<HTMLImageElement>(null);
  const { store } = useStoreContext();

  return (
    <div ref={homeHeroRef}>
      <HomeHero nextSectionRef={nextSectionRef} />
      <motion.div className="flex flex-col lg:relative">
        <Link
          to="/shop/product/$productSlug"
          params={{ productSlug: shopLookProduct?.productId }}
          search={{
            origin: "shop_this_look",
          }}
        >
          <motion.img
            ref={shopTheLookRef}
            initial={{ opacity: 0, y: 16 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.8 }}
            src={store?.config?.shopTheLookImage}
            className="w-full lg:w-[50%] h-screen object-cover"
          />
        </Link>

        <motion.div
          initial={{ opacity: 0 }}
          whileInView={{ opacity: 1 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, delay: 1 }}
          className="lg:absolute lg:right-[240px] lg:top-1/2 lg:-translate-y-1/2 p-8 rounded-lg"
        >
          <div className="flex flex-col items-center gap-16">
            <h2 className="text-2xl font-bold text-accent2 text-center tracking-widest leading-loose">
              the{" "}
              <span className="font-lavish text-6xl md:text-7xl">
                signature sleek
              </span>{" "}
              collection
            </h2>

            <div className="space-y-8">
              {shopLookProduct?.productId && (
                <Link
                  to="/shop/product/$productSlug"
                  params={{ productSlug: shopLookProduct.productId }}
                  search={{
                    origin: "shop_this_look",
                  }}
                >
                  <Button variant={"link"} className="group px-0 items-center">
                    Shop the look
                    <ArrowRight className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
              )}
            </div>
          </div>
        </motion.div>
      </motion.div>
    </div>
  );
}

/**
 * Utility to get the homeHeroRef from the HomeHeroSection
 * Allows parent components to access the ref for scroll tracking
 */
export const withHomeHeroRef = (Component: typeof HomeHeroSection) => {
  return (
    props: HomeHeroSectionProps & { heroRef: React.RefObject<HTMLDivElement> }
  ) => {
    const { heroRef, ...rest } = props;

    return (
      <div ref={heroRef}>
        <Component {...rest} />
      </div>
    );
  };
};

export const HomeHeroSectionWithRef = withHomeHeroRef(HomeHeroSection);
