import type { StorefrontObservabilityEvent } from "@/lib/storefrontObservability";

type JourneyContext = Record<string, unknown>;

type AuthMode = "login" | "signup";

function compactContext(context: JourneyContext) {
  const compactedEntries = Object.entries(context).filter(
    ([, value]) => value !== undefined && value !== null,
  );

  if (compactedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(compactedEntries);
}

function createJourneyEvent({
  journey,
  step,
  status,
  context,
}: StorefrontObservabilityEvent) {
  return {
    journey,
    step,
    status,
    context: context ? compactContext(context) : undefined,
  } satisfies StorefrontObservabilityEvent;
}

export function createLandingPageViewedEvent() {
  return createJourneyEvent({
    journey: "browse",
    step: "landing_page",
    status: "viewed",
  });
}

export function createCategoryBrowseViewedEvent({
  categorySlug,
  subcategorySlug,
}: {
  categorySlug?: string;
  subcategorySlug?: string;
}) {
  return createJourneyEvent({
    journey: "product_discovery",
    step: "category_browse",
    status: "viewed",
    context: {
      categorySlug,
      subcategorySlug,
    },
  });
}

export function createProductDetailViewedEvent({
  productId,
  productSku,
  categorySlug,
  subcategorySlug,
}: {
  productId: string;
  productSku?: string;
  categorySlug?: string;
  subcategorySlug?: string;
}) {
  return createJourneyEvent({
    journey: "product_discovery",
    step: "product_detail",
    status: "viewed",
    context: {
      productId,
      productSku,
      categorySlug,
      subcategorySlug,
    },
  });
}

export function createBagViewedEvent({
  bagId,
  itemCount,
}: {
  bagId?: string;
  itemCount?: number;
} = {}) {
  return createJourneyEvent({
    journey: "bag",
    step: "bag_view",
    status: "viewed",
    context: {
      bagId,
      itemCount,
    },
  });
}

export function createBagAddSucceededEvent({
  productId,
  productSku,
  quantity,
}: {
  productId?: string;
  productSku?: string;
  quantity?: number;
}) {
  return createJourneyEvent({
    journey: "bag",
    step: "bag_add",
    status: "succeeded",
    context: {
      productId,
      productSku,
      quantity,
    },
  });
}

export function createBagRemoveSucceededEvent({
  productId,
  productSku,
  quantity,
}: {
  productId?: string;
  productSku?: string;
  quantity?: number;
}) {
  return createJourneyEvent({
    journey: "bag",
    step: "bag_remove",
    status: "succeeded",
    context: {
      productId,
      productSku,
      quantity,
    },
  });
}

export function createCheckoutStartEvent({
  bagId,
  itemCount,
  checkoutSessionId,
}: {
  bagId?: string;
  itemCount?: number;
  checkoutSessionId?: string;
} = {}) {
  return createJourneyEvent({
    journey: "bag",
    step: "checkout_start",
    status: "started",
    context: {
      bagId,
      itemCount,
      checkoutSessionId,
    },
  });
}

export function createCheckoutDetailsViewedEvent({
  checkoutSessionId,
}: {
  checkoutSessionId?: string;
} = {}) {
  return createJourneyEvent({
    journey: "checkout",
    step: "checkout_details",
    status: "viewed",
    context: {
      checkoutSessionId,
    },
  });
}

export function createOrderReviewViewedEvent({
  checkoutSessionId,
}: {
  checkoutSessionId: string;
}) {
  return createJourneyEvent({
    journey: "checkout",
    step: "order_review",
    status: "viewed",
    context: {
      checkoutSessionId,
    },
  });
}

export function createPaymentSubmissionStartedEvent({
  checkoutSessionId,
  paymentMethod,
  podPaymentMethod,
}: {
  checkoutSessionId: string;
  paymentMethod?: string | null;
  podPaymentMethod?: string | null;
}) {
  return createJourneyEvent({
    journey: "checkout",
    step: "payment_submission",
    status: "started",
    context: {
      checkoutSessionId,
      paymentMethod,
      podPaymentMethod,
    },
  });
}

export function createPaymentVerificationStartedEvent({
  checkoutSessionId,
  externalReference,
}: {
  checkoutSessionId?: string;
  externalReference?: string | null;
} = {}) {
  return createJourneyEvent({
    journey: "checkout",
    step: "payment_verification",
    status: "started",
    context: {
      checkoutSessionId,
      externalReference,
    },
  });
}

function createCheckoutCompletionEvent({
  status,
  checkoutSessionId,
  orderId,
  deliveryMethod,
}: {
  status: "succeeded" | "blocked" | "canceled";
  checkoutSessionId?: string;
  orderId?: string;
  deliveryMethod?: string;
}) {
  return createJourneyEvent({
    journey: "checkout",
    step: "checkout_completion",
    status,
    context: {
      checkoutSessionId,
      orderId,
      deliveryMethod,
    },
  });
}

export function createCheckoutCompletionSucceededEvent({
  checkoutSessionId,
  orderId,
  deliveryMethod,
}: {
  checkoutSessionId?: string;
  orderId?: string;
  deliveryMethod?: string;
}) {
  return createCheckoutCompletionEvent({
    status: "succeeded",
    checkoutSessionId,
    orderId,
    deliveryMethod,
  });
}

export function createCheckoutCompletionBlockedEvent({
  checkoutSessionId,
  orderId,
  deliveryMethod,
}: {
  checkoutSessionId?: string;
  orderId?: string;
  deliveryMethod?: string;
}) {
  return createCheckoutCompletionEvent({
    status: "blocked",
    checkoutSessionId,
    orderId,
    deliveryMethod,
  });
}

export function createCheckoutCompletionCanceledEvent({
  checkoutSessionId,
  orderId,
  deliveryMethod,
}: {
  checkoutSessionId?: string;
  orderId?: string;
  deliveryMethod?: string;
}) {
  return createCheckoutCompletionEvent({
    status: "canceled",
    checkoutSessionId,
    orderId,
    deliveryMethod,
  });
}

function getAuthEntryStep(mode: AuthMode) {
  return mode === "login" ? "login_entry" : "signup_entry";
}

function getAuthRequestStep(mode: AuthMode) {
  return mode === "login" ? "login_request" : "signup_request";
}

export function createAuthEntryViewedEvent({
  mode,
  origin,
  email,
}: {
  mode: AuthMode;
  origin?: string;
  email?: string;
}) {
  return createJourneyEvent({
    journey: "auth",
    step: getAuthEntryStep(mode),
    status: "viewed",
    context: {
      entryOrigin: origin,
      email,
    },
  });
}

export function createAuthRequestStartedEvent({
  mode,
  origin,
  email,
}: {
  mode: AuthMode;
  origin?: string;
  email?: string;
}) {
  return createJourneyEvent({
    journey: "auth",
    step: getAuthRequestStep(mode),
    status: "started",
    context: {
      entryOrigin: origin,
      email,
    },
  });
}

export function createAuthVerificationViewedEvent({
  email,
}: {
  email?: string;
} = {}) {
  return createJourneyEvent({
    journey: "auth",
    step: "auth_verification",
    status: "viewed",
    context: {
      email,
    },
  });
}

export function createAuthVerificationSucceededEvent({
  email,
}: {
  email?: string;
} = {}) {
  return createJourneyEvent({
    journey: "auth",
    step: "auth_verification",
    status: "succeeded",
    context: {
      email,
    },
  });
}

// --- Auxiliary engagement events (V26-184) ---

export function createRewardsAlertViewedEvent() {
  return createJourneyEvent({
    journey: "browse",
    step: "rewards_alert",
    status: "viewed",
  });
}

export function createRewardsAlertDismissedEvent() {
  return createJourneyEvent({
    journey: "browse",
    step: "rewards_alert",
    status: "canceled",
  });
}

export function createRewardsAlertShopNowEvent() {
  return createJourneyEvent({
    journey: "browse",
    step: "rewards_alert",
    status: "succeeded",
  });
}

export function createPromoAlertViewedEvent({
  promoCodeItemId,
  productSku,
  productImageUrl,
  productId,
}: {
  promoCodeItemId?: string;
  productSku?: string;
  productImageUrl?: string;
  productId?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "promo_alert",
    status: "viewed",
    context: {
      promoCodeItemId,
      productSku,
      productImageUrl,
      productId,
    },
  });
}

export function createPromoAlertDismissedEvent({
  promoCodeItemId,
  productSku,
  productImageUrl,
  productId,
}: {
  promoCodeItemId?: string;
  productSku?: string;
  productImageUrl?: string;
  productId?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "promo_alert",
    status: "canceled",
    context: {
      promoCodeItemId,
      productSku,
      productImageUrl,
      productId,
    },
  });
}

export function createPromoAlertShopNowEvent({
  promoCodeItemId,
  productSkuId,
  quantity,
  quantityClaimed,
}: {
  promoCodeItemId?: string;
  productSkuId?: string;
  quantity?: number;
  quantityClaimed?: number;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "promo_alert",
    status: "succeeded",
    context: {
      promoCodeItemId,
      productSkuId,
      quantity,
      quantityClaimed,
    },
  });
}

export function createWelcomeBackModalViewedEvent({
  isNextOrder,
  promoCodeId,
}: {
  isNextOrder?: boolean;
  promoCodeId?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "welcome_back_modal",
    status: "viewed",
    context: {
      isNextOrder,
      promoCodeId,
    },
  });
}

export function createWelcomeBackModalDismissedEvent({
  isNextOrder,
  promoCodeId,
}: {
  isNextOrder?: boolean;
  promoCodeId?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "welcome_back_modal",
    status: "canceled",
    context: {
      isNextOrder,
      promoCodeId,
    },
  });
}

export function createWelcomeBackModalSubmittedEvent({
  isNextOrder,
  promoCodeId,
}: {
  isNextOrder?: boolean;
  promoCodeId?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "welcome_back_modal",
    status: "succeeded",
    context: {
      isNextOrder,
      promoCodeId,
    },
  });
}

export function createLeaveReviewModalViewedEvent({
  incentiveType,
  promoCodeId,
}: {
  incentiveType?: string;
  promoCodeId?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "leave_review_modal",
    status: "viewed",
    context: {
      incentiveType,
      promoCodeId,
    },
  });
}

export function createLeaveReviewModalDismissedEvent({
  incentiveType,
  promoCodeId,
}: {
  incentiveType?: string;
  promoCodeId?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "leave_review_modal",
    status: "canceled",
    context: {
      incentiveType,
      promoCodeId,
    },
  });
}

export function createUpsellModalViewedEvent({
  isNextOrder,
  promoCodeId,
  productId,
  productSku,
  productImageUrl,
}: {
  isNextOrder?: boolean;
  promoCodeId?: string;
  productId?: string;
  productSku?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "upsell_modal",
    status: "viewed",
    context: {
      isNextOrder,
      promoCodeId,
      productId,
      productSku,
      productImageUrl,
    },
  });
}

export function createUpsellModalDismissedEvent({
  isNextOrder,
  promoCodeId,
  productId,
  productSku,
  productImageUrl,
}: {
  isNextOrder?: boolean;
  promoCodeId?: string;
  productId?: string;
  productSku?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "upsell_modal",
    status: "canceled",
    context: {
      isNextOrder,
      promoCodeId,
      productId,
      productSku,
      productImageUrl,
    },
  });
}

export function createUpsellModalSubmittedEvent({
  isNextOrder,
  promoCodeId,
  productId,
  productSku,
  productImageUrl,
}: {
  isNextOrder?: boolean;
  promoCodeId?: string;
  productId?: string;
  productSku?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "browse",
    step: "upsell_modal",
    status: "succeeded",
    context: {
      isNextOrder,
      promoCodeId,
      productId,
      productSku,
      productImageUrl,
    },
  });
}

export function createUpsellModalAddToBagEvent({
  productId,
  productSku,
  productImageUrl,
}: {
  productId?: string;
  productSku?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "bag",
    step: "bag_add",
    status: "succeeded",
    context: {
      productId,
      productSku,
      productImageUrl,
      entryOrigin: "homepage_upsell_modal",
    },
  });
}

export function createSavedBagViewedEvent() {
  return createJourneyEvent({
    journey: "bag",
    step: "saved_bag_view",
    status: "viewed",
  });
}

export function createSavedBagMoveToBagEvent({
  productId,
  productSku,
  productImageUrl,
}: {
  productId?: string;
  productSku?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "bag",
    step: "saved_bag_move_to_bag",
    status: "succeeded",
    context: {
      productId,
      productSku,
      productImageUrl,
    },
  });
}

export function createSavedBagRemoveEvent({
  productId,
  productSku,
  productImageUrl,
}: {
  productId?: string;
  productSku?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "bag",
    step: "saved_bag_remove",
    status: "succeeded",
    context: {
      productId,
      productSku,
      productImageUrl,
    },
  });
}

export function createBagMoveToSavedEvent({
  productId,
  productSku,
  productImageUrl,
}: {
  productId?: string;
  productSku?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "bag",
    step: "bag_move_to_saved",
    status: "succeeded",
    context: {
      productId,
      productSku,
      productImageUrl,
    },
  });
}

export function createDiscountCodeTriggerEvent({
  promoCodeId,
}: {
  promoCodeId?: string;
}) {
  return createJourneyEvent({
    journey: "bag",
    step: "discount_code_trigger",
    status: "started",
    context: {
      promoCodeId,
    },
  });
}

export function createReviewEditorViewedEvent({
  orderId,
  orderItemId,
  productId,
  productImageUrl,
}: {
  orderId?: string;
  orderItemId?: string;
  productId?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "product_discovery",
    step: "review_editor",
    status: "viewed",
    context: {
      orderId,
      orderItemId,
      productId,
      productImageUrl,
    },
  });
}

export function createReviewSubmittedEvent({
  orderId,
  orderItemId,
  productId,
  productSkuId,
  productImageUrl,
}: {
  orderId?: string;
  orderItemId?: string;
  productId?: string;
  productSkuId?: string;
  productImageUrl?: string;
}) {
  return createJourneyEvent({
    journey: "product_discovery",
    step: "review_submission",
    status: "succeeded",
    context: {
      orderId,
      orderItemId,
      productId,
      productSkuId,
      productImageUrl,
    },
  });
}
