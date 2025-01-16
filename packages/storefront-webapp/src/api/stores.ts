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

export async function verifyUserAccount({
  organizationId,
  storeId,
  email,
  code,
  firstName,
  lastName,
}: OrganizationStoreEntityApiParams & {
  email?: string;
  code?: string;
  firstName?: string;
  lastName?: string;
}) {
  const response = await fetch(
    `${getBaseUrl(organizationId)}/${storeId}/auth/verify`,
    {
      method: "POST",
      body: JSON.stringify({ email, code, firstName, lastName }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error verifying account.");
  }

  return res;
}
