import {
  buildContextEventEnvelope,
  defineSurfaceContext,
  type ContextEventInput,
} from "@athena/webapp/shared/intelligence";

export const storefrontContextSurface = defineSurfaceContext({
  surface: "storefront",
  schemaVersion: 1,
  events: [
    {
      eventId: "storefront.route_viewed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
      requiredPayloadKeys: ["route"],
    },
    {
      eventId: "storefront.product_viewed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
      primarySubjectType: "product",
      requiredPayloadKeys: ["productId"],
    },
    {
      eventId: "storefront.cart_changed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
    },
    {
      eventId: "storefront.checkout_state_changed",
      schemaVersion: 1,
      visibilityMode: "store_admin",
      retentionClass: "standard",
    },
  ],
});

export function buildStorefrontContextEvent(input: ContextEventInput) {
  return buildContextEventEnvelope(storefrontContextSurface, input);
}
