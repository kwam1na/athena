import { useQuery } from "convex/react";
import { Link } from "@tanstack/react-router";
import useGetActiveStore from "../../hooks/useGetActiveStore";
import View from "../View";
import { PageLevelHeader, PageWorkspace } from "../common/PageLevelHeader";

import { BestSellers } from "./BestSellers";
import { FeaturedSection } from "./FeaturedSection";
import { api } from "~/convex/_generated/api";
import { EmptyState } from "../states/empty/empty-state";
import { PackagePlus, Store as StoreIcon } from "lucide-react";
import { ShopLookSection } from "./ShopLook";
import { FadeIn } from "../common/FadeIn";
import { HeroSectionTabs } from "./HeroSectionTabs";
import { BannerMessageEditor } from "./BannerMessageEditor";
import type { ReactNode } from "react";
import { Button } from "../ui/button";
import { getOrigin } from "~/src/lib/navigationUtils";
import { getStoreConfigV2 } from "~/src/lib/storeConfig";
import type { Store as StoreDoc } from "~/types";

function HomepageSettingsSection({
  title,
  description,
  children,
  withTopBorder = false,
}: {
  title: string;
  description: string;
  children: ReactNode;
  withTopBorder?: boolean;
}) {
  return (
    <section
      className={[
        "grid gap-layout-xl border-b border-border py-layout-2xl lg:grid-cols-[17rem_minmax(0,1fr)]",
        withTopBorder ? "border-t" : "",
      ].join(" ")}
    >
      <div className="space-y-layout-sm">
        <h2 className="text-2xl font-medium text-foreground">{title}</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          {description}
        </p>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}

function HomepageReadinessSummary({
  activeStore,
  bestSellersCount,
  highlightedCount,
  isBannerActive,
  shopLookCount,
}: {
  activeStore: StoreDoc;
  bestSellersCount: number;
  highlightedCount: number;
  isBannerActive: boolean;
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
      label: "Hero",
      value: heroIsReady ? "Ready" : "Needs media",
    },
    {
      label: "Banner",
      value: isBannerActive ? "Active" : "Inactive",
    },
    {
      label: "Best sellers",
      value: `${bestSellersCount} selected`,
    },
    {
      label: "Highlighted",
      value: `${highlightedCount} selected`,
    },
    {
      label: "Shop the Look",
      value: shopLookIsReady ? "Ready" : "Needs image and product",
    },
  ];

  return (
    <section className="border-b border-border pb-layout-xl">
      <div className="grid gap-layout-lg lg:grid-cols-[17rem_minmax(0,1fr)]">
        <div className="space-y-layout-sm">
          <h2 className="text-2xl font-medium text-foreground">
            Storefront readiness
          </h2>
          <p className="text-sm leading-6 text-muted-foreground">
            {readyCount} of 4 required homepage areas are ready for customers.
          </p>
        </div>
        <div className="grid gap-layout-sm md:grid-cols-2 xl:grid-cols-5">
          {items.map((item) => (
            <div
              key={item.label}
              className="rounded-md border border-border bg-background p-layout-sm"
            >
              <p className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                {item.label}
              </p>
              <p className="mt-layout-xs text-sm font-medium leading-5 text-foreground">
                {item.value}
              </p>
            </div>
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
    activeStore?._id ? { storeId: activeStore._id } : "skip"
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
  const bannerMessage = useQuery(
    api.inventory.bannerMessage.get,
    activeStore?._id ? { storeId: activeStore._id } : "skip",
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
              isBannerActive={Boolean(bannerMessage?.active)}
              shopLookCount={shopLookItems?.length ?? 0}
            />

            <HomepageSettingsSection
              title="Hero display"
              description="Choose the lead media, text treatment, and active reel or image for the top of the storefront."
              withTopBorder
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
              title="Best sellers"
              description="Order the products that should anchor the customer's first shopping path."
            >
              <BestSellers />
            </HomepageSettingsSection>

            <HomepageSettingsSection
              title="Highlighted content"
              description="Select the product, category, or collection callout shown after the hero."
            >
              <FeaturedSection />
            </HomepageSettingsSection>

            <HomepageSettingsSection
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
