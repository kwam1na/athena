// @vitest-environment node

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { meRoutes } from "./me";
import { offersRoutes } from "./offers";
import { onlineOrderRoutes } from "./onlineOrder";
import { upsellRoutes } from "./upsells";
import { userOffersRoutes } from "./userOffers";

function cookieHeader(values: Record<string, string>) {
  return Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");
}

describe("meRoutes", () => {
  const app = new Hono().route("/me", meRoutes);

  it("returns null when no authenticated user is present", async () => {
    const response = await app.request(
      "http://localhost/me",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("gets and updates user profile from cookie user id", async () => {
    const runQuery = vi.fn().mockResolvedValue({ _id: "user_1", firstName: "Ada" });
    const runMutation = vi.fn().mockResolvedValue({ _id: "user_1", lastName: "Lovelace" });
    const headers = { Cookie: cookieHeader({ user_id: "user_1" }) };

    const getResponse = await app.request(
      "http://localhost/me",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );

    const putResponse = await app.request(
      "http://localhost/me",
      {
        method: "PUT",
        headers,
        body: JSON.stringify({
          email: "ada@example.com",
          firstName: "Ada",
          lastName: "Lovelace",
          phoneNumber: "5555551234",
          shippingAddress: { city: "Austin" },
          billingAddress: { city: "Austin" },
        }),
      },
      { runMutation, runQuery } as never
    );

    expect(getResponse.status).toBe(200);
    expect(putResponse.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({ id: "user_1" });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      billingAddress: { city: "Austin" },
      email: "ada@example.com",
      firstName: "Ada",
      id: "user_1",
      lastName: "Lovelace",
      phoneNumber: "5555551234",
      shippingAddress: { city: "Austin" },
    });
  });

  it("returns 404 on update when user id is missing", async () => {
    const response = await app.request(
      "http://localhost/me",
      { method: "PUT", body: JSON.stringify({ firstName: "Ada" }) },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "User id missing" });
  });
});

describe("offersRoutes", () => {
  const app = new Hono().route("/offers", offersRoutes);

  it("validates required fields and email format", async () => {
    const missingGuest = await app.request(
      "http://localhost/offers",
      { method: "POST", body: JSON.stringify({ email: "a@b.com", promoCodeId: "promo_1" }) },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    const invalidEmail = await app.request(
      "http://localhost/offers",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1", store_id: "store_1" }) },
        body: JSON.stringify({ email: "bad-email", promoCodeId: "promo_1" }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(missingGuest.status).toBe(400);
    expect(await missingGuest.json()).toEqual({ error: "Guest ID is required" });
    expect(invalidEmail.status).toBe(400);
    expect(await invalidEmail.json()).toEqual({ error: "Invalid email address" });

    const missingStore = await app.request(
      "http://localhost/offers",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) },
        body: JSON.stringify({ email: "a@b.com", promoCodeId: "promo_1" }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(missingStore.status).toBe(400);
    expect(await missingStore.json()).toEqual({ error: "Store ID is required" });

    const missingFields = await app.request(
      "http://localhost/offers",
      {
        method: "POST",
        headers: { Cookie: cookieHeader({ guest_id: "guest_1", store_id: "store_1" }) },
        body: JSON.stringify({ email: "ada@example.com" }),
      },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(missingFields.status).toBe(400);
    expect(await missingFields.json()).toEqual({
      error: "Email and promo code ID are required",
    });

    const getMissingGuest = await app.request(
      "http://localhost/offers",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );
    expect(getMissingGuest.status).toBe(400);
    expect(await getMissingGuest.json()).toEqual({ error: "Guest ID is required" });
  });

  it("creates and fetches offers for the storefront user", async () => {
    const runMutation = vi.fn().mockResolvedValue({ success: true, id: "offer_1" });
    const runQuery = vi.fn().mockResolvedValue([{ _id: "offer_1" }]);
    const headers = {
      Cookie: cookieHeader({ guest_id: "guest_1", store_id: "store_1" }),
      "x-forwarded-for": "203.0.113.4",
    };

    const postResponse = await app.request(
      "http://localhost/offers",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "ada@example.com", promoCodeId: "promo_1" }),
      },
      { runMutation, runQuery } as never
    );

    const getResponse = await app.request(
      "http://localhost/offers",
      { method: "GET", headers: { Cookie: headers.Cookie } },
      { runMutation, runQuery } as never
    );

    expect(postResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      email: "ada@example.com",
      ipAddress: "203.0.113.4",
      promoCodeId: "promo_1",
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
    expect(runQuery.mock.calls[0]?.[1]).toEqual({ storeFrontUserId: "guest_1" });
  });

  it("returns business and internal errors for offer operations", async () => {
    const headers = {
      Cookie: cookieHeader({ guest_id: "guest_1", store_id: "store_1" }),
    };
    const businessResponse = await app.request(
      "http://localhost/offers",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "ada@example.com", promoCodeId: "promo_1" }),
      },
      {
        runMutation: vi.fn().mockResolvedValue({
          success: false,
          message: "Rate limited",
        }),
        runQuery: vi.fn(),
      } as never
    );
    expect(businessResponse.status).toBe(400);
    expect(await businessResponse.json()).toEqual({ error: "Rate limited" });

    const createError = await app.request(
      "http://localhost/offers",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ email: "ada@example.com", promoCodeId: "promo_1" }),
      },
      {
        runMutation: vi.fn().mockRejectedValue(new Error("db down")),
        runQuery: vi.fn(),
      } as never
    );
    expect(createError.status).toBe(500);
    expect(await createError.json()).toEqual({ error: "Failed to create offer" });

    const getError = await app.request(
      "http://localhost/offers",
      { method: "GET", headers },
      {
        runMutation: vi.fn(),
        runQuery: vi.fn().mockRejectedValue(new Error("query down")),
      } as never
    );
    expect(getError.status).toBe(500);
    expect(await getError.json()).toEqual({ error: "Failed to get offers" });
  });
});

describe("onlineOrderRoutes", () => {
  const app = new Hono().route("/orders", onlineOrderRoutes);

  it("returns 404 when current user is missing", async () => {
    const response = await app.request(
      "http://localhost/orders",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "User id missing" });
  });

  it("gets orders, gets order by id, and updates owner", async () => {
    const runQuery = vi
      .fn()
      .mockResolvedValueOnce([{ _id: "order_1" }])
      .mockResolvedValueOnce({ _id: "order_1" });
    const runMutation = vi.fn().mockResolvedValue({ success: true });
    const headers = { Cookie: cookieHeader({ guest_id: "guest_1" }) };

    const listResponse = await app.request(
      "http://localhost/orders",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );
    const getResponse = await app.request(
      "http://localhost/orders/order_1",
      { method: "GET", headers },
      { runMutation, runQuery } as never
    );
    const ownerResponse = await app.request(
      "http://localhost/orders/owner",
      {
        method: "POST",
        headers,
        body: JSON.stringify({ currentOwnerId: "guest_1", newOwnerId: "user_1" }),
      },
      { runMutation, runQuery } as never
    );

    expect(listResponse.status).toBe(200);
    expect(getResponse.status).toBe(200);
    expect(ownerResponse.status).toBe(200);
    expect(runQuery.mock.calls[0]?.[1]).toEqual({ storeFrontUserId: "guest_1" });
    expect(runQuery.mock.calls[1]?.[1]).toEqual({ identifier: "order_1" });
    expect(runMutation.mock.calls[0]?.[1]).toEqual({
      currentOwner: "guest_1",
      newOwner: "user_1",
    });
  });

  it("returns 400 when owner update throws", async () => {
    const response = await app.request(
      "http://localhost/orders/owner",
      {
        method: "POST",
        body: JSON.stringify({ currentOwnerId: "guest_1", newOwnerId: "user_1" }),
      },
      {
        runMutation: vi.fn().mockRejectedValue(new Error("update failed")),
        runQuery: vi.fn(),
      } as never
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Internal server error" });
  });
});

describe("upsellRoutes", () => {
  const app = new Hono().route("/upsells", upsellRoutes);

  it("returns null when no storefront user is present", async () => {
    const response = await app.request(
      "http://localhost/upsells",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toBeNull();
  });

  it("queries last viewed product with optional minAgeHours and handles errors", async () => {
    const okEnv = {
      runMutation: vi.fn(),
      runQuery: vi.fn().mockResolvedValue({ _id: "product_1" }),
    };
    const headers = { Cookie: cookieHeader({ user_id: "user_1" }) };

    const okResponse = await app.request(
      "http://localhost/upsells?category=wigs&minAgeHours=6",
      { method: "GET", headers },
      okEnv as never
    );

    const errEnv = {
      runMutation: vi.fn(),
      runQuery: vi.fn().mockRejectedValue(new Error("query failed")),
    };
    const errResponse = await app.request(
      "http://localhost/upsells",
      { method: "GET", headers },
      errEnv as never
    );

    expect(okResponse.status).toBe(200);
    expect(okEnv.runQuery.mock.calls[0]?.[1]).toEqual({
      category: "wigs",
      id: "user_1",
      minAgeHours: 6,
    });
    expect(errResponse.status).toBe(400);
    expect(await errResponse.json()).toEqual({ error: "query failed" });
  });
});

describe("userOffersRoutes", () => {
  const app = new Hono().route("/user-offers", userOffersRoutes);

  it("validates missing user and store ids", async () => {
    const missingUser = await app.request(
      "http://localhost/user-offers",
      { method: "GET" },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    const missingStore = await app.request(
      "http://localhost/user-offers",
      { method: "GET", headers: { Cookie: cookieHeader({ guest_id: "guest_1" }) } },
      { runMutation: vi.fn(), runQuery: vi.fn() } as never
    );

    expect(missingUser.status).toBe(400);
    expect(await missingUser.json()).toEqual({ error: "User ID is required" });
    expect(missingStore.status).toBe(400);
    expect(await missingStore.json()).toEqual({ error: "Store ID is required" });
  });

  it("returns eligibility and handles query failures", async () => {
    const headers = {
      Cookie: cookieHeader({ guest_id: "guest_1", store_id: "store_1" }),
    };
    const okEnv = {
      runMutation: vi.fn(),
      runQuery: vi.fn().mockResolvedValue({ eligible: true }),
    };

    const okResponse = await app.request(
      "http://localhost/user-offers",
      { method: "GET", headers },
      okEnv as never
    );

    const errEnv = {
      runMutation: vi.fn(),
      runQuery: vi.fn().mockRejectedValue(new Error("boom")),
    };
    const errResponse = await app.request(
      "http://localhost/user-offers",
      { method: "GET", headers },
      errEnv as never
    );

    expect(okResponse.status).toBe(200);
    expect(await okResponse.json()).toEqual({ eligible: true });
    expect(okEnv.runQuery.mock.calls[0]?.[1]).toEqual({
      storeFrontUserId: "guest_1",
      storeId: "store_1",
    });
    expect(errResponse.status).toBe(500);
    expect(await errResponse.json()).toEqual({
      error: "Failed to check offers eligibility",
    });
  });
});
