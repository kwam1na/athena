import config from "@/config";
import { BagResponseBody } from "@/lib/schemas/bag";
import { BagItemResponseBody } from "@/lib/schemas/bagItem";
import { Bag } from "@athena/webapp";

type GetBagItemsParams = {
  bagId: string;
};

const getBaseUrl = () => `${config.apiGateway.URL}/bags`;

export async function getActiveBag(): Promise<Bag> {
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
export async function addItemToBag({
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
  const response = await fetch(`${getBaseUrl()}/${bagId}/items`, {
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
export async function updateBagItem({
  bagId,
  itemId,
  quantity,
}: GetBagItemsParams & {
  itemId: string;
  quantity: number;
}): Promise<Bag> {
  const response = await fetch(`${getBaseUrl()}/${bagId}/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify({ quantity }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating item in bag.");
  }

  return res;
}

// Remove an item from a bag
export async function removeItemFromBag({
  bagId,
  itemId,
}: GetBagItemsParams & { itemId: string }): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/${bagId}/items/${itemId}`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const res = await response.json();
    throw new Error(res.error || "Error removing item from bag.");
  }
}

// Remove an item from a bag
export async function clearBag({ bagId }: GetBagItemsParams): Promise<void> {
  const response = await fetch(`${getBaseUrl()}/${bagId}/items/`, {
    method: "DELETE",
    credentials: "include",
  });

  if (!response.ok) {
    const res = await response.json();
    throw new Error(res.error || "Error removing item from bag.");
  }
}

export async function updateBagOwner({
  currentOwnerId,
  newOwnerId,
  bagId,
}: {
  currentOwnerId: string;
  newOwnerId: string;
  bagId: string;
}): Promise<Bag> {
  const response = await fetch(`${getBaseUrl()}/${bagId}/owner`, {
    method: "POST",
    body: JSON.stringify({ currentOwnerId, newOwnerId }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error transferring bag");
  }

  return res;
}
