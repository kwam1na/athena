import config from "@/config";
import type { OrganizationStoreEntityApiParams } from "./types";
import { Store } from "@athena/webapp";

const getBaseUrl = (organizationId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores`;

export async function getAllStores(organizationId: string): Promise<Store[]> {
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
