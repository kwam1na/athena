import { describe, expect, it } from "vitest";
import { getStoreConfigV2 } from "./storeConfig";

describe("getStoreConfigV2", () => {
  it("reads legacy-root store config keys into grouped sections", () => {
    const config = getStoreConfigV2({
      config: {
        availability: { inMaintenanceMode: true },
        visibility: { inReadOnlyMode: false },
        contactInfo: { phoneNumber: "+233", location: "Accra" },
        deliveryFees: {
          withinAccra: 40,
          otherRegions: 70,
          international: 800,
        },
        waiveDeliveryFees: { all: true },
        fulfillment: { enableDelivery: true, enableStorePickup: false },
        tax: { enabled: true, rate: 9, name: "VAT", includedInPrice: false },
        homeHero: {
          displayType: "image",
          headerImage: "https://example.com/hero.webp",
          showOverlay: true,
          showText: true,
        },
        streamReels: [{ version: 2, hlsUrl: "https://cdn/reel.m3u8" }],
        activeStreamReel: 2,
        activeStreamReelHlsUrl: "https://cdn/reel.m3u8",
        ui: { fallbackImageUrl: "https://example.com/fallback.webp" },
        showroomImage: "https://example.com/showroom.webp",
        shopTheLookImage: "https://example.com/shop.webp",
      },
    });

    expect(config.operations.availability.inMaintenanceMode).toBe(true);
    expect(config.contact.phoneNumber).toBe("+233");
    expect(config.commerce.deliveryFees.withinAccra).toBe(40);
    expect(config.media.homeHero.displayType).toBe("image");
    expect(config.media.reels.activeVersion).toBe(2);
    expect(config.media.images.fallbackImageUrl).toBe(
      "https://example.com/fallback.webp",
    );
  });

  it("prefers grouped V2 keys when both legacy and grouped keys exist", () => {
    const config = getStoreConfigV2({
      config: {
        availability: { inMaintenanceMode: true },
        operations: {
          availability: { inMaintenanceMode: false },
          visibility: { inReadOnlyMode: true },
        },
        homeHero: { displayType: "image", showOverlay: false, showText: false },
        media: {
          homeHero: { displayType: "reel", showOverlay: true, showText: true },
          reels: { activeVersion: 3, activeHlsUrl: "https://new/reel.m3u8" },
        },
      },
    });

    expect(config.operations.availability.inMaintenanceMode).toBe(false);
    expect(config.operations.visibility.inReadOnlyMode).toBe(true);
    expect(config.media.homeHero.displayType).toBe("reel");
    expect(config.media.homeHero.showOverlay).toBe(true);
    expect(config.media.reels.activeVersion).toBe(3);
    expect(config.media.reels.activeHlsUrl).toBe("https://new/reel.m3u8");
  });
});
