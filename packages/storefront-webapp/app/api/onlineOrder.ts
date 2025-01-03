import config from "@/config";

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  customerId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/users/${customerId}/orders`;

export async function getOrders({
  customerId,
  organizationId,
  storeId,
}: {
  customerId: string;
  organizationId: string;
  storeId: string;
}) {
  const response = await fetch(
    getBaseUrl(organizationId, storeId, customerId),
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
  customerId,
  organizationId,
  storeId,
  orderId,
}: {
  customerId: string;
  organizationId: string;
  storeId: string;
  orderId: string;
}) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${orderId}`,
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
