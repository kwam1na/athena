import config from "@/config";
import { BagResponseBody } from "@/lib/schemas/bag";
import { BagItemResponseBody } from "@/lib/schemas/bagItem";
import { Bag } from "@athena/db";

type GetBagItemsParams = {
  customerId: number;
  bagId: number;
};

const getBaseUrl = (customerId: string) =>
  `${config.apiGateway.URL}/customers/${customerId}/bags`;

export async function createBag(customerId: string) {
  const response = await fetch(getBaseUrl(customerId), {
    method: "POST",
    body: JSON.stringify({
      customerId,
    }),
    headers: {
      "Content-Type": "application/json",
    },
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating bag.");
  }

  return res;
}

// Fetch all bags for a customer
export async function getAllBags({
  customerId,
}: {
  customerId: string;
}): Promise<BagResponseBody[]> {
  const response = await fetch(getBaseUrl(customerId));

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bags.");
  }

  return res.bags;
}

// Fetch details of a specific bag
export async function getBag({
  customerId,
  bagId,
}: GetBagItemsParams): Promise<BagResponseBody> {
  const response = await fetch(`${getBaseUrl(customerId.toString())}/${bagId}`);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

export async function getActiveBag(customerId: number): Promise<Bag> {
  const response = await fetch(`${getBaseUrl(customerId.toString())}/active`);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag.");
  }

  return res;
}

// Fetch all items in a specific bag
export async function getBagItems({
  customerId,
  bagId,
}: GetBagItemsParams): Promise<BagItemResponseBody[]> {
  const response = await fetch(
    `${getBaseUrl(customerId.toString())}/${bagId}/items`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading bag items.");
  }

  return res.items;
}

// Add an item to a bag
export async function addItemToBag({
  customerId,
  bagId,
  productId,
  quantity,
  price,
}: GetBagItemsParams & {
  productId: number;
  quantity: number;
  price: number;
}): Promise<Bag> {
  const response = await fetch(
    `${getBaseUrl(customerId.toString())}/${bagId}/items`,
    {
      method: "POST",
      body: JSON.stringify({
        productId,
        quantity,
        price,
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
  bagId,
  itemId,
  quantity,
}: GetBagItemsParams & {
  itemId: number;
  quantity: number;
}): Promise<BagItemResponseBody> {
  const response = await fetch(
    `${getBaseUrl(customerId.toString())}/${bagId}/items/${itemId}`,
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
  customerId,
  bagId,
  itemId,
}: GetBagItemsParams & { itemId: number }): Promise<void> {
  const response = await fetch(
    `${getBaseUrl(customerId.toString())}/${bagId}/items/${itemId}`,
    {
      method: "DELETE",
    }
  );

  if (!response.ok) {
    const res = await response.json();
    throw new Error(res.error || "Error removing item from bag.");
  }
}
