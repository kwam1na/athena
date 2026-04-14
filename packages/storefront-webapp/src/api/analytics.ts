import config from "@/config";
import { resolveStorefrontAnalyticsOrigin } from "@/lib/storefrontObservability";

export async function postAnalytics({
  action,
  origin,
  data = {},
  productId,
}: {
  action: string;
  origin?: string;
  data?: Record<string, any>;
  productId?: string;
}) {
  const searchParams =
    typeof window !== "undefined"
      ? new URLSearchParams(window.location.search)
      : null;
  const resolvedOrigin = resolveStorefrontAnalyticsOrigin({
    explicitOrigin: origin,
    searchOrigin: searchParams?.get("origin") ?? undefined,
    utmSource: searchParams?.get("utm_source") ?? undefined,
  });
  const response = await fetch(`${config.apiGateway.URL}/analytics`, {
    method: "POST",
    body: JSON.stringify({
      action,
      origin: resolvedOrigin,
      data,
      productId,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error posting analytics.");
  }

  return res;
}

export async function updateAnalyticsOwner({
  guestId,
  userId,
}: {
  guestId: string;
  userId: string;
}) {
  const response = await fetch(
    `${config.apiGateway.URL}/analytics/update-owner`,
    {
      method: "POST",
      body: JSON.stringify({ guestId, userId }),
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating analytics owner.");
  }

  return res;
}

export async function logout() {
  const response = await fetch(`${config.apiGateway.URL}/auth/logout`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error logging out.");
  }

  return res;
}

export async function getProductViewCount(
  productId: string
): Promise<{ daily: number; total: number }> {
  const response = await fetch(
    `${config.apiGateway.URL}/analytics/product-view-count?productId=${productId}`,
    {
      credentials: "include",
    }
  );
  const res = await response.json();
  if (!response.ok) {
    throw new Error(res.error || "Error fetching product view count.");
  }
  return { daily: res.daily, total: res.total };
}
