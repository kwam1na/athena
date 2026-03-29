import {
  StoreConfigV2,
  StoreWaiveDeliveryFeesConfig,
  StorePromotionConfig,
} from "../../types";

const LEGACY_ROOT_KEYS = [
  "activeStreamReel",
  "activeStreamReelHlsUrl",
  "availability",
  "contactInfo",
  "deliveryFees",
  "fulfillment",
  "heroDisplayType",
  "heroHeaderImage",
  "heroShowOverlay",
  "heroShowText",
  "homeHero",
  "homepageDiscountCodeModalPromoCode",
  "landingPageReelVersion",
  "leaveAReviewDiscountCodeModalPromoCode",
  "maintenance",
  "reelVersions",
  "shopTheLookImage",
  "showroomImage",
  "streamReels",
  "tax",
  "ui",
  "visibility",
  "waiveDeliveryFees",
] as const;

const V2_ROOT_KEYS = [
  "operations",
  "commerce",
  "media",
  "promotions",
  "contact",
] as const;

const LEGACY_ROOT_KEY_SET = new Set<string>(LEGACY_ROOT_KEYS);
const V2_ROOT_KEY_SET = new Set<string>(V2_ROOT_KEYS);

export const KNOWN_STORE_CONFIG_ROOT_KEYS = new Set<string>([
  ...LEGACY_ROOT_KEYS,
  ...V2_ROOT_KEYS,
]);

const isPlainObject = (value: unknown): value is Record<string, any> => {
  return !!value && typeof value === "object" && !Array.isArray(value);
};

const asRecord = (value: unknown): Record<string, any> => {
  return isPlainObject(value) ? value : {};
};

const asNumber = (value: unknown): number | undefined => {
  return typeof value === "number" ? value : undefined;
};

const asString = (value: unknown): string | undefined => {
  return typeof value === "string" ? value : undefined;
};

const asBoolean = (value: unknown): boolean | undefined => {
  return typeof value === "boolean" ? value : undefined;
};

const asArray = <T>(
  value: unknown,
  mapper: (item: unknown) => T | undefined,
): T[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map(mapper)
    .filter((item): item is T => item !== undefined);
};

const asOptionalArray = <T>(
  value: unknown,
  mapper: (item: unknown) => T | undefined,
): T[] | undefined => {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return asArray(value, mapper);
};

const firstDefined = <T>(...values: Array<T | undefined | null>): T | undefined => {
  for (const value of values) {
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return undefined;
};

const mapPromotion = (value: unknown): StorePromotionConfig | undefined => {
  return isPlainObject(value) ? { ...value } : undefined;
};

const mapStreamReel = (value: unknown) => {
  if (!isPlainObject(value)) {
    return undefined;
  }

  const version = asNumber(value.version);
  if (version === undefined) {
    return undefined;
  }

  return {
    version,
    source: asString(value.source),
    streamUid: asString(value.streamUid),
    hlsUrl: asString(value.hlsUrl),
    thumbnailUrl: asString(value.thumbnailUrl),
    createdAt: asNumber(value.createdAt),
  };
};

const normalizeWaiveDeliveryFees = (
  value: unknown,
): StoreWaiveDeliveryFeesConfig => {
  if (typeof value === "boolean") {
    return value;
  }

  const record = asRecord(value);

  return {
    all: asBoolean(record.all),
    international: asBoolean(record.international),
    otherRegions: asBoolean(record.otherRegions),
    withinAccra: asBoolean(record.withinAccra),
  };
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

export const toV2Config = (config: unknown): StoreConfigV2 => {
  const root = asRecord(config);

  const operations = asRecord(root.operations);
  const operationsAvailability = asRecord(operations.availability);
  const operationsVisibility = asRecord(operations.visibility);
  const operationsMaintenance = asRecord(operations.maintenance);

  const commerce = asRecord(root.commerce);
  const commerceDeliveryFees = asRecord(commerce.deliveryFees);
  const commerceFulfillment = asRecord(commerce.fulfillment);
  const commerceTax = asRecord(commerce.tax);

  const media = asRecord(root.media);
  const mediaHomeHero = asRecord(media.homeHero);
  const mediaReels = asRecord(media.reels);
  const mediaImages = asRecord(media.images);

  const promotions = asRecord(root.promotions);
  const contact = asRecord(root.contact);

  const legacyAvailability = asRecord(root.availability);
  const legacyVisibility = asRecord(root.visibility);
  const legacyMaintenance = asRecord(root.maintenance);
  const legacyDeliveryFees = asRecord(root.deliveryFees);
  const legacyFulfillment = asRecord(root.fulfillment);
  const legacyTax = asRecord(root.tax);
  const legacyHomeHero = asRecord(root.homeHero);
  const legacyUi = asRecord(root.ui);
  const legacyContactInfo = asRecord(root.contactInfo);

  return {
    operations: {
      availability: {
        inMaintenanceMode:
          firstDefined(
            asBoolean(operationsAvailability.inMaintenanceMode),
            asBoolean(legacyAvailability.inMaintenanceMode),
          ) ?? false,
      },
      visibility: {
        inReadOnlyMode:
          firstDefined(
            asBoolean(operationsVisibility.inReadOnlyMode),
            asBoolean(legacyVisibility.inReadOnlyMode),
          ) ?? false,
      },
      maintenance: cleanUndefined({
        countdownEndsAt: firstDefined(
          asNumber(operationsMaintenance.countdownEndsAt),
          asNumber(legacyMaintenance.countdownEndsAt),
        ),
        heading: firstDefined(
          asString(operationsMaintenance.heading),
          asString(legacyMaintenance.heading),
        ),
        message: firstDefined(
          asString(operationsMaintenance.message),
          asString(legacyMaintenance.message),
        ),
      }),
    },
    commerce: {
      deliveryFees: cleanUndefined({
        international: firstDefined(
          asNumber(commerceDeliveryFees.international),
          asNumber(legacyDeliveryFees.international),
        ),
        otherRegions: firstDefined(
          asNumber(commerceDeliveryFees.otherRegions),
          asNumber(legacyDeliveryFees.otherRegions),
        ),
        withinAccra: firstDefined(
          asNumber(commerceDeliveryFees.withinAccra),
          asNumber(legacyDeliveryFees.withinAccra),
        ),
      }),
      waiveDeliveryFees: normalizeWaiveDeliveryFees(
        firstDefined(commerce.waiveDeliveryFees, root.waiveDeliveryFees),
      ),
      fulfillment: cleanUndefined({
        disableDelivery: firstDefined(
          asBoolean(commerceFulfillment.disableDelivery),
          asBoolean(legacyFulfillment.disableDelivery),
        ),
        disableStorePickup: firstDefined(
          asBoolean(commerceFulfillment.disableStorePickup),
          asBoolean(legacyFulfillment.disableStorePickup),
        ),
        enableDelivery: firstDefined(
          asBoolean(commerceFulfillment.enableDelivery),
          asBoolean(legacyFulfillment.enableDelivery),
        ),
        enableStorePickup: firstDefined(
          asBoolean(commerceFulfillment.enableStorePickup),
          asBoolean(legacyFulfillment.enableStorePickup),
        ),
        pickupRestriction: cleanUndefined({
          isActive: firstDefined(
            asBoolean(asRecord(commerceFulfillment.pickupRestriction).isActive),
            asBoolean(asRecord(legacyFulfillment.pickupRestriction).isActive),
          ),
          reason: firstDefined(
            asString(asRecord(commerceFulfillment.pickupRestriction).reason),
            asString(asRecord(legacyFulfillment.pickupRestriction).reason),
          ),
          message: firstDefined(
            asString(asRecord(commerceFulfillment.pickupRestriction).message),
            asString(asRecord(legacyFulfillment.pickupRestriction).message),
          ),
          endTime: firstDefined(
            asNumber(asRecord(commerceFulfillment.pickupRestriction).endTime),
            asNumber(asRecord(legacyFulfillment.pickupRestriction).endTime),
          ),
        }),
        deliveryRestriction: cleanUndefined({
          isActive: firstDefined(
            asBoolean(
              asRecord(commerceFulfillment.deliveryRestriction).isActive,
            ),
            asBoolean(asRecord(legacyFulfillment.deliveryRestriction).isActive),
          ),
          reason: firstDefined(
            asString(asRecord(commerceFulfillment.deliveryRestriction).reason),
            asString(asRecord(legacyFulfillment.deliveryRestriction).reason),
          ),
          message: firstDefined(
            asString(asRecord(commerceFulfillment.deliveryRestriction).message),
            asString(asRecord(legacyFulfillment.deliveryRestriction).message),
          ),
          endTime: firstDefined(
            asNumber(asRecord(commerceFulfillment.deliveryRestriction).endTime),
            asNumber(asRecord(legacyFulfillment.deliveryRestriction).endTime),
          ),
        }),
      }),
      tax: cleanUndefined({
        enabled: firstDefined(asBoolean(commerceTax.enabled), asBoolean(legacyTax.enabled)),
        includedInPrice: firstDefined(
          asBoolean(commerceTax.includedInPrice),
          asBoolean(legacyTax.includedInPrice),
        ),
        name: firstDefined(asString(commerceTax.name), asString(legacyTax.name)),
        rate: firstDefined(asNumber(commerceTax.rate), asNumber(legacyTax.rate)),
      }),
    },
    media: {
      homeHero: {
        displayType:
          firstDefined(
            asString(mediaHomeHero.displayType),
            asString(legacyHomeHero.displayType),
            asString(root.heroDisplayType),
          ) === "image"
            ? "image"
            : "reel",
        headerImage: firstDefined(
          asString(mediaHomeHero.headerImage),
          asString(legacyHomeHero.headerImage),
          asString(root.heroHeaderImage),
        ),
        showOverlay:
          firstDefined(
            asBoolean(mediaHomeHero.showOverlay),
            asBoolean(legacyHomeHero.showOverlay),
            asBoolean(root.heroShowOverlay),
          ) ?? false,
        showText:
          firstDefined(
            asBoolean(mediaHomeHero.showText),
            asBoolean(legacyHomeHero.showText),
            asBoolean(root.heroShowText),
          ) ?? false,
      },
      reels: {
        activeVersion: firstDefined(
          asNumber(mediaReels.activeVersion),
          asNumber(root.activeStreamReel),
        ),
        activeHlsUrl: firstDefined(
          asString(mediaReels.activeHlsUrl),
          asString(root.activeStreamReelHlsUrl),
        ),
        landingPageVersion: firstDefined(
          asString(mediaReels.landingPageVersion),
          asString(root.landingPageReelVersion),
        ),
        versions: firstDefined(
          asOptionalArray(mediaReels.versions, (value) => asString(value)),
          asOptionalArray(root.reelVersions, (value) => asString(value)),
        ) || [],
        streamReels: firstDefined(
          asOptionalArray(mediaReels.streamReels, mapStreamReel),
          asOptionalArray(root.streamReels, mapStreamReel),
        ) || [],
      },
      images: cleanUndefined({
        fallbackImageUrl: firstDefined(
          asString(mediaImages.fallbackImageUrl),
          asString(legacyUi.fallbackImageUrl),
        ),
        shopTheLookImage: firstDefined(
          asString(mediaImages.shopTheLookImage),
          asString(root.shopTheLookImage),
        ),
        showroomImage: firstDefined(
          asString(mediaImages.showroomImage),
          asString(root.showroomImage),
        ),
      }),
    },
    promotions: cleanUndefined({
      leaveAReviewDiscountCodeModalPromoCode: firstDefined(
        mapPromotion(promotions.leaveAReviewDiscountCodeModalPromoCode),
        mapPromotion(root.leaveAReviewDiscountCodeModalPromoCode),
      ),
      homepageDiscountCodeModalPromoCode: firstDefined(
        mapPromotion(promotions.homepageDiscountCodeModalPromoCode),
        mapPromotion(root.homepageDiscountCodeModalPromoCode),
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

export const normalizeStoreConfig = (config: unknown): StoreConfigV2 => {
  return toV2Config(config);
};

const deepMerge = (
  base: Record<string, any>,
  patch: Record<string, any>,
): Record<string, any> => {
  const result: Record<string, any> = { ...base };

  for (const [key, patchValue] of Object.entries(patch)) {
    const baseValue = result[key];

    if (isPlainObject(baseValue) && isPlainObject(patchValue)) {
      result[key] = deepMerge(baseValue, patchValue);
      continue;
    }

    result[key] = patchValue;
  }

  return result;
};

export const patchV2Config = (
  existingConfig: unknown,
  patch: Record<string, any>,
): StoreConfigV2 => {
  const normalized = toV2Config(existingConfig);
  const merged = deepMerge(normalized as Record<string, any>, patch);
  return toV2Config(merged);
};

const assignOrDelete = (
  target: Record<string, any>,
  key: string,
  value: unknown,
) => {
  if (value === undefined || value === null) {
    delete target[key];
    return;
  }

  target[key] = value;
};

export const mirrorLegacyKeys = (
  v2Config: StoreConfigV2,
  existingConfig: unknown,
): Record<string, any> => {
  const existing = asRecord(existingConfig);

  const nextConfig: Record<string, any> = {
    ...existing,
    operations: v2Config.operations,
    commerce: v2Config.commerce,
    media: v2Config.media,
    promotions: v2Config.promotions,
    contact: v2Config.contact,
  };

  nextConfig.availability = v2Config.operations.availability;
  nextConfig.visibility = v2Config.operations.visibility;
  nextConfig.maintenance = v2Config.operations.maintenance;

  nextConfig.deliveryFees = v2Config.commerce.deliveryFees;
  nextConfig.waiveDeliveryFees = v2Config.commerce.waiveDeliveryFees;
  nextConfig.fulfillment = v2Config.commerce.fulfillment;
  nextConfig.tax = v2Config.commerce.tax;

  nextConfig.contactInfo = {
    location: v2Config.contact.location,
    phoneNumber: v2Config.contact.phoneNumber,
  };

  nextConfig.homeHero = v2Config.media.homeHero;
  nextConfig.heroDisplayType = v2Config.media.homeHero.displayType;
  assignOrDelete(nextConfig, "heroHeaderImage", v2Config.media.homeHero.headerImage);
  nextConfig.heroShowOverlay = v2Config.media.homeHero.showOverlay;
  nextConfig.heroShowText = v2Config.media.homeHero.showText;

  assignOrDelete(nextConfig, "activeStreamReel", v2Config.media.reels.activeVersion);
  assignOrDelete(nextConfig, "activeStreamReelHlsUrl", v2Config.media.reels.activeHlsUrl);
  assignOrDelete(
    nextConfig,
    "landingPageReelVersion",
    v2Config.media.reels.landingPageVersion,
  );
  nextConfig.reelVersions = v2Config.media.reels.versions;
  nextConfig.streamReels = v2Config.media.reels.streamReels;

  assignOrDelete(nextConfig, "shopTheLookImage", v2Config.media.images.shopTheLookImage);
  assignOrDelete(nextConfig, "showroomImage", v2Config.media.images.showroomImage);

  const ui = asRecord(existing.ui);
  assignOrDelete(ui, "fallbackImageUrl", v2Config.media.images.fallbackImageUrl);
  if (Object.keys(ui).length > 0) {
    nextConfig.ui = ui;
  } else {
    delete nextConfig.ui;
  }

  assignOrDelete(
    nextConfig,
    "leaveAReviewDiscountCodeModalPromoCode",
    v2Config.promotions.leaveAReviewDiscountCodeModalPromoCode,
  );
  assignOrDelete(
    nextConfig,
    "homepageDiscountCodeModalPromoCode",
    v2Config.promotions.homepageDiscountCodeModalPromoCode,
  );

  return nextConfig;
};

export const getUnknownStoreConfigRootKeys = (config: unknown): string[] => {
  const root = asRecord(config);

  return Object.keys(root).filter((key) => !KNOWN_STORE_CONFIG_ROOT_KEYS.has(key));
};

export const isStoreCheckoutDisabled = (config: unknown): boolean => {
  const normalized = normalizeStoreConfig(config);

  return (
    normalized.operations.availability.inMaintenanceMode ||
    normalized.operations.visibility.inReadOnlyMode
  );
};

export const removeLegacyRootKeysFromConfig = (
  config: unknown,
): Record<string, any> => {
  const root = asRecord(config);
  const next: Record<string, any> = {};

  for (const [key, value] of Object.entries(root)) {
    if (LEGACY_ROOT_KEY_SET.has(key)) {
      continue;
    }

    next[key] = value;
  }

  return next;
};

export const isLegacyRootKey = (key: string): boolean => {
  return LEGACY_ROOT_KEY_SET.has(key);
};

export const isV2RootKey = (key: string): boolean => {
  return V2_ROOT_KEY_SET.has(key);
};

export const STORE_CONFIG_V2_ROOT_KEYS = [...V2_ROOT_KEYS];
export const STORE_CONFIG_LEGACY_ROOT_KEYS = [...LEGACY_ROOT_KEYS];
