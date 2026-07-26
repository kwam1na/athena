import { useRef } from "react";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";
import { Button } from "../ui/button";
import { HomeHero } from "./HomeHero";
import { useStoreContext } from "@/contexts/StoreContext";
import { getStoreConfigV2 } from "@/lib/storeConfig";
import { StorefrontImage } from "../ui/storefront-image";

type ShopLookProduct = {
  productId?: string;
  productSlug?: string;
};

interface HomeHeroSectionProps {
  shopLookProduct?: ShopLookProduct;
  origin: string;
  nextSectionRef?: React.RefObject<HTMLDivElement>;
}

/**
 * Hero section component for the homepage
 * Contains the hero image, video, and shop the look section
 */
export function HomeHeroSection({
  shopLookProduct,
  nextSectionRef,
}: HomeHeroSectionProps) {
  const homeHeroRef = useRef<HTMLDivElement>(null);
  const shopTheLookRef = useRef<HTMLImageElement>(null);
  const { store } = useStoreContext();
  const storeConfig = getStoreConfigV2(store);
  const shopLookProductId =
    shopLookProduct?.productSlug ?? shopLookProduct?.productId;
  const shopLookImage = storeConfig.media.images.shopTheLookImage;

  return (
    <div ref={homeHeroRef}>
      <HomeHero nextSectionRef={nextSectionRef} />
      {shopLookProductId && shopLookImage ? (
        <section className="grid items-center gap-layout-lg lg:grid-cols-2">
          <Link
            to="/shop/product/$productSlug"
            params={{ productSlug: shopLookProductId }}
            search={{
              origin: "shop_this_look",
            }}
          >
            <StorefrontImage
              ref={shopTheLookRef}
              src={shopLookImage}
              alt="Shop the Look"
              aspectRatio="4 / 5"
              wrapperClassName="w-full"
              loading="lazy"
              decoding="async"
            />
          </Link>

          <div className="p-layout-lg">
            <div className="flex flex-col items-center gap-16">
              <h2 className="text-2xl font-bold text-foreground text-center tracking-widest leading-loose">
                the{" "}
                <span className="font-lavish text-6xl md:text-7xl">
                  signature sleek
                </span>{" "}
                collection
              </h2>

              <div className="space-y-8">
                <Link
                  to="/shop/product/$productSlug"
                  params={{ productSlug: shopLookProductId }}
                  search={{
                    origin: "shop_this_look",
                  }}
                >
                  <Button variant={"link"} className="group px-0 items-center">
                    Shop the look
                    <ArrowRight className="w-4 h-4 mr-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        </section>
      ) : null}
    </div>
  );
}

/**
 * Utility to get the homeHeroRef from the HomeHeroSection
 * Allows parent components to access the ref for scroll tracking
 */
export const withHomeHeroRef = (Component: typeof HomeHeroSection) => {
  return (
    props: HomeHeroSectionProps & { heroRef: React.RefObject<HTMLDivElement> },
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
