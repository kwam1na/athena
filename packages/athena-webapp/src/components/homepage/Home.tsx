import { useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import useGetActiveStore from "../../hooks/useGetActiveStore";
import View from "../View";
import { PageLevelHeader, PageWorkspace } from "../common/PageLevelHeader";

import { BestSellers } from "./BestSellers";
import { FeaturedSection } from "./FeaturedSection";
import { api } from "~/convex/_generated/api";
import { EmptyState } from "../states/empty/empty-state";
import {
  ArrowDown,
  CheckCircle2,
  CircleAlert,
  PackagePlus,
  Store as StoreIcon,
} from "lucide-react";
import { ShopLookSection } from "./ShopLook";
import { FadeIn } from "../common/FadeIn";
import { HeroSectionTabs } from "./HeroSectionTabs";
import { BannerMessageEditor } from "./BannerMessageEditor";
import type { MouseEvent, ReactNode } from "react";
import { Button } from "../ui/button";
import { getOrigin } from "~/src/lib/navigationUtils";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import type { Store as StoreDoc } from "~/types";

function HomepageSettingsSection({
  id,
  title,
  description,
  children,
  withTopBorder = false,
}: {
  id?: string;
  title: string;
  description: string;
  children: ReactNode;
  withTopBorder?: boolean;
}) {
  return (
    <section
      id={id}
      className={[
        "scroll-mt-layout-2xl grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]",
        withTopBorder ? "border-t" : "",
      ].join(" ")}
    >
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">{description}</p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function HomepageReadinessSummary({
  activeStore,
  bestSellersCount,
  highlightedCount,
  shopLookCount,
}: {
  activeStore: StoreDoc;
  bestSellersCount: number;
  highlightedCount: number;
  shopLookCount: number;
}) {
  const storeConfig = getStoreConfigV2(activeStore);
  const heroDisplayType = storeConfig.media.homeHero.displayType;
  const heroIsReady =
    heroDisplayType === "image"
      ? Boolean(storeConfig.media.homeHero.headerImage)
      : Boolean(storeConfig.media.reels.activeHlsUrl);
  const shopLookIsReady =
    Boolean(storeConfig.media.images.shopTheLookImage) && shopLookCount > 0;
  const readyCount = [
    heroIsReady,
    bestSellersCount > 0,
    highlightedCount > 0,
    shopLookIsReady,
  ].filter(Boolean).length;

  const items = [
    {
      isReady: heroIsReady,
      label: "Hero media",
      sectionId: "homepage-hero-display",
      value: heroIsReady ? "Ready" : "Add reel or image",
    },
    {
      isReady: bestSellersCount > 0,
      label: "Best sellers",
      sectionId: "homepage-best-sellers",
      value: `${bestSellersCount} selected`,
    },
    {
      isReady: highlightedCount > 0,
      label: "Highlighted",
      sectionId: "homepage-highlighted-content",
      value: `${highlightedCount} selected`,
    },
    {
      isReady: shopLookIsReady,
      label: "Shop the Look",
      sectionId: "homepage-shop-the-look",
      value: shopLookIsReady ? "Ready" : "Needs image and product",
    },
  ];

  function handleReadinessJump(
    event: MouseEvent<HTMLAnchorElement>,
    sectionId: string,
  ) {
    const section = document.getElementById(sectionId);

    if (!section) return;

    event.preventDefault();

    window.history.pushState(null, "", `#${sectionId}`);
    section.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  }

  return (
    <section className="py-layout-md">
      <div className="grid gap-layout-lg lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="space-y-layout-sm">
          <h2 className="text-2xl font-medium text-foreground">
            Storefront readiness
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {readyCount} of 4 required homepage areas are ready for customers.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-layout-lg gap-y-layout-sm">
          {items.map((item) => (
            <a
              aria-label={`Jump to ${item.label}`}
              href={`#${item.sectionId}`}
              key={item.label}
              onClick={(event) => handleReadinessJump(event, item.sectionId)}
              className="group flex min-w-[11rem] items-start gap-layout-xs rounded-md outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              {item.isReady ? (
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
              ) : (
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium leading-5 text-foreground">
                  {item.label}
                </p>
                <p className="text-xs leading-5 text-muted-foreground">
                  {item.value}
                </p>
                <span className="mt-layout-xs inline-flex items-center gap-1 text-xs font-medium leading-5 underline-offset-4 group-hover:underline">
                  Go to section
                  <ArrowDown
                    aria-hidden="true"
                    className="h-3 w-3 transition-transform group-hover:translate-y-0.5"
                  />
                </span>
              </div>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function Home() {
  const { activeStore } = useGetActiveStore();

  const products = useQuery(
    api.inventory.products.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );

  const bestSellers = useQuery(
    api.inventory.bestSeller.getAll,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
  );
  const highlightedItems = useQuery(
    api.inventory.featuredItem.getAll,
    activeStore?._id ? { storeId: activeStore._id, type: "regular" } : "skip",
  );
  const shopLookItems = useQuery(
    api.inventory.featuredItem.getAll,
    activeStore?._id ? { storeId: activeStore._id, type: "shop_look" } : "skip",
  );
  if (!activeStore || products === undefined) return null;

  const hasProducts = products.length > 0;

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="bg-background"
      scrollMode="page"
    >
      <FadeIn className="container mx-auto py-layout-xl">
        {hasProducts && (
          <PageWorkspace>
            <PageLevelHeader
              eyebrow="Storefront"
              title="Homepage"
              description="Manage the storefront homepage content customers see before they browse products or start checkout."
            />

            <HomepageReadinessSummary
              activeStore={activeStore}
              bestSellersCount={bestSellers?.length ?? 0}
              highlightedCount={highlightedItems?.length ?? 0}
              shopLookCount={shopLookItems?.length ?? 0}
            />

            <HomepageSettingsSection
              id="homepage-hero-display"
              title="Hero display"
              description="Choose the lead media, text treatment, and active reel or image for the top of the storefront."
            >
              <HeroSectionTabs />
            </HomepageSettingsSection>

            <HomepageSettingsSection
              title="Site banner"
              description="Set a short storefront announcement for offers, schedule changes, or time-bound customer notices."
            >
              <BannerMessageEditor storeId={activeStore._id} />
            </HomepageSettingsSection>

            <HomepageSettingsSection
              id="homepage-best-sellers"
              title="Best sellers"
              description="Order the products that should anchor the customer's first shopping path."
            >
              <BestSellers />
            </HomepageSettingsSection>

            <HomepageSettingsSection
              id="homepage-highlighted-content"
              title="Highlighted content"
              description="Select the product, category, or collection callout shown after the hero."
            >
              <FeaturedSection />
            </HomepageSettingsSection>

            <HomepageSettingsSection
              id="homepage-shop-the-look"
              title="Shop the look"
              description="Pair one visual story with the product customers should move toward next."
            >
              <ShopLookSection />
            </HomepageSettingsSection>
          </PageWorkspace>
        )}

        {!hasProducts && (
          <PageWorkspace>
            <PageLevelHeader
              eyebrow="Storefront"
              title="Homepage"
              description="Add products before configuring the customer-facing homepage."
            />
            <EmptyState
              icon={<StoreIcon className="w-16 h-16 text-muted-foreground" />}
              title={
                <div className="flex gap-1 text-sm">
                  <p className="text-muted-foreground">No products found in</p>
                  <p className="font-medium">{activeStore.name}</p>
                </div>
              }
              cta={
                <Link
                  to="/$orgUrlSlug/store/$storeUrlSlug/products/new"
                  params={(params) => ({
                    ...params,
                    orgUrlSlug: params.orgUrlSlug!,
                    storeUrlSlug: params.storeUrlSlug!,
                  })}
                  search={{ o: getOrigin() }}
                >
                  <Button variant="outline">
                    <PackagePlus className="h-4 w-4" />
                    Add product
                  </Button>
                </Link>
              }
            />
          </PageWorkspace>
        )}
      </FadeIn>
    </View>
  );
}
