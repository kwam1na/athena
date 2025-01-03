import config from "@/config";
import { BagResponseBody } from "@/lib/schemas/bag";
import { BagItemResponseBody } from "@/lib/schemas/bagItem";
import { Bag } from "@athena/webapp-2";

type GetBagItemsParams = {
  customerId: string;
  organizationId: string;
  storeId: string;
  savedBagId: string;
};

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  customerId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/users/${customerId}/savedBags`;

export async function createSavedBag({
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
      method: "POST",
      body: JSON.stringify({
        customerId,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating bag.");
  }

  return res;
}

// Fetch all bags for a customer
export async function getAllSavedBags({
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
export async function getSavedBag({
  customerId,
  organizationId,
  storeId,
  savedBagId,
}: GetBagItemsParams): Promise<BagResponseBody> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${savedBagId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

export async function getActiveSavedBag({
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
export async function addItemToSavedBag({
  customerId,
  organizationId,
  storeId,
  savedBagId,
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
    `${getBaseUrl(organizationId, storeId, customerId)}/${savedBagId}/items`,
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
export async function updateSavedBagItem({
  customerId,
  organizationId,
  storeId,
  savedBagId,
  itemId,
  quantity,
}: GetBagItemsParams & {
  itemId: number;
  quantity: number;
}): Promise<BagItemResponseBody> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${savedBagId}/items/${itemId}`,
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

// Remove an item from a bag
export async function removeItemFromSavedBag({
  customerId,
  organizationId,
  storeId,
  savedBagId,
  itemId,
}: GetBagItemsParams & { itemId: number }): Promise<void> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, customerId)}/${savedBagId}/items/${itemId}`,
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    const res = await response.json();
    throw new Error(res.error || "Error removing item from bag.");
  }
}
