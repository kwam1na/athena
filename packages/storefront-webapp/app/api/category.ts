import config from "@/config";
import { FilterParams, OrganizationStoreEntityApiParams } from "./types";
import { Category } from "@athena/webapp";

type GetParams = OrganizationStoreEntityApiParams & {
  categoryId: string;
};

const getBaseUrl = (organizationId: string, storeId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/categories`;

const buildQueryString = (params?: FilterParams) => {
  if (!params) return null;
  const query = new URLSearchParams();
  if (params.color) query.append("color", params.color); // Expecting comma-separated string for color
  if (params.length) query.append("length", params.length); // Expecting comma-separated string for length
  return query.toString();
};

export async function getAllCategories({
  organizationId,
  storeId,
}: OrganizationStoreEntityApiParams): Promise<Category[]> {
  const response = await fetch(getBaseUrl(organizationId, storeId));

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading categories.");
  }

  return res.categories;
}

export async function getAllCategoriesWithSubcategories({
  organizationId,
  storeId,
}: OrganizationStoreEntityApiParams): Promise<Category[]> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}?withSubcategories='true'`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading categories.");
  }

  return res.categories;
}

export async function getCategory({
  organizationId,
  storeId,
  categoryId,
}: GetParams): Promise<Category> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${categoryId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading category.");
  }

  return res;
}
