import { describe, expect, it } from "vitest";
import {
  isStoreCheckoutDisabled,
  mirrorLegacyKeys,
  patchV2Config,
  toV2Config,
} from "./storeConfigV2";

const legacyConfigSample = {
  activeStreamReel: 2,
  activeStreamReelHlsUrl:
    "https://customer.cloudflarestream.com/70d86c67/manifest/video.m3u8",
  availability: {
    inMaintenanceMode: false,
  },
  contactInfo: {
    location: "2 Jungle Avenue, East Legon, Accra, Ghana",
    phoneNumber: "+233249771887",
  },
  deliveryFees: {
    international: 800,
    otherRegions: 70,
    withinAccra: 40,
  },
  fulfillment: {
    deliveryRestriction: {
      isActive: false,
      message: "",
      reason: "",
    },
    disableDelivery: false,
    disableStorePickup: false,
    enableDelivery: true,
    enableStorePickup: true,
    pickupRestriction: {
      isActive: false,
      message: "",
      reason: "",
    },
  },
  homeHero: {
    displayType: "reel",
    headerImage: "https://example.com/header.webp",
    showOverlay: false,
    showText: false,
  },
  landingPageReelVersion: "3",
  leaveAReviewDiscountCodeModalPromoCode: {
    discountType: "percentage",
    displayText: "30%",
    promoCodeId: "promo-code-id",
    value: 30,
  },
  maintenance: {
    countdownEndsAt: 1760875200000,
    message: "We are stocking products for our clearance sale.",
  },
  reelVersions: ["1", "2", "3"],
  shopTheLookImage: "https://example.com/shop-look.webp",
  showroomImage: "https://example.com/show-room.webp",
  streamReels: [
    {
      createdAt: 1774422243082,
      hlsUrl: "https://customer.cloudflarestream.com/d88e985/manifest/video.m3u8",
      source: "stream",
      streamUid: "d88e985",
      thumbnailUrl: "https://customer.cloudflarestream.com/d88e985/thumb.jpg",
      version: 1,
    },
    {
      createdAt: 1774757837641,
      hlsUrl: "https://customer.cloudflarestream.com/70d86c67/manifest/video.m3u8",
      source: "stream",
      streamUid: "70d86c67",
      thumbnailUrl: "https://customer.cloudflarestream.com/70d86c67/thumb.jpg",
      version: 2,
    },
  ],
  tax: {
    enabled: false,
    includedInPrice: false,
    name: "VAT",
    rate: 9,
  },
  ui: {
    fallbackImageUrl: "https://example.com/fallback.webp",
  },
  visibility: {
    inReadOnlyMode: false,
  },
  waiveDeliveryFees: {
    all: false,
    international: false,
    otherRegions: false,
    withinAccra: false,
  },
};

describe("storeConfigV2 helpers", () => {
  it("projects legacy config into the expected V2 grouped shape", () => {
    expect(toV2Config(legacyConfigSample)).toEqual({
      operations: {
        availability: { inMaintenanceMode: false },
        visibility: { inReadOnlyMode: false },
        maintenance: {
          countdownEndsAt: 1760875200000,
          message: "We are stocking products for our clearance sale.",
        },
      },
      commerce: {
        deliveryFees: {
          international: 800,
          otherRegions: 70,
          withinAccra: 40,
        },
        waiveDeliveryFees: {
          all: false,
          international: false,
          otherRegions: false,
          withinAccra: false,
        },
        fulfillment: {
          deliveryRestriction: {
            isActive: false,
            message: "",
            reason: "",
          },
          disableDelivery: false,
          disableStorePickup: false,
          enableDelivery: true,
          enableStorePickup: true,
          pickupRestriction: {
            isActive: false,
            message: "",
            reason: "",
          },
        },
        tax: {
          enabled: false,
          includedInPrice: false,
          name: "VAT",
          rate: 9,
        },
      },
      media: {
        homeHero: {
          displayType: "reel",
          headerImage: "https://example.com/header.webp",
          showOverlay: false,
          showText: false,
        },
        reels: {
          activeVersion: 2,
          activeHlsUrl:
            "https://customer.cloudflarestream.com/70d86c67/manifest/video.m3u8",
          landingPageVersion: "3",
          versions: ["1", "2", "3"],
          streamReels: [
            {
              createdAt: 1774422243082,
              hlsUrl:
                "https://customer.cloudflarestream.com/d88e985/manifest/video.m3u8",
              source: "stream",
              streamUid: "d88e985",
              thumbnailUrl: "https://customer.cloudflarestream.com/d88e985/thumb.jpg",
              version: 1,
            },
            {
              createdAt: 1774757837641,
              hlsUrl:
                "https://customer.cloudflarestream.com/70d86c67/manifest/video.m3u8",
              source: "stream",
              streamUid: "70d86c67",
              thumbnailUrl: "https://customer.cloudflarestream.com/70d86c67/thumb.jpg",
              version: 2,
            },
          ],
        },
        images: {
          fallbackImageUrl: "https://example.com/fallback.webp",
          shopTheLookImage: "https://example.com/shop-look.webp",
          showroomImage: "https://example.com/show-room.webp",
        },
      },
      promotions: {
        leaveAReviewDiscountCodeModalPromoCode: {
          discountType: "percentage",
          displayText: "30%",
          promoCodeId: "promo-code-id",
          value: 30,
        },
      },
      contact: {
        location: "2 Jungle Avenue, East Legon, Accra, Ghana",
        phoneNumber: "+233249771887",
      },
      payments: {
        mtnMomo: {
          receivingAccounts: [],
        },
      },
    });
  });

  it("mirrors grouped values back to legacy keys during interim write-through", () => {
    const v2Config = toV2Config(legacyConfigSample);
    const mirrored = mirrorLegacyKeys(v2Config, {
      ...legacyConfigSample,
      customUnmappedKey: { keep: true },
    });

    expect(mirrored.operations).toEqual(v2Config.operations);
    expect(mirrored.commerce).toEqual(v2Config.commerce);
    expect(mirrored.media).toEqual(v2Config.media);
    expect(mirrored.promotions).toEqual(v2Config.promotions);
    expect(mirrored.contact).toEqual(v2Config.contact);
    expect(mirrored.payments).toEqual(v2Config.payments);

    expect(mirrored.activeStreamReel).toBe(2);
    expect(mirrored.activeStreamReelHlsUrl).toBe(
      "https://customer.cloudflarestream.com/70d86c67/manifest/video.m3u8",
    );
    expect(mirrored.homeHero).toEqual(v2Config.media.homeHero);
    expect(mirrored.deliveryFees).toEqual(v2Config.commerce.deliveryFees);
    expect(mirrored.customUnmappedKey).toEqual({ keep: true });

    const cleared = mirrorLegacyKeys(
      patchV2Config(mirrored, {
        media: {
          reels: {
            activeVersion: null,
            activeHlsUrl: null,
          },
        },
      }),
      mirrored,
    );

    expect(cleared).not.toHaveProperty("activeStreamReel");
    expect(cleared).not.toHaveProperty("activeStreamReelHlsUrl");
  });

  it("evaluates checkout maintenance/read-only gating for legacy and V2 configs", () => {
    const legacyMaintenanceConfig = {
      availability: { inMaintenanceMode: true },
      visibility: { inReadOnlyMode: false },
    };

    const v2ReadOnlyConfig = {
      operations: {
        availability: { inMaintenanceMode: false },
        visibility: { inReadOnlyMode: true },
      },
    };

    const activeConfig = {
      availability: { inMaintenanceMode: false },
      visibility: { inReadOnlyMode: false },
    };

    expect(isStoreCheckoutDisabled(legacyMaintenanceConfig)).toBe(true);
    expect(isStoreCheckoutDisabled(v2ReadOnlyConfig)).toBe(true);
    expect(isStoreCheckoutDisabled(activeConfig)).toBe(false);
  });

  it("normalizes MTN MoMo receiving accounts during grouped config patches", () => {
    const patched = patchV2Config({}, {
      payments: {
        mtnMomo: {
          receivingAccounts: [
            {
              label: "Main account",
              walletNumber: "233000111222",
              businessName: "Flagship Retail",
              market: "Ghana",
              businessContact: "ops@flagship.example",
              isPrimary: true,
              status: "submitted",
            },
            {
              label: "Backup account",
              walletNumber: "256000333444",
              businessName: "Flagship Retail Uganda",
              market: "Uganda",
              businessContact: "finance@flagship.example",
              isPrimary: true,
              status: "invalid-status",
              statusNote: "Waiting on review",
            },
            {},
          ],
        },
      },
    });

    expect(patched.payments.mtnMomo.receivingAccounts).toEqual([
      {
        label: "Main account",
        walletNumber: "233000111222",
        businessName: "Flagship Retail",
        market: "Ghana",
        businessContact: "ops@flagship.example",
        isPrimary: true,
        status: "submitted",
      },
      {
        label: "Backup account",
        walletNumber: "256000333444",
        businessName: "Flagship Retail Uganda",
        market: "Uganda",
        businessContact: "finance@flagship.example",
        isPrimary: false,
        status: "not_configured",
        statusNote: "Waiting on review",
      },
    ]);
  });
});
