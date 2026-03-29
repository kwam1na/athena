import { describe, expect, it } from "vitest";

import {
  getStoreConfigV2,
  getStoreFallbackImageUrl,
  isStoreMaintenanceMode,
  isStoreReadOnlyMode,
} from "./storeConfig";

const buildV2Config = (overrides: Record<string, any> = {}) => ({
  operations: {
    availability: {
      inMaintenanceMode: true,
    },
    visibility: {
      inReadOnlyMode: true,
    },
    maintenance: {
      heading: "Maintenance",
      message: "Store is temporarily unavailable",
      countdownEndsAt: Date.now() + 60_000,
    },
  },
  commerce: {
    deliveryFees: {
      withinAccra: 40,
      otherRegions: 70,
      international: 800,
    },
    waiveDeliveryFees: {
      all: false,
      withinAccra: false,
      otherRegions: true,
      international: false,
    },
    fulfillment: {
      enableStorePickup: true,
      enableDelivery: true,
      disableStorePickup: false,
      disableDelivery: false,
      pickupRestriction: {
        isActive: false,
      },
      deliveryRestriction: {
        isActive: false,
      },
    },
  },
  media: {
    homeHero: {
      displayType: "reel",
      headerImage: "https://cdn.example.com/home-hero.webp",
      showOverlay: true,
      showText: false,
    },
    reels: {
      activeVersion: 2,
      activeHlsUrl: "https://cdn.example.com/reel-2.m3u8",
      landingPageVersion: "3",
      versions: ["1", "2", "3"],
      streamReels: [
        {
          version: 2,
          hlsUrl: "https://cdn.example.com/reel-2.m3u8",
          streamUid: "stream-2",
          thumbnailUrl: "https://cdn.example.com/reel-2.jpg",
          source: "stream",
          createdAt: 1700000000000,
        },
      ],
    },
    images: {
      fallbackImageUrl: "https://cdn.example.com/fallback.webp",
      shopTheLookImage: "https://cdn.example.com/shop-look.webp",
      showroomImage: "https://cdn.example.com/showroom.webp",
    },
  },
  promotions: {
    homepageDiscountCodeModalPromoCode: {
      promoCodeId: "promo-home-10",
      displayText: "10%",
      value: 10,
      discountType: "percentage",
    },
    leaveAReviewDiscountCodeModalPromoCode: {
      promoCodeId: "promo-review-20",
      displayText: "20%",
      value: 20,
      discountType: "percentage",
    },
  },
  contact: {
    location: "2 Jungle Avenue, East Legon, Accra, Ghana",
    phoneNumber: "+233249771887",
  },
  ...overrides,
});

describe("storeConfig v2 selectors", () => {
  it("reads grouped V2 media and promotion values", () => {
    const config = buildV2Config();

    const result = getStoreConfigV2({ config });

    expect(result.media.reels.activeHlsUrl).toBe(
      "https://cdn.example.com/reel-2.m3u8"
    );
    expect(result.media.homeHero.displayType).toBe("reel");
    expect(result.media.images.shopTheLookImage).toBe(
      "https://cdn.example.com/shop-look.webp"
    );
    expect(result.promotions.homepageDiscountCodeModalPromoCode).toEqual({
      promoCodeId: "promo-home-10",
      displayText: "10%",
      value: 10,
      discountType: "percentage",
    });
  });

  it("reads grouped V2 commerce settings used by checkout", () => {
    const config = buildV2Config();

    const result = getStoreConfigV2({ config });

    expect(result.commerce.deliveryFees).toEqual({
      withinAccra: 40,
      otherRegions: 70,
      international: 800,
    });
    expect(result.commerce.fulfillment.enableDelivery).toBe(true);
    expect(result.commerce.fulfillment.enableStorePickup).toBe(true);
    expect(result.commerce.waiveDeliveryFees).toEqual({
      all: false,
      withinAccra: false,
      otherRegions: true,
      international: false,
    });
  });

  it("computes read-only and maintenance modes from grouped V2 operations", () => {
    const activeMaintenanceConfig = buildV2Config();

    expect(isStoreReadOnlyMode({ config: activeMaintenanceConfig })).toBe(true);
    expect(isStoreMaintenanceMode({ config: activeMaintenanceConfig })).toBe(
      true
    );

    const expiredMaintenanceConfig = buildV2Config({
      operations: {
        availability: { inMaintenanceMode: true },
        visibility: { inReadOnlyMode: false },
        maintenance: {
          countdownEndsAt: Date.now() - 60_000,
        },
      },
    });

    expect(isStoreReadOnlyMode({ config: expiredMaintenanceConfig })).toBe(
      false
    );
    expect(isStoreMaintenanceMode({ config: expiredMaintenanceConfig })).toBe(
      false
    );
  });

  it("returns fallback image from grouped V2 media config", () => {
    const config = buildV2Config();

    expect(getStoreFallbackImageUrl({ config })).toBe(
      "https://cdn.example.com/fallback.webp"
    );

    const noFallback = buildV2Config({
      media: {
        ...buildV2Config().media,
        images: {},
      },
    });

    expect(getStoreFallbackImageUrl({ config: noFallback }, "default.png")).toBe(
      "default.png"
    );
  });
});
