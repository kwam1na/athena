import config from "@/config";
import { ProductResponse } from "@/lib/schemas/product";
import { OrganizationStoreEntityApiParams } from "./types";
import { Product, ProductRequest } from "@athena/db";

type GetParams = OrganizationStoreEntityApiParams & {
  productId: number;
};

type CreateParams = OrganizationStoreEntityApiParams & {
  data: ProductRequest;
};

type UpdateParams = GetParams & { data: Partial<ProductRequest> };

const getBaseUrl = (organizationId: number, storeId: number) =>
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

export async function createProduct({
  data,
  organizationId,
  storeId,
}: CreateParams): Promise<Product> {
  const response = await fetch(getBaseUrl(organizationId, storeId), {
    method: "POST",
    body: JSON.stringify({ ...data, name: data.name.trim() }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating product.");
  }

  return res;
}

export async function updateProduct({
  data,
  organizationId,
  storeId,
  productId,
}: UpdateParams): Promise<Product> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${productId}`,
    {
      method: "PUT",
      body: JSON.stringify({ ...data, name: data.name?.trim() }),
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating product.");
  }

  return res;
}
