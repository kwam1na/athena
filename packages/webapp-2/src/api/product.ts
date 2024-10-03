import config from "@/config";
import { deleteDirectoryInS3 } from "@/lib/aws";
import { ProductResponse } from "@/lib/schemas/product";
import { OrganizationStoreEntityApiParams } from "./types";
import {
  Product,
  ProductRequest,
  ProductSKU,
  ProductSKURequest,
} from "@athena/db";

type GetParams = OrganizationStoreEntityApiParams & {
  productId: number | string;
};

type CreateParams = OrganizationStoreEntityApiParams & {
  data: ProductRequest;
};

type UpdateParams = GetParams & { data: Partial<ProductRequest> };

type CreateSkuParams = GetParams & {
  data: ProductSKURequest;
};

type UpdateSkuParams = GetParams & {
  skuId: number;
  data: Partial<ProductSKURequest>;
};

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

export async function createProductSku({
  data,
  organizationId,
  storeId,
  productId,
}: CreateSkuParams): Promise<ProductSKU> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${productId}/skus`,
    {
      method: "POST",
      body: JSON.stringify(data),
    }
  );
  const res = await response.json();
  if (!response.ok) {
    throw new Error(res.error || "Error creating product SKU.");
  }
  return res;
}

export async function updateProductSku({
  data,
  organizationId,
  storeId,
  productId,
  skuId,
}: UpdateSkuParams): Promise<ProductSKU> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${productId}/skus/${skuId}`,
    {
      method: "PUT",
      body: JSON.stringify(data),
    }
  );
  const res = await response.json();
  if (!response.ok) {
    throw new Error(res.error || "Error updating product SKU.");
  }
  return res;
}

export async function deleteProduct({
  organizationId,
  storeId,
  productId,
}: GetParams) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${productId}`,
    {
      method: "DELETE",
    }
  );
  // delete images in s3
  const deleteImagesResponse = await deleteDirectoryInS3(
    `${storeId}/${productId}`
  );
  if (deleteImagesResponse.error) {
    throw new Error(
      (deleteImagesResponse.error as Error).message ||
        "Error deleting images for product."
    );
  }
  const res = await response.json();
  if (!response.ok) {
    throw new Error(res.error || "Error deleting product.");
  }
  return res;
}

export async function deleteAllProducts({
  organizationId,
  storeId,
}: OrganizationStoreEntityApiParams) {
  const response = await fetch(getBaseUrl(organizationId, storeId), {
    method: "DELETE",
  });
  const res = await response.json();
  if (!response.ok) {
    throw new Error(res.error || "Error deleting products.");
  }
  return res;
}

export async function deleteProductSku({
  organizationId,
  storeId,
  productId,
  skuId,
}: GetParams & { skuId: number }) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${productId}/skus/${skuId}`,
    {
      method: "DELETE",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error deleting product sku.");
  }
  return res;
}
