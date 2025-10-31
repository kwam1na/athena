import config from "@/config";
import { Review } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}/reviews`;

export type RatingDimension = {
  key: string;
  label: string;
  value: number;
  optional?: boolean;
};

export async function createReview(review: any): Promise<Review> {
  const response = await fetch(getBaseUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
    body: JSON.stringify(review),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to create review");
  }

  return res;
}

export async function getReviewByOrderItem(
  orderItemId: string
): Promise<Review> {
  const response = await fetch(`${getBaseUrl()}/order-item/${orderItemId}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to fetch review");
  }

  return res;
}

export async function updateReview(
  id: string,
  review: Partial<Review>
): Promise<Review> {
  const response = await fetch(`${getBaseUrl()}/${id}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(review),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to update review");
  }

  return res;
}

export async function deleteReview(id: string): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/${id}`, {
    method: "DELETE",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to delete review");
  }

  return res;
}

export async function getReviewsByProductSkuId(
  productSkuId: string
): Promise<Review[]> {
  const response = await fetch(`${getBaseUrl()}/product-sku/${productSkuId}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to fetch reviews");
  }

  return res;
}

export async function getUserReviews(): Promise<Review[]> {
  const response = await fetch(`${getBaseUrl()}/user`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to fetch user reviews");
  }

  return res;
}

export async function getUserReviewsForProduct(
  productSkuId: string
): Promise<Review[]> {
  const response = await fetch(
    `${getBaseUrl()}/user/product-sku/${productSkuId}`,
    {
      credentials: "include",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to fetch user reviews for product");
  }

  return res;
}

export async function getReviewsByProductId(
  productId: string
): Promise<Review[]> {
  const response = await fetch(`${getBaseUrl()}/product/${productId}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to fetch reviews");
  }

  return res;
}

export async function markReviewHelpful(
  reviewId: string,
  userId: string
): Promise<{ helpfulCount: number }> {
  const response = await fetch(`${getBaseUrl()}/${reviewId}/helpful`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
  });
  const res = await response.json();
  if (!response.ok) {
    throw new Error(res.error || "Failed to mark review as helpful");
  }
  return res;
}

export async function hasReviewForOrderItem(
  orderItemId: string
): Promise<boolean> {
  const response = await fetch(
    `${getBaseUrl()}/order-item/${orderItemId}/exists`,
    {
      credentials: "include",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to check if review exists");
  }

  return res.exists;
}

export async function hasUserReviewForOrderItem(
  orderItemId: string
): Promise<boolean> {
  const response = await fetch(
    `${getBaseUrl()}/order-item/${orderItemId}/user-exists`,
    {
      credentials: "include",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Failed to check if user has reviewed");
  }

  return res.exists;
}
