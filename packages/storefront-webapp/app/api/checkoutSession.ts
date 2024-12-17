import config from "@/config";
import { BagResponseBody } from "@/lib/schemas/bag";
import { BagItemResponseBody } from "@/lib/schemas/bagItem";
import { Bag } from "@athena/webapp-2";

type GetBagItemsParams = {
  customerId: string;
  organizationId: string;
  storeId: string;
  bagId: string;
};

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  customerId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/customers/${customerId}/checkout`;

export async function createCheckoutSession({
  customerId,
  organizationId,
  storeId,
  bagId,
  bagItems,
}: {
  customerId: string;
  bagId: string;
  organizationId: string;
  storeId: string;
  bagItems: { quantity: number; productSkuId: string }[];
}) {
  const response = await fetch(
    getBaseUrl(organizationId, storeId, customerId),
    {
      method: "POST",
      body: JSON.stringify({
        storeId,
        bagId,
        customerId,
        products: bagItems,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating checkout session.");
  }

  return res;
}

// Fetch all bags for a customer
export async function getAllBags({
  customerId,
  organizationId,
  storeId,
}: {
  customerId: string;
  organizationId: string;
  storeId: string;
}): Promise<BagResponseBody[]> {
  const response = await fetch(getBaseUrl(organizationId, storeId, customerId));

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bags.");
  }

  return res.bags;
}

// Fetch details of a specific bag
export async function getBag({
  customerId,
  organizationId,
  storeId,
  bagId,
}: GetBagItemsParams): Promise<BagResponseBody> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${bagId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

export async function getActiveBag({
  customerId,
  organizationId,
  storeId,
}: {
  customerId: string;
  organizationId: string;
  storeId: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/active`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

// Add an item to a bag
export async function addItemToBag({
  customerId,
  organizationId,
  storeId,
  bagId,
  productId,
  productSkuId,
  productSku,
  quantity,
}: GetBagItemsParams & {
  productId: string;
  productSkuId: string;
  productSku: string;
  quantity: number;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${bagId}/items`,
    {
      method: "POST",
      body: JSON.stringify({
        productId,
        productSkuId,
        productSku,
        quantity,
        customerId,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error adding item to bag.");
  }

  return res;
}

// Update an item in a bag
export async function updateBagItem({
  customerId,
  organizationId,
  storeId,
  bagId,
  itemId,
  quantity,
}: GetBagItemsParams & {
  itemId: number;
  quantity: number;
}): Promise<BagItemResponseBody> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${bagId}/items/${itemId}`,
    {
      method: "PUT",
      body: JSON.stringify({ quantity }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating item in bag.");
  }

  return res;
}
