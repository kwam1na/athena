import config from "@/config";
import { OrganizationStoreEntityApiParams } from "./types";
import { Product } from "../../../athena-webapp";

type GetParams = OrganizationStoreEntityApiParams & {
  productId: string;
};

const getBaseUrl = (organizationId: string, storeId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/products`;

export async function getAllProducts({
  organizationId,
  storeId,
}: OrganizationStoreEntityApiParams): Promise<Product[]> {
  const response = await fetch(getBaseUrl(organizationId, storeId));

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
