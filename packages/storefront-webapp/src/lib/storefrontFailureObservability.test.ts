import { describe, expect, it, vi } from "vitest";
import { ZodError, z } from "zod";

import { CheckoutSessionError } from "@/api/checkoutSession";
import type { StorefrontObservabilityEvent } from "./storefrontObservability";
import {
  createStorefrontFailureEvent,
  emitStorefrontFailure,
  inferStorefrontJourneyFromRoute,
  normalizeStorefrontError,
} from "./storefrontFailureObservability";

describe("storefront failure observability", () => {
  it("infers the storefront journey from the route", () => {
    expect(inferStorefrontJourneyFromRoute("/shop/checkout/complete")).toBe(
      "checkout",
    );
    expect(inferStorefrontJourneyFromRoute("/auth/verify")).toBe("auth");
    expect(inferStorefrontJourneyFromRoute("/shop/bag")).toBe("bag");
    expect(inferStorefrontJourneyFromRoute("/shop/product/wig-1")).toBe(
      "product_discovery",
    );
    expect(inferStorefrontJourneyFromRoute("/")).toBe("browse");
  });

  it("normalizes checkout session failures into the shared taxonomy", () => {
    const error = new CheckoutSessionError("Amount mismatch detected", {
      status: 422,
      code: "AMOUNT_MISMATCH",
    });

    expect(normalizeStorefrontError(error)).toEqual({
      category: "validation",
      code: "AMOUNT_MISMATCH",
      message: "Amount mismatch detected",
    });
  });

  it("normalizes network and schema validation failures", () => {
    expect(
      normalizeStorefrontError(new TypeError("Failed to fetch checkout")),
    ).toEqual({
      category: "network",
      code: undefined,
      message: "Failed to fetch checkout",
    });

    const schema = z.object({
      email: z.string().email(),
    });

    let validationError: ZodError | undefined;

    try {
      schema.parse({ email: "not-an-email" });
    } catch (error) {
      validationError = error as ZodError;
    }

    expect(normalizeStorefrontError(validationError)).toEqual({
      category: "validation",
      code: "validation_error",
      message: validationError?.issues[0]?.message,
    });
  });

  it("creates blocked failure events with inferred journey and fallback category", () => {
    expect(
      createStorefrontFailureEvent({
        route: "/auth/verify",
        step: "auth_verification",
        status: "blocked",
        error: {
          message: "Invalid verification code",
        },
        fallbackCategory: "validation",
        context: {
          email: "hello@example.com",
        },
      }),
    ).toEqual<StorefrontObservabilityEvent>({
      journey: "auth",
      step: "auth_verification",
      status: "blocked",
      context: {
        email: "hello@example.com",
      },
      error: {
        category: "validation",
        code: undefined,
        message: "Invalid verification code",
      },
    });
  });

  it("emits failure events through the provided track function", async () => {
    const track = vi.fn().mockResolvedValue({ ok: true });

    await emitStorefrontFailure({
      route: "/shop/checkout",
      step: "payment_submission",
      error: new CheckoutSessionError("Forbidden", {
        status: 403,
        code: "CHECKOUT_FORBIDDEN",
      }),
      context: {
        checkoutSessionId: "session_123",
      },
      track,
    });

    expect(track).toHaveBeenCalledWith({
      journey: "checkout",
      step: "payment_submission",
      status: "failed",
      context: {
        checkoutSessionId: "session_123",
      },
      error: {
        category: "authorization",
        code: "CHECKOUT_FORBIDDEN",
        message: "Forbidden",
      },
    });
  });
});
