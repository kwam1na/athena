import config from "@/config";
import { BagResponseBody } from "@/lib/schemas/bag";
import { BagItemResponseBody } from "@/lib/schemas/bagItem";
import { Bag } from "@athena/webapp";

type GetBagItemsParams = {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
  bagId: string;
};

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  storeFrontUserId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/users/${storeFrontUserId}/bags`;

export async function createBag({
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
      method: "POST",
      body: JSON.stringify({
        storeFrontUserId,
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
export async function getAllBags({
  storeFrontUserId,
  organizationId,
  storeId,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
}): Promise<BagResponseBody[]> {
  const response = await fetch(
    getBaseUrl(organizationId, storeId, storeFrontUserId)
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bags.");
  }

  return res.bags;
}

// Fetch details of a specific bag
export async function getBag({
  storeFrontUserId,
  organizationId,
  storeId,
  bagId,
}: GetBagItemsParams): Promise<BagResponseBody> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/${bagId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

export async function getActiveBag({
  storeFrontUserId,
  organizationId,
  storeId,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/active`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

// Add an item to a bag
export async function addItemToBag({
  storeFrontUserId,
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
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/${bagId}/items`,
    {
      method: "POST",
      body: JSON.stringify({
        productId,
        productSkuId,
        productSku,
        quantity,
        storeFrontUserId,
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
  storeFrontUserId,
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
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/${bagId}/items/${itemId}`,
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
export async function removeItemFromBag({
  storeFrontUserId,
  organizationId,
  storeId,
  bagId,
  itemId,
}: GetBagItemsParams & { itemId: number }): Promise<void> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, storeFrontUserId)}/${bagId}/items/${itemId}`,
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    const res = await response.json();
    throw new Error(res.error || "Error removing item from bag.");
  }
}

export async function updateBagOwner({
  currentOwnerId,
  newOwnerId,
  organizationId,
  storeId,
  bagId,
}: {
  currentOwnerId: string;
  newOwnerId: string;
  organizationId: string;
  storeId: string;
  bagId: string;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId, currentOwnerId)}/${bagId}/owner`,
    {
      method: "POST",
      body: JSON.stringify({ currentOwnerId, newOwnerId }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error transferring bag");
  }

  return res;
}
