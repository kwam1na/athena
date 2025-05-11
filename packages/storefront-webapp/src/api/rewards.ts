import config from "@/config";

const getBaseUrl = () => `${config.apiGateway.URL}/rewards`;

export type RewardPoints = {
  points: number;
};

export type RewardTransaction = {
  _id: string;
  _creationTime: number;
  storeFrontUserId: string;
  storeId: string;
  points: number;
  orderId?: string;
  orderNumber?: string;
  reason: string;
  createdAt: number;
};

export type RewardTier = {
  _id: string;
  storeId: string;
  name: string;
  pointsRequired: number;
  discountType: "percentage" | "fixed";
  discountValue: number;
  isActive: boolean;
};

export type RedeemResponse = {
  success: boolean;
  error?: string;
  pointsUsed?: number;
  discount?: {
    type: "percentage" | "fixed";
    value: number;
    name: string;
  };
};

// Add types and functions for past orders
export type EligibleOrder = {
  _id: string;
  _creationTime: number;
  amount: number;
  status: string;
  orderNumber: string;
  hasVerifiedPayment: boolean;
  potentialPoints: number;
};

// Get user's current reward points
export async function getUserPoints(storeId: string): Promise<RewardPoints> {
  const response = await fetch(`${getBaseUrl()}/points`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch reward points");
  }

  return await response.json();
}

// Get user's reward point history
export async function getPointHistory(): Promise<{
  transactions: RewardTransaction[];
}> {
  const response = await fetch(`${getBaseUrl()}/history`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch reward history");
  }

  return await response.json();
}

// Get available reward tiers for a store
export async function getRewardTiers(): Promise<{ tiers: RewardTier[] }> {
  const response = await fetch(`${getBaseUrl()}/tiers`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to fetch reward tiers");
  }

  return await response.json();
}

// Redeem points for a reward
export async function redeemRewardPoints(
  rewardTierId: string
): Promise<RedeemResponse> {
  const response = await fetch(`${getBaseUrl()}/redeem`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      rewardTierId,
    }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to redeem reward points");
  }

  return await response.json();
}

// Get eligible past orders for points
export async function getEligiblePastOrders(
  email: string
): Promise<{ orders: EligibleOrder[] }> {
  const response = await fetch(
    `${getBaseUrl()}/eligible-past-orders?email=${encodeURIComponent(email)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch eligible past orders");
  }

  return await response.json();
}

// Award points for a past order
export async function awardPointsForPastOrder(orderId: string): Promise<{
  success: boolean;
  error?: string;
  points?: number;
}> {
  const response = await fetch(`${getBaseUrl()}/award-past-order`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      orderId,
    }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to award points for past order");
  }

  return await response.json();
}

// Add function to get reward transactions for a specific order
export async function getOrderRewardPoints(orderId: string): Promise<{
  points: number;
  transaction?: RewardTransaction;
}> {
  const response = await fetch(
    `${getBaseUrl()}/order-points?orderId=${encodeURIComponent(orderId)}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    }
  );

  if (!response.ok) {
    throw new Error("Failed to fetch order reward points");
  }

  return await response.json();
}

// Award points for all orders associated with a guest ID
export async function awardPointsForGuestOrders({
  guestId,
  userId,
}: {
  guestId: string;
  userId: string;
}) {
  const response = await fetch(`${getBaseUrl()}/award-guest-orders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      guestId,
      userId,
    }),
    credentials: "include",
  });

  if (!response.ok) {
    throw new Error("Failed to award points for guest orders");
  }

  return await response.json();
}
