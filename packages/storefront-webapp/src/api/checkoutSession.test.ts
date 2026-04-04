import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CheckoutSessionError,
  createCheckoutSession,
  getCheckoutActionErrorMessage,
  updateCheckoutSession,
} from "./checkoutSession";

const fetchMock = vi.fn<typeof fetch>();

const validOrderDetails = {
  customerDetails: {
    email: "ada@example.com",
    firstName: "Ada",
    lastName: "Lovelace",
    phoneNumber: "233555555555",
  },
  deliveryMethod: "pickup" as const,
  deliveryOption: null,
  deliveryFee: null,
  pickupLocation: "wigclub-hair-studio",
  deliveryDetails: null,
  discount: null,
};

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
    },
  });

describe("checkoutSession api", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("sends only the bag id when creating a checkout session", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        _id: "session_123",
      }),
    );

    await createCheckoutSession({
      bagId: "bag_123",
      bagItems: [
        {
          productId: "product_123",
          productSku: "sku-1",
          productSkuId: "sku_123",
          quantity: 2,
        },
      ],
      bagSubtotal: 4200,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, requestInit] = fetchMock.mock.calls[0];

    expect(JSON.parse(String(requestInit?.body))).toEqual({
      bagId: "bag_123",
    });
  });

  it("does not send client-authored totals when finalizing payment", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({
        authorization_url: "https://paystack.test/redirect",
      }),
    );

    await updateCheckoutSession({
      action: "finalize-payment",
      sessionId: "session_123",
      customerEmail: "ada@example.com",
      orderDetails: validOrderDetails,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, requestInit] = fetchMock.mock.calls[0];
    const payload = JSON.parse(String(requestInit?.body));

    expect(payload).toMatchObject({
      action: "finalize-payment",
      customerEmail: "ada@example.com",
      orderDetails: {
        ...validOrderDetails,
        billingDetails: null,
      },
    });
    expect(payload).not.toHaveProperty("amount");
  });

  it("surfaces checkout status codes and server error metadata", async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(
        {
          error:
            "This checkout session has already been completed. Please refresh the page or return to your shopping bag to start a new checkout.",
          code: "SESSION_ALREADY_FINALIZED",
        },
        422,
      ),
    );

    await expect(
      updateCheckoutSession({
        action: "complete-checkout",
        sessionId: "session_123",
        hasCompletedCheckoutSession: true,
      }),
    ).rejects.toEqual(
      expect.objectContaining<Partial<CheckoutSessionError>>({
        message:
          "This checkout session has already been completed. Please refresh the page or return to your shopping bag to start a new checkout.",
        status: 422,
        code: "SESSION_ALREADY_FINALIZED",
      }),
    );
  });

  it("maps invalid checkout states to an actionable payment message", () => {
    const error = new CheckoutSessionError(
      "This checkout session has already been completed.",
      {
        status: 422,
        code: "SESSION_ALREADY_FINALIZED",
      },
    );

    expect(getCheckoutActionErrorMessage(error, "finalize-payment")).toBe(
      "This checkout session has already been completed. Please refresh the page or return to your shopping bag to start a new checkout.",
    );
  });
});
