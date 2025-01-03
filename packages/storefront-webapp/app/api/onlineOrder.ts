import config from "@/config";

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  storeFrontUserId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/users/${storeFrontUserId}/orders`;

export async function getOrders({
  storeFrontUserId,
  organizationId,
  storeId,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
}) {
  const response = await fetch(
    getBaseUrl(organizationId, storeId, storeFrontUserId),
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error fetching orders.");
  }

  return res;
}

export async function getOrder({
  storeFrontUserId,
  organizationId,
  storeId,
  orderId,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
  orderId: string;
}) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/${orderId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error fetching order.");
  }

  return res;
}
