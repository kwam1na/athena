import { SignJWT } from "jose";
import { optionalNumberEnv, requireEnv } from "./env";

type BootstrapCheckoutResponse = {
  actor: {
    actorId: string;
    actorType: "guest";
    organizationId: string;
    storeId: string;
  };
  actorToken: string;
  bagId: string;
  checkoutPath: string;
  checkoutSessionId: string;
  marker: string;
};

const encoder = new TextEncoder();

function createMarker() {
  return `playwright-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

async function createBootstrapToken() {
  const organizationId = requireEnv("PLAYWRIGHT_ORGANIZATION_ID");
  const storeId = requireEnv("PLAYWRIGHT_STORE_ID");
  const signingKey = requireEnv("PLAYWRIGHT_STOREFRONT_ACTOR_SIGNING_KEY");

  const token = await new SignJWT({
    actorType: "system",
    organizationId,
    storeId,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("playwright-e2e")
    .setIssuedAt()
    .sign(encoder.encode(signingKey));

  return {
    organizationId,
    storeId,
    token,
  };
}

export async function bootstrapCheckout(): Promise<BootstrapCheckoutResponse> {
  const apiURL = requireEnv("PLAYWRIGHT_API_URL");
  const productSlug = requireEnv("PLAYWRIGHT_CHECKOUT_PRODUCT_SLUG");
  const productSku = process.env.PLAYWRIGHT_CHECKOUT_PRODUCT_SKU;
  const quantity = optionalNumberEnv("PLAYWRIGHT_CHECKOUT_QUANTITY", 1);
  const { organizationId, storeId, token } = await createBootstrapToken();

  const response = await fetch(
    `${apiURL}/organizations/${organizationId}/stores/${storeId}/e2e/checkout/bootstrap`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-athena-actor-token": token,
      },
      body: JSON.stringify({
        marker: createMarker(),
        items: [
          {
            productSlug,
            quantity,
            ...(productSku ? { sku: productSku } : {}),
          },
        ],
      }),
    }
  );

  const data = (await response.json()) as
    | BootstrapCheckoutResponse
    | { error?: string };

  if (!response.ok) {
    throw new Error(
      `Failed to bootstrap checkout: ${"error" in data ? data.error : response.statusText}`
    );
  }

  return data as BootstrapCheckoutResponse;
}
