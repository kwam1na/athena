import { Store } from "@athena/webapp";

type StoreConfigInput =
  | Store
  | { config?: unknown }
  | Record<string, any>
  | null
  | undefined;

type WaiveDeliveryFees =
  | boolean
  | {
      withinAccra?: boolean;
      otherRegions?: boolean;
      international?: boolean;
      all?: boolean;
    };

type PromoCodeConfig = {
  promoCodeId: string;
  value: number;
  displayText: string;
  discountType: string;
};

export type StoreConfigV2View = {
  operations: {
    availability: {
      inMaintenanceMode: boolean;
    };
    visibility: {
      inReadOnlyMode: boolean;
    };
    maintenance: {
      heading?: string;
      message?: string;
      countdownEndsAt?: number;
    };
  };
  commerce: {
    deliveryFees: {
      withinAccra?: number;
      otherRegions?: number;
      international?: number;
    };
    waiveDeliveryFees: WaiveDeliveryFees;
    fulfillment: {
      enableStorePickup?: boolean;
      enableDelivery?: boolean;
      disableStorePickup?: boolean;
      disableDelivery?: boolean;
      pickupRestriction?: {
        isActive?: boolean;
        message?: string;
        reason?: string;
        endTime?: number;
      };
      deliveryRestriction?: {
        isActive?: boolean;
        message?: string;
        reason?: string;
        endTime?: number;
      };
    };
  };
  media: {
    homeHero: {
      displayType: "reel" | "image";
      headerImage?: string;
      showOverlay: boolean;
      showText: boolean;
    };
    reels: {
      activeVersion?: number;
      activeHlsUrl?: string;
      landingPageVersion?: string;
      versions: string[];
      streamReels: Array<{
        version: number;
        hlsUrl?: string;
        streamUid?: string;
        thumbnailUrl?: string;
        source?: string;
        createdAt?: number;
      }>;
    };
    images: {
      fallbackImageUrl?: string;
      shopTheLookImage?: string;
      showroomImage?: string;
    };
  };
  promotions: {
    homepageDiscountCodeModalPromoCode?: PromoCodeConfig;
    leaveAReviewDiscountCodeModalPromoCode?: PromoCodeConfig;
  };
  contact: {
    location?: string;
    phoneNumber?: string;
  };
};

const asRecord = (value: unknown): Record<string, any> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  return value as Record<string, any>;
};

const asString = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" ? value : undefined;

const asBoolean = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

const firstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
};

const asOptionalArray = <T>(
  value: unknown,
  map: (item: unknown) => T | undefined,
): T[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value
    .map(map)
    .filter((item): item is T => item !== undefined);
};

const cleanUndefined = <T extends Record<string, any>>(value: T): T => {
  const next = { ...value };

  for (const [key, fieldValue] of Object.entries(next)) {
    if (fieldValue === undefined) {
      delete next[key as keyof T];
    }
  }

  return next;
};

const mapStreamReel = (value: unknown) => {
  const reel = asRecord(value);
  const version = asNumber(reel.version);
  if (version === undefined) {
    return undefined;
  }

  return {
    version,
    hlsUrl: asString(reel.hlsUrl),
    streamUid: asString(reel.streamUid),
    thumbnailUrl: asString(reel.thumbnailUrl),
    source: asString(reel.source),
    createdAt: asNumber(reel.createdAt),
  };
};

const mapPromo = (value: unknown): PromoCodeConfig | undefined => {
  const record = asRecord(value);
  const promoCodeId = asString(record.promoCodeId);
  const promoValue = asNumber(record.value);
  const displayText = asString(record.displayText);
  const discountType = asString(record.discountType);

  if (
    promoCodeId === undefined ||
    promoValue === undefined ||
    displayText === undefined ||
    discountType === undefined
  ) {
    return undefined;
  }

  return {
    promoCodeId,
    value: promoValue,
    displayText,
    discountType,
  };
};

const getRawConfig = (input: StoreConfigInput): Record<string, any> => {
  if (!input) {
    return {};
  }

  if ("config" in (input as Record<string, any>)) {
    return asRecord((input as { config?: unknown }).config);
  }

  return asRecord(input);
};

export const getStoreConfigV2 = (input: StoreConfigInput): StoreConfigV2View => {
  const config = getRawConfig(input);

  const operations = asRecord(config.operations);
  const commerce = asRecord(config.commerce);
  const media = asRecord(config.media);
  const promotions = asRecord(config.promotions);
  const contact = asRecord(config.contact);

  const homeHero = asRecord(media.homeHero);
  const reels = asRecord(media.reels);
  const images = asRecord(media.images);

  const legacyAvailability = asRecord(config.availability);
  const legacyVisibility = asRecord(config.visibility);
  const legacyMaintenance = asRecord(config.maintenance);
  const legacyDeliveryFees = asRecord(config.deliveryFees);
  const legacyWaiveFees = config.waiveDeliveryFees;
  const legacyFulfillment = asRecord(config.fulfillment);
  const legacyHomeHero = asRecord(config.homeHero);
  const legacyUi = asRecord(config.ui);
  const legacyContactInfo = asRecord(config.contactInfo);

  const waiveDeliveryFees: WaiveDeliveryFees = (() => {
    const value = firstDefined(commerce.waiveDeliveryFees, legacyWaiveFees);
    if (typeof value === "boolean") {
      return value;
    }

    return cleanUndefined({
      withinAccra: asBoolean(asRecord(value).withinAccra),
      otherRegions: asBoolean(asRecord(value).otherRegions),
      international: asBoolean(asRecord(value).international),
      all: asBoolean(asRecord(value).all),
    });
  })();

  return {
    operations: {
      availability: {
        inMaintenanceMode:
          firstDefined(
            asBoolean(asRecord(operations.availability).inMaintenanceMode),
            asBoolean(legacyAvailability.inMaintenanceMode),
          ) ?? false,
      },
      visibility: {
        inReadOnlyMode:
          firstDefined(
            asBoolean(asRecord(operations.visibility).inReadOnlyMode),
            asBoolean(legacyVisibility.inReadOnlyMode),
          ) ?? false,
      },
      maintenance: cleanUndefined({
        heading: firstDefined(
          asString(asRecord(operations.maintenance).heading),
          asString(legacyMaintenance.heading),
        ),
        message: firstDefined(
          asString(asRecord(operations.maintenance).message),
          asString(legacyMaintenance.message),
        ),
        countdownEndsAt: firstDefined(
          asNumber(asRecord(operations.maintenance).countdownEndsAt),
          asNumber(legacyMaintenance.countdownEndsAt),
        ),
      }),
    },
    commerce: {
      deliveryFees: cleanUndefined({
        withinAccra: firstDefined(
          asNumber(asRecord(commerce.deliveryFees).withinAccra),
          asNumber(legacyDeliveryFees.withinAccra),
        ),
        otherRegions: firstDefined(
          asNumber(asRecord(commerce.deliveryFees).otherRegions),
          asNumber(legacyDeliveryFees.otherRegions),
        ),
        international: firstDefined(
          asNumber(asRecord(commerce.deliveryFees).international),
          asNumber(legacyDeliveryFees.international),
        ),
      }),
      waiveDeliveryFees,
      fulfillment: cleanUndefined({
        enableStorePickup: firstDefined(
          asBoolean(asRecord(commerce.fulfillment).enableStorePickup),
          asBoolean(legacyFulfillment.enableStorePickup),
        ),
        enableDelivery: firstDefined(
          asBoolean(asRecord(commerce.fulfillment).enableDelivery),
          asBoolean(legacyFulfillment.enableDelivery),
        ),
        disableStorePickup: firstDefined(
          asBoolean(asRecord(commerce.fulfillment).disableStorePickup),
          asBoolean(legacyFulfillment.disableStorePickup),
        ),
        disableDelivery: firstDefined(
          asBoolean(asRecord(commerce.fulfillment).disableDelivery),
          asBoolean(legacyFulfillment.disableDelivery),
        ),
        pickupRestriction: cleanUndefined({
          isActive: firstDefined(
            asBoolean(asRecord(asRecord(commerce.fulfillment).pickupRestriction).isActive),
            asBoolean(asRecord(legacyFulfillment.pickupRestriction).isActive),
          ),
          message: firstDefined(
            asString(asRecord(asRecord(commerce.fulfillment).pickupRestriction).message),
            asString(asRecord(legacyFulfillment.pickupRestriction).message),
          ),
          reason: firstDefined(
            asString(asRecord(asRecord(commerce.fulfillment).pickupRestriction).reason),
            asString(asRecord(legacyFulfillment.pickupRestriction).reason),
          ),
          endTime: firstDefined(
            asNumber(asRecord(asRecord(commerce.fulfillment).pickupRestriction).endTime),
            asNumber(asRecord(legacyFulfillment.pickupRestriction).endTime),
          ),
        }),
        deliveryRestriction: cleanUndefined({
          isActive: firstDefined(
            asBoolean(asRecord(asRecord(commerce.fulfillment).deliveryRestriction).isActive),
            asBoolean(asRecord(legacyFulfillment.deliveryRestriction).isActive),
          ),
          message: firstDefined(
            asString(asRecord(asRecord(commerce.fulfillment).deliveryRestriction).message),
            asString(asRecord(legacyFulfillment.deliveryRestriction).message),
          ),
          reason: firstDefined(
            asString(asRecord(asRecord(commerce.fulfillment).deliveryRestriction).reason),
            asString(asRecord(legacyFulfillment.deliveryRestriction).reason),
          ),
          endTime: firstDefined(
            asNumber(asRecord(asRecord(commerce.fulfillment).deliveryRestriction).endTime),
            asNumber(asRecord(legacyFulfillment.deliveryRestriction).endTime),
          ),
        }),
      }),
    },
    media: {
      homeHero: {
        displayType:
          firstDefined(
            asString(homeHero.displayType),
            asString(legacyHomeHero.displayType),
            asString(config.heroDisplayType),
          ) === "image"
            ? "image"
            : "reel",
        headerImage: firstDefined(
          asString(homeHero.headerImage),
          asString(legacyHomeHero.headerImage),
          asString(config.heroHeaderImage),
        ),
        showOverlay:
          firstDefined(
            asBoolean(homeHero.showOverlay),
            asBoolean(legacyHomeHero.showOverlay),
            asBoolean(config.heroShowOverlay),
          ) ?? false,
        showText:
          firstDefined(
            asBoolean(homeHero.showText),
            asBoolean(legacyHomeHero.showText),
            asBoolean(config.heroShowText),
          ) ?? false,
      },
      reels: {
        activeVersion: firstDefined(
          asNumber(reels.activeVersion),
          asNumber(config.activeStreamReel),
        ),
        activeHlsUrl: firstDefined(
          asString(reels.activeHlsUrl),
          asString(config.activeStreamReelHlsUrl),
        ),
        landingPageVersion: firstDefined(
          asString(reels.landingPageVersion),
          asString(config.landingPageReelVersion),
        ),
        versions:
          firstDefined(
            asOptionalArray(reels.versions, (value) => asString(value)),
            asOptionalArray(config.reelVersions, (value) => asString(value)),
          ) ?? [],
        streamReels:
          firstDefined(
            asOptionalArray(reels.streamReels, mapStreamReel),
            asOptionalArray(config.streamReels, mapStreamReel),
          ) ?? [],
      },
      images: cleanUndefined({
        fallbackImageUrl: firstDefined(
          asString(images.fallbackImageUrl),
          asString(legacyUi.fallbackImageUrl),
        ),
        shopTheLookImage: firstDefined(
          asString(images.shopTheLookImage),
          asString(config.shopTheLookImage),
        ),
        showroomImage: firstDefined(
          asString(images.showroomImage),
          asString(config.showroomImage),
        ),
      }),
    },
    promotions: cleanUndefined({
      homepageDiscountCodeModalPromoCode: firstDefined(
        mapPromo(promotions.homepageDiscountCodeModalPromoCode),
        mapPromo(config.homepageDiscountCodeModalPromoCode),
      ),
      leaveAReviewDiscountCodeModalPromoCode: firstDefined(
        mapPromo(promotions.leaveAReviewDiscountCodeModalPromoCode),
        mapPromo(config.leaveAReviewDiscountCodeModalPromoCode),
      ),
    }),
    contact: cleanUndefined({
      location: firstDefined(
        asString(contact.location),
        asString(legacyContactInfo.location),
      ),
      phoneNumber: firstDefined(
        asString(contact.phoneNumber),
        asString(legacyContactInfo.phoneNumber),
      ),
    }),
  };
};

export const isStoreReadOnlyMode = (input: StoreConfigInput): boolean => {
  return getStoreConfigV2(input).operations.visibility.inReadOnlyMode;
};

export const isStoreMaintenanceMode = (input: StoreConfigInput): boolean => {
  const config = getStoreConfigV2(input);
  if (!config.operations.availability.inMaintenanceMode) {
    return false;
  }

  const countdownEndsAt = config.operations.maintenance.countdownEndsAt;
  if (countdownEndsAt === undefined) {
    return true;
  }

  return countdownEndsAt > Date.now();
};

export const getStoreFallbackImageUrl = (
  input: StoreConfigInput,
  defaultValue?: string,
): string | undefined => {
  return getStoreConfigV2(input).media.images.fallbackImageUrl || defaultValue;
};
