/**
 * Store configuration contracts.
 *
 * These are purely structural: they carry no dependency on the generated Convex
 * data model, so any consumer (admin, storefront, scripts, tests) can read them
 * without compiling through an application root.
 */

export type StoreRestrictionConfig = {
  isActive?: boolean;
  reason?: string;
  message?: string;
  endTime?: number;
};

export type StoreFulfillmentConfig = {
  disableDelivery?: boolean;
  disableStorePickup?: boolean;
  enableDelivery?: boolean;
  enableStorePickup?: boolean;
  pickupRestriction?: StoreRestrictionConfig;
  deliveryRestriction?: StoreRestrictionConfig;
};

export type StoreDeliveryFeesConfig = {
  international?: number;
  otherRegions?: number;
  withinAccra?: number;
};

export type StoreWaiveDeliveryFeesConfig =
  | boolean
  | {
    all?: boolean;
    international?: boolean;
    otherRegions?: boolean;
    withinAccra?: boolean;
    minimumOrderAmount?: number;
  };

export type StoreTaxConfig = {
  enabled?: boolean;
  includedInPrice?: boolean;
  name?: string;
  rate?: number;
};

export type StoreOperationsConfig = {
  availability: {
    inMaintenanceMode: boolean;
  };
  visibility: {
    inReadOnlyMode: boolean;
  };
  maintenance: {
    countdownEndsAt?: number;
    heading?: string;
    message?: string;
  };
};

export type StoreCommerceConfig = {
  deliveryFees: StoreDeliveryFeesConfig;
  waiveDeliveryFees: StoreWaiveDeliveryFeesConfig;
  fulfillment: StoreFulfillmentConfig;
  tax: StoreTaxConfig;
};

export type StoreHeroDisplayType = "reel" | "image";

export type StoreHomeHeroConfig = {
  displayType: StoreHeroDisplayType;
  headerImage?: string;
  showOverlay: boolean;
  showText: boolean;
};

export type StoreStreamReelConfig = {
  version: number;
  source?: string;
  streamUid?: string;
  hlsUrl?: string;
  thumbnailUrl?: string;
  createdAt?: number;
};

export type StoreMediaConfig = {
  homeHero: StoreHomeHeroConfig;
  reels: {
    activeVersion?: number;
    activeHlsUrl?: string;
    landingPageVersion?: string;
    versions: string[];
    streamReels: StoreStreamReelConfig[];
  };
  images: {
    fallbackImageUrl?: string;
    shopTheLookImage?: string;
    showroomImage?: string;
  };
};

export type StorePromotionConfig = {
  discountType?: string;
  displayText?: string;
  promoCodeId?: string;
  value?: number;
  [key: string]: unknown;
};

export type StorePromotionsConfig = {
  leaveAReviewDiscountCodeModalPromoCode?: StorePromotionConfig;
  homepageDiscountCodeModalPromoCode?: StorePromotionConfig;
};

export type StoreContactConfig = {
  email?: string;
  location?: string;
  phoneNumber?: string;
  website?: string;
};

export type StoreReceiptConfig = {
  policyLines?: string[];
};

export const STORE_MTN_MOMO_SETUP_STATUSES = [
  "not_configured",
  "submitted",
  "under_review",
  "connected",
  "needs_attention",
] as const;

export type StoreMtnMomoSetupStatus =
  (typeof STORE_MTN_MOMO_SETUP_STATUSES)[number];

export type StoreMtnMomoReceivingAccount = {
  label?: string;
  walletNumber?: string;
  businessName?: string;
  market?: string;
  businessContact?: string;
  isPrimary?: boolean;
  status: StoreMtnMomoSetupStatus;
  statusNote?: string;
};

export type StorePaymentsConfig = {
  mtnMomo: {
    receivingAccounts: StoreMtnMomoReceivingAccount[];
  };
};

export type StoreConfigV2 = {
  operations: StoreOperationsConfig;
  commerce: StoreCommerceConfig;
  media: StoreMediaConfig;
  promotions: StorePromotionsConfig;
  contact: StoreContactConfig;
  receipt: StoreReceiptConfig;
  payments: StorePaymentsConfig;
};
