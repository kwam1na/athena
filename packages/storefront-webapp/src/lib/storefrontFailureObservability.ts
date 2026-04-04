import { CheckoutSessionError } from "@/api/checkoutSession";
import { ZodError } from "zod";

import type {
  StorefrontObservabilityErrorCategory,
  StorefrontObservabilityEvent,
} from "./storefrontObservability";

type StorefrontFailureInput = {
  route: string;
  step: StorefrontObservabilityEvent["step"];
  status?: Extract<StorefrontObservabilityEvent["status"], "failed" | "blocked">;
  journey?: StorefrontObservabilityEvent["journey"];
  context?: StorefrontObservabilityEvent["context"];
  error?: unknown;
  fallbackCategory?: StorefrontObservabilityErrorCategory;
};

type StorefrontTrack = (event: StorefrontObservabilityEvent) => Promise<unknown>;

const authorizationPattern =
  /unauthorized|forbidden|not authorized|access denied|session.*available/i;
const networkPattern = /network|fetch|load failed|failed to fetch/i;

export function inferStorefrontJourneyFromRoute(
  route: string,
): StorefrontObservabilityEvent["journey"] {
  if (route.startsWith("/auth")) {
    return "auth";
  }

  if (route.startsWith("/shop/checkout")) {
    return "checkout";
  }

  if (route.startsWith("/shop/bag")) {
    return "bag";
  }

  if (route.startsWith("/shop/product")) {
    return "product_discovery";
  }

  return "browse";
}

export function normalizeStorefrontError(
  error: unknown,
  fallbackCategory: StorefrontObservabilityErrorCategory = "unknown",
) {
  if (error instanceof CheckoutSessionError) {
    const category =
      error.status === 401 || error.status === 403
        ? "authorization"
        : error.status === 400 || error.status === 422
          ? "validation"
          : error.status >= 500
            ? "server"
            : fallbackCategory;

    return {
      category,
      code: error.code,
      message: error.message,
    };
  }

  if (error instanceof ZodError) {
    return {
      category: "validation" as const,
      code: "validation_error",
      message: error.issues[0]?.message,
    };
  }

  if (error instanceof Error) {
    if (networkPattern.test(error.message)) {
      return {
        category: "network" as const,
        code: undefined,
        message: error.message,
      };
    }

    if (authorizationPattern.test(error.message)) {
      return {
        category: "authorization" as const,
        code: undefined,
        message: error.message,
      };
    }

    return {
      category: fallbackCategory,
      code: undefined,
      message: error.message,
    };
  }

  if (typeof error === "object" && error !== null) {
    return {
      category:
        "category" in error && typeof error.category === "string"
          ? (error.category as StorefrontObservabilityErrorCategory)
          : fallbackCategory,
      code:
        "code" in error && typeof error.code === "string"
          ? error.code
          : undefined,
      message:
        "message" in error && typeof error.message === "string"
          ? error.message
          : undefined,
    };
  }

  if (typeof error === "string") {
    return {
      category: authorizationPattern.test(error)
        ? ("authorization" as const)
        : networkPattern.test(error)
          ? ("network" as const)
          : fallbackCategory,
      code: undefined,
      message: error,
    };
  }

  return {
    category: fallbackCategory,
    code: undefined,
    message: undefined,
  };
}

export function createStorefrontFailureEvent({
  route,
  step,
  status = "failed",
  journey,
  context,
  error,
  fallbackCategory = "unknown",
}: StorefrontFailureInput): StorefrontObservabilityEvent {
  return {
    journey: journey ?? inferStorefrontJourneyFromRoute(route),
    step,
    status,
    context,
    error: normalizeStorefrontError(error, fallbackCategory),
  };
}

export async function emitStorefrontFailure({
  track,
  ...input
}: StorefrontFailureInput & {
  track: StorefrontTrack;
}) {
  return track(createStorefrontFailureEvent(input));
}
