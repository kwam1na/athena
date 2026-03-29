import {
  Store,
  StoreConfigV2,
  StoreDeliveryFeesConfig,
  StoreFulfillmentConfig,
  StoreTaxConfig,
  StoreWaiveDeliveryFeesConfig,
  StoreContactConfig,
  StoreHomeHeroConfig,
  StorePromotionConfig,
  StoreStreamReelConfig,
} from "~/types";

type StoreConfigInput =
  | Store
  | { config?: unknown }
  | Record<string, any>
  | null
  | undefined;

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

const firstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
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

const getRawConfig = (input: StoreConfigInput): Record<string, any> => {
  if (!input) {
    return {};
  }

  if ("config" in (input as Record<string, any>)) {
    return asRecord((input as { config?: unknown }).config);
  }

  return asRecord(input);
};

const mapStreamReel = (value: unknown): StoreStreamReelConfig | undefined => {
  const reel = asRecord(value);
  const version = asNumber(reel.version);
  if (version === undefined) {
    return undefined;
  }

  return {
    version,
    source: asString(reel.source),
    streamUid: asString(reel.streamUid),
    hlsUrl: asString(reel.hlsUrl),
    thumbnailUrl: asString(reel.thumbnailUrl),
    createdAt: asNumber(reel.createdAt),
  };
};

const mapPromotion = (value: unknown): StorePromotionConfig | undefined => {
  const promotion = asRecord(value);
  return Object.keys(promotion).length > 0 ? promotion : undefined;
};

const normalizeWaiveDeliveryFees = (
  value: unknown,
): StoreWaiveDeliveryFeesConfig => {
  if (typeof value === "boolean") {
    return value;
  }

  const record = asRecord(value);

  return cleanUndefined({
    all: asBoolean(record.all),
    international: asBoolean(record.international),
    otherRegions: asBoolean(record.otherRegions),
    withinAccra: asBoolean(record.withinAccra),
  });
};

export const getStoreConfigV2 = (input: StoreConfigInput): StoreConfigV2 => {
  const config = getRawConfig(input);

  const operations = asRecord(config.operations);
  const commerce = asRecord(config.commerce);
  const media = asRecord(config.media);
  const promotions = asRecord(config.promotions);
  const contact = asRecord(config.contact);

  const homeHero = asRecord(media.homeHero);
  const reels = asRecord(media.reels);
  const images = asRecord(media.images);

  const legacyHomeHero = asRecord(config.homeHero);
  const legacyAvailability = asRecord(config.availability);
  const legacyVisibility = asRecord(config.visibility);
  const legacyMaintenance = asRecord(config.maintenance);
  const legacyDeliveryFees = asRecord(config.deliveryFees);
  const legacyFulfillment = asRecord(config.fulfillment);
  const legacyTax = asRecord(config.tax);
  const legacyUi = asRecord(config.ui);
  const legacyContactInfo = asRecord(config.contactInfo);

  const operationsConfig = {
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
  };

  const deliveryFees: StoreDeliveryFeesConfig = cleanUndefined({
    international: firstDefined(
      asNumber(asRecord(commerce.deliveryFees).international),
      asNumber(legacyDeliveryFees.international),
    ),
    otherRegions: firstDefined(
      asNumber(asRecord(commerce.deliveryFees).otherRegions),
      asNumber(legacyDeliveryFees.otherRegions),
    ),
    withinAccra: firstDefined(
      asNumber(asRecord(commerce.deliveryFees).withinAccra),
      asNumber(legacyDeliveryFees.withinAccra),
    ),
  });

  const fulfillment: StoreFulfillmentConfig = cleanUndefined({
    disableDelivery: firstDefined(
      asBoolean(asRecord(commerce.fulfillment).disableDelivery),
      asBoolean(legacyFulfillment.disableDelivery),
    ),
    disableStorePickup: firstDefined(
      asBoolean(asRecord(commerce.fulfillment).disableStorePickup),
      asBoolean(legacyFulfillment.disableStorePickup),
    ),
    enableDelivery: firstDefined(
      asBoolean(asRecord(commerce.fulfillment).enableDelivery),
      asBoolean(legacyFulfillment.enableDelivery),
    ),
    enableStorePickup: firstDefined(
      asBoolean(asRecord(commerce.fulfillment).enableStorePickup),
      asBoolean(legacyFulfillment.enableStorePickup),
    ),
    pickupRestriction: cleanUndefined({
      isActive: firstDefined(
        asBoolean(asRecord(asRecord(commerce.fulfillment).pickupRestriction).isActive),
        asBoolean(asRecord(legacyFulfillment.pickupRestriction).isActive),
      ),
      reason: firstDefined(
        asString(asRecord(asRecord(commerce.fulfillment).pickupRestriction).reason),
        asString(asRecord(legacyFulfillment.pickupRestriction).reason),
      ),
      message: firstDefined(
        asString(asRecord(asRecord(commerce.fulfillment).pickupRestriction).message),
        asString(asRecord(legacyFulfillment.pickupRestriction).message),
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
      reason: firstDefined(
        asString(asRecord(asRecord(commerce.fulfillment).deliveryRestriction).reason),
        asString(asRecord(legacyFulfillment.deliveryRestriction).reason),
      ),
      message: firstDefined(
        asString(asRecord(asRecord(commerce.fulfillment).deliveryRestriction).message),
        asString(asRecord(legacyFulfillment.deliveryRestriction).message),
      ),
      endTime: firstDefined(
        asNumber(asRecord(asRecord(commerce.fulfillment).deliveryRestriction).endTime),
        asNumber(asRecord(legacyFulfillment.deliveryRestriction).endTime),
      ),
    }),
  });

  const tax: StoreTaxConfig = cleanUndefined({
    enabled: firstDefined(
      asBoolean(asRecord(commerce.tax).enabled),
      asBoolean(legacyTax.enabled),
    ),
    includedInPrice: firstDefined(
      asBoolean(asRecord(commerce.tax).includedInPrice),
      asBoolean(legacyTax.includedInPrice),
    ),
    name: firstDefined(asString(asRecord(commerce.tax).name), asString(legacyTax.name)),
    rate: firstDefined(asNumber(asRecord(commerce.tax).rate), asNumber(legacyTax.rate)),
  });

  const homeHeroConfig: StoreHomeHeroConfig = {
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
  };

  return {
    operations: operationsConfig,
    commerce: {
      deliveryFees,
      waiveDeliveryFees: normalizeWaiveDeliveryFees(
        firstDefined(commerce.waiveDeliveryFees, config.waiveDeliveryFees),
      ),
      fulfillment,
      tax,
    },
    media: {
      homeHero: homeHeroConfig,
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
        mapPromotion(promotions.homepageDiscountCodeModalPromoCode),
        mapPromotion(config.homepageDiscountCodeModalPromoCode),
      ),
      leaveAReviewDiscountCodeModalPromoCode: firstDefined(
        mapPromotion(promotions.leaveAReviewDiscountCodeModalPromoCode),
        mapPromotion(config.leaveAReviewDiscountCodeModalPromoCode),
      ),
    }),
    contact: cleanUndefined({
      phoneNumber: firstDefined(
        asString(contact.phoneNumber),
        asString(legacyContactInfo.phoneNumber),
      ),
      location: firstDefined(
        asString(contact.location),
        asString(legacyContactInfo.location),
      ),
    }) as StoreContactConfig,
  };
};
