import config from "@/config";
import { FilterParams, OrganizationStoreEntityApiParams } from "./types";
import { Subcategory } from "@athena/webapp-2";

type GetParams = OrganizationStoreEntityApiParams & {
  subcategoryId: string;
};

const getBaseUrl = (organizationId: string, storeId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/subcategories`;

const buildQueryString = (params?: FilterParams) => {
  if (!params) return null;
  const query = new URLSearchParams();
  if (params.color) query.append("color", params.color); // Expecting comma-separated string for color
  if (params.length) query.append("length", params.length); // Expecting comma-separated string for length
  return query.toString();
};

export async function getAllSubcategories({
  organizationId,
  storeId,
}: OrganizationStoreEntityApiParams): Promise<Subcategory[]> {
  const response = await fetch(getBaseUrl(organizationId, storeId));

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading subcategories.");
  }

  return res.subcategories;
}

export async function getSubategory({
  organizationId,
  storeId,
  subcategoryId,
}: GetParams): Promise<Subcategory> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${subcategoryId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading subcategory.");
  }

  return res;
}
