import { describe, expect, it } from "vitest";
import { resolveMtnCollectionsConfigFromEnv } from "./config";

describe("resolveMtnCollectionsConfigFromEnv", () => {
  it("returns an explicit not-configured result when store credentials are missing", () => {
    const result = resolveMtnCollectionsConfigFromEnv(
      {
        storeId: "store_123",
        storeSlug: "wig-club",
      },
      {},
    );

    expect(result).toEqual({
      kind: "not_configured",
      lookupPrefixes: [
        "MTN_MOMO_COLLECTIONS_WIG_CLUB",
        "MTN_MOMO_COLLECTIONS_STORE_123",
      ],
      missing: [
        "MTN_MOMO_COLLECTIONS_WIG_CLUB_SUBSCRIPTION_KEY",
        "MTN_MOMO_COLLECTIONS_WIG_CLUB_API_USER",
        "MTN_MOMO_COLLECTIONS_WIG_CLUB_API_KEY",
        "MTN_MOMO_COLLECTIONS_WIG_CLUB_TARGET_ENVIRONMENT",
        "MTN_MOMO_COLLECTIONS_WIG_CLUB_CALLBACK_HOST",
      ],
    });
  });

  it("resolves store-scoped credentials and callback configuration from env", () => {
    const result = resolveMtnCollectionsConfigFromEnv(
      {
        storeId: "store_123",
        storeSlug: "wig-club",
      },
      {
        MTN_MOMO_COLLECTIONS_WIG_CLUB_SUBSCRIPTION_KEY:
          "test-subscription-key",
        MTN_MOMO_COLLECTIONS_WIG_CLUB_API_USER: "test-user",
        MTN_MOMO_COLLECTIONS_WIG_CLUB_API_KEY: "test-password",
        MTN_MOMO_COLLECTIONS_WIG_CLUB_TARGET_ENVIRONMENT: "sandbox",
        MTN_MOMO_COLLECTIONS_WIG_CLUB_CALLBACK_HOST:
          "https://athena.example.com",
        MTN_MOMO_COLLECTIONS_WIG_CLUB_CALLBACK_PATH:
          "/webhooks/mtn-momo/collections",
      },
    );

    expect(result).toEqual({
      kind: "configured",
      config: {
        subscriptionKey: "test-subscription-key",
        apiUser: "test-user",
        apiKey: "test-password",
        targetEnvironment: "sandbox",
        baseUrl: "https://sandbox.momodeveloper.mtn.com",
        callbackHost: "https://athena.example.com",
        callbackPath: "/webhooks/mtn-momo/collections",
      },
      lookupPrefixes: [
        "MTN_MOMO_COLLECTIONS_WIG_CLUB",
        "MTN_MOMO_COLLECTIONS_STORE_123",
      ],
    });
  });
});
