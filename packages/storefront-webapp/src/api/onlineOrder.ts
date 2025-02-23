import config from "@/config";
import { OnlineOrder } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}/orders`;

export async function getOrders() {
  const response = await fetch(getBaseUrl(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error fetching orders.");
  }

  return res;
}

export async function getOrder(orderId: string): Promise<OnlineOrder> {
  const response = await fetch(`${getBaseUrl()}/${orderId}`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error fetching order.");
  }

  return res;
}

export async function updateOrdersOwner({
  currentOwnerId,
  newOwnerId,
}: {
  currentOwnerId: string;
  newOwnerId: string;
}) {
  const response = await fetch(`${getBaseUrl()}/owner`, {
    method: "POST",
    body: JSON.stringify({ currentOwnerId, newOwnerId }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error transferring orders");
  }

  return res;
}
