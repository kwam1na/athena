type StorefrontBehaviorMode =
  | "backend-first-load"
  | "checkout-bootstrap"
  | "validation-blocker"
  | "verification-recovery";

const API_PORT = Number.parseInt(process.env.HARNESS_STOREFRONT_API_PORT ?? "4312", 10);
const mode = process.env.HARNESS_STOREFRONT_BEHAVIOR_MODE;

const SUPPORTED_MODES = new Set<StorefrontBehaviorMode>([
  "backend-first-load",
  "checkout-bootstrap",
  "validation-blocker",
  "verification-recovery",
]);

if (!mode || !SUPPORTED_MODES.has(mode as StorefrontBehaviorMode)) {
  throw new Error(
    `Unsupported HARNESS_STOREFRONT_BEHAVIOR_MODE "${mode ?? "<missing>"}". Expected one of ${[
      ...SUPPORTED_MODES,
    ].join(", ")}.`
  );
}

const behaviorMode = mode as StorefrontBehaviorMode;

const STOREFRONT_ORGANIZATION_ID = "org_harness";
const STOREFRONT_STORE_ID = "store_harness";

const BOOTSTRAP_SESSION_ID = "checkout_session_bootstrap";
const RECOVERY_SESSION_ID = "checkout_session_recovery";
const RECOVERY_ORDER_ID = "order_checkout_recovery";
const RECOVERY_REFERENCE = "paystack_recovery_reference";

const now = Date.now();

const sharedStore = {
  _id: STOREFRONT_STORE_ID,
  name: "Harness Storefront",
  organizationId: STOREFRONT_ORGANIZATION_ID,
  currency: "usd",
  config: {
    operations: {
      availability: {
        inMaintenanceMode: false,
      },
      visibility: {
        inReadOnlyMode: false,
      },
    },
    commerce: {
      deliveryFees: {
        withinAccra: 0,
        otherRegions: 0,
        international: 0,
      },
      waiveDeliveryFees: {
        all: true,
      },
      fulfillment: {
        enableStorePickup: true,
        enableDelivery: true,
      },
    },
  },
};

const sharedBag = {
  _id: "bag_harness",
  storeId: STOREFRONT_STORE_ID,
  organizationId: STOREFRONT_ORGANIZATION_ID,
  items: [
    {
      _id: "bag_item_harness",
      productSkuId: "sku_harness",
      productName: "Harness Wig",
      productImage: "",
      quantity: 1,
      price: 12000,
    },
  ],
};

const emptySavedBag = {
  _id: "saved_bag_harness",
  storeId: STOREFRONT_STORE_ID,
  organizationId: STOREFRONT_ORGANIZATION_ID,
  items: [],
};

const checkoutItem = {
  _id: "sku_harness",
  sku: "SKU-HARNESS-1",
  productName: "Harness Wig",
  productCategory: "wigs",
  price: 12000,
  images: [""],
  colorName: "Natural Black",
  size: "M",
  length: 16,
};

const bestSeller = {
  _id: "best_seller_harness",
  rank: 1,
  productSku: checkoutItem,
};

const featuredItem = {
  _id: "featured_harness",
  rank: 1,
  type: "regular",
  productSku: checkoutItem,
};

const bootstrapSession = {
  _id: BOOTSTRAP_SESSION_ID,
  amount: 12000,
  deliveryFee: 0,
  deliveryMethod: "pickup",
  paymentMethod: null,
  customerDetails: {
    firstName: "Ada",
    lastName: "Harness",
    email: "ada@example.com",
    phoneNumber: "+15555550123",
  },
  deliveryDetails: null,
  discount: null,
  items: [checkoutItem],
  externalReference: null,
  hasCompletedPayment: false,
  hasVerifiedPayment: false,
  hasCompletedCheckoutSession: false,
  placedOrderId: null,
  isPaymentRefunded: false,
};

const recoverySession = {
  _id: RECOVERY_SESSION_ID,
  amount: 18000,
  deliveryFee: 0,
  deliveryMethod: "pickup",
  paymentMethod: {
    channel: "card",
    bank: "Visa",
    last4: "4242",
  },
  customerDetails: {
    firstName: "Ada",
    lastName: "Harness",
    email: "ada@example.com",
    phoneNumber: "+15555550123",
  },
  deliveryDetails: null,
  discount: null,
  items: [checkoutItem],
  externalReference: RECOVERY_REFERENCE,
  hasCompletedPayment: true,
  hasVerifiedPayment: true,
  hasCompletedCheckoutSession: false,
  placedOrderId: RECOVERY_ORDER_ID,
  isPaymentRefunded: false,
};

const recoveryOrder = {
  _id: RECOVERY_ORDER_ID,
  _creationTime: now,
  checkoutSessionId: RECOVERY_SESSION_ID,
  orderNumber: "WC-1001",
  amount: recoverySession.amount,
  deliveryFee: recoverySession.deliveryFee,
  deliveryMethod: recoverySession.deliveryMethod,
  externalReference: RECOVERY_REFERENCE,
  discount: null,
  items: [
    {
      productSkuId: checkoutItem._id,
      productName: checkoutItem.productName,
      quantity: 1,
      price: recoverySession.amount,
    },
  ],
};

function withCorsHeaders(
  request: Request,
  headers: Record<string, string> = {}
): Record<string, string> {
  const origin = request.headers.get("origin");

  return {
    ...headers,
    "access-control-allow-origin": origin ?? "http://127.0.0.1",
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
    "access-control-allow-headers": "Content-Type,Authorization",
  };
}

function jsonResponse(request: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCorsHeaders(request, {
      "content-type": "application/json; charset=utf-8",
    }),
  });
}

function emitSignal(signalName: string) {
  console.log(`RUNTIME_SIGNAL:${signalName}`);
}

function handleCheckoutSessionFetch(request: Request, pathname: string) {
  const sessionId = decodeURIComponent(pathname.slice("/checkout/".length));

  if (sessionId === BOOTSTRAP_SESSION_ID) {
    return jsonResponse(request, bootstrapSession);
  }

  if (sessionId === RECOVERY_SESSION_ID) {
    return jsonResponse(request, recoverySession);
  }

  emitSignal("storefront-checkout-session-missing");
  return jsonResponse(
    request,
    {
      error: "Checkout session not found",
      code: "CHECKOUT_SESSION_NOT_FOUND",
    },
    404
  );
}

async function handleCheckoutSessionUpdate(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as {
    action?: string;
  };

  if (payload.action === "complete-checkout") {
    emitSignal("storefront-checkout-completion-requested");
    return jsonResponse(request, {
      success: true,
      orderId: RECOVERY_ORDER_ID,
    });
  }

  return jsonResponse(request, {
    success: true,
  });
}

const server = Bun.serve({
  port: API_PORT,
  async fetch(request) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: withCorsHeaders(request),
      });
    }

    if (pathname === "/health") {
      return jsonResponse(request, {
        ok: true,
        mode: behaviorMode,
      });
    }

    if (pathname === "/storefront") {
      if (behaviorMode === "backend-first-load") {
        emitSignal("storefront-backend-first-load");
      }

      return jsonResponse(request, sharedStore);
    }

    if (pathname === "/users/me") {
      return jsonResponse(request, {});
    }

    if (pathname === "/guests") {
      return jsonResponse(request, {
        _id: "guest_harness",
        organizationId: STOREFRONT_ORGANIZATION_ID,
        storeId: STOREFRONT_STORE_ID,
      });
    }

    if (pathname === "/categories") {
      return jsonResponse(request, {
        categories: [],
      });
    }

    if (pathname === "/subcategories") {
      return jsonResponse(request, {
        subcategories: [],
      });
    }

    if (pathname === "/stores/promoCodes") {
      return jsonResponse(request, []);
    }

    if (pathname === "/stores/promoCodeItems") {
      return jsonResponse(request, []);
    }

    if (pathname === "/stores/redeemedPromoCodes") {
      return jsonResponse(request, []);
    }

    if (pathname === "/banner-message") {
      return jsonResponse(request, {
        bannerMessage: null,
      });
    }

    if (pathname === "/bestSellers") {
      return jsonResponse(request, [bestSeller]);
    }

    if (pathname === "/featured") {
      return jsonResponse(request, [featuredItem]);
    }

    if (pathname === "/bags/active") {
      return jsonResponse(request, sharedBag);
    }

    if (pathname === "/savedBags/active") {
      return jsonResponse(request, emptySavedBag);
    }

    if (pathname === "/orders" && request.method === "GET") {
      return jsonResponse(request, [recoveryOrder]);
    }

    if (pathname.startsWith("/orders/") && request.method === "GET") {
      const orderId = decodeURIComponent(pathname.slice("/orders/".length));
      return jsonResponse(request, {
        ...recoveryOrder,
        _id: orderId || RECOVERY_ORDER_ID,
      });
    }

    if (pathname === "/checkout/active" && request.method === "GET") {
      if (behaviorMode === "checkout-bootstrap") {
        emitSignal("storefront-checkout-bootstrap-loaded");
        return jsonResponse(request, bootstrapSession);
      }

      if (behaviorMode === "verification-recovery") {
        return jsonResponse(request, recoverySession);
      }

      return jsonResponse(request, null);
    }

    if (pathname.startsWith("/checkout/verify/") && request.method === "GET") {
      const reference = decodeURIComponent(pathname.slice("/checkout/verify/".length));
      emitSignal("storefront-payment-verification-requested");
      return jsonResponse(request, {
        verified: reference === RECOVERY_REFERENCE,
      });
    }

    if (pathname.startsWith("/checkout/") && request.method === "GET") {
      return handleCheckoutSessionFetch(request, pathname);
    }

    if (pathname.startsWith("/checkout/") && request.method === "POST") {
      return handleCheckoutSessionUpdate(request);
    }

    if (pathname === "/analytics" && request.method === "POST") {
      const payload = (await request.json().catch(() => ({}))) as {
        data?: {
          step?: string;
          status?: string;
        };
      };

      if (payload.data?.step === "checkout_details") {
        emitSignal("storefront-checkout-details-tracked");
      }

      if (payload.data?.step === "payment_verification") {
        emitSignal("storefront-payment-verification-tracked");
      }

      if (
        payload.data?.step === "checkout_completion" &&
        payload.data?.status === "succeeded"
      ) {
        emitSignal("storefront-checkout-completion-tracked");
      }

      return jsonResponse(request, {
        success: true,
      });
    }

    return jsonResponse(
      request,
      {
        error: `Unhandled fixture route: ${pathname}`,
      },
      404
    );
  },
});

console.log(`STOREFRONT_RUNTIME_API_READY:${API_PORT}`);

async function shutdown() {
  server.stop(true);
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
