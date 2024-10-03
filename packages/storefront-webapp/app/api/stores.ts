import config from "@/config";
import type { OrganizationStoreEntityApiParams } from "./types";
import type { Store, StoreRequest } from "@athena/db";

type UpdateParams = OrganizationStoreEntityApiParams & {
  data: Partial<StoreRequest>;
};

const getBaseUrl = (organizationId: number) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores`;

export async function getAllStores(organizationId: number): Promise<Store[]> {
  const response = await fetch(getBaseUrl(organizationId));

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading stores.");
  }

  return res.stores;
}

export async function getStore({
  organizationId,
  storeId,
}: OrganizationStoreEntityApiParams): Promise<Store> {
  const response = await fetch(`${getBaseUrl(organizationId)}/${storeId}`);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading store.");
  }

  return res;
}

export async function createStore(
  organizationId: number,
  data: StoreRequest
): Promise<Store> {
  const response = await fetch(getBaseUrl(organizationId), {
    method: "POST",
    body: JSON.stringify({ ...data, name: data.name.trim() }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating store.");
  }

  return res;
}

export async function updateStore({
  data,
  organizationId,
  storeId,
}: UpdateParams): Promise<Store> {
  const response = await fetch(`${getBaseUrl(organizationId)}/${storeId}`, {
    method: "PUT",
    body: JSON.stringify({ ...data, name: data.name?.trim() }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating store.");
  }

  return res;
}
