import config from "@/config";
import { OrganizationStoreEntityApiParams } from "./types";
import { Product } from "../../../athena-webapp";

type GetParams = OrganizationStoreEntityApiParams & {
  productId: string;
};

type FilterParams = {
  color?: string;
  length?: string;
};

const buildQueryString = (params?: FilterParams) => {
  if (!params) return null;
  const query = new URLSearchParams();
  if (params.color) query.append("color", params.color); // Expecting comma-separated string for color
  if (params.length) query.append("length", params.length); // Expecting comma-separated string for length
  return query.toString();
};

const getBaseUrl = (organizationId: string, storeId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/products`;

export async function getAllProducts({
  organizationId,
  storeId,
  filters,
}: OrganizationStoreEntityApiParams & { filters?: FilterParams }): Promise<
  Product[]
> {
  const queryString = buildQueryString(filters);
  const url = `${getBaseUrl(organizationId, storeId)}${queryString ? `?${queryString}` : ""}`;
  const response = await fetch(url);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading products.");
  }

  return res.products;
}

export async function getProduct({
  organizationId,
  storeId,
  productId,
}: GetParams): Promise<Product> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${productId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading product.");
  }

  return res;
}
