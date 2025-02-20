import config from "@/config";
import { Bag } from "@athena/webapp";

type GetBagItemsParams = {
  savedBagId: string;
};

const getBaseUrl = () => `${config.apiGateway.URL}/savedBags`;

export async function getActiveSavedBag(): Promise<Bag> {
  const response = await fetch(`${getBaseUrl()}/active`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

// Add an item to a bag
export async function addItemToSavedBag({
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
  const response = await fetch(`${getBaseUrl()}/${savedBagId}/items`, {
    method: "POST",
    body: JSON.stringify({
      productId,
      productSkuId,
      productSku,
      quantity,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error adding item to bag.");
  }

  return res;
}

// Update an item in a bag
export async function updateSavedBagItem({
  savedBagId,
  itemId,
  quantity,
}: GetBagItemsParams & {
  itemId: string;
  quantity: number;
}) {
  const response = await fetch(
    `${getBaseUrl()}/${savedBagId}/items/${itemId}`,
    {
      method: "PUT",
      body: JSON.stringify({ quantity }),
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
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
  savedBagId,
  itemId,
}: GetBagItemsParams & { itemId: string }) {
  const response = await fetch(
    `${getBaseUrl()}/${savedBagId}/items/${itemId}`,
    {
      method: "DELETE",
      credentials: "include",
    }
  );

  if (!response.ok) {
    const res = await response.json();
    throw new Error(res.error || "Error removing item from bag.");
  }
}

export async function updateSavedBagOwner({
  currentOwnerId,
  newOwnerId,
  savedBagId,
}: {
  currentOwnerId: string;
  newOwnerId: string;
  organizationId: string;
  storeId: string;
  savedBagId: string;
}): Promise<Bag> {
  const response = await fetch(`${getBaseUrl()}/${savedBagId}/owner`, {
    method: "POST",
    body: JSON.stringify({ currentOwnerId, newOwnerId }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error transferring saved items.");
  }

  return res;
}
