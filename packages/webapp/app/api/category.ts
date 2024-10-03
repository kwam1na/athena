import config from "@/config";
import { CategoryResponse, CategoryType } from "@/lib/schemas/category";
import { OrganizationStoreEntityApiParams } from "./types";
import { Category, CategoryRequest } from "@athena/db";

type GetParams = OrganizationStoreEntityApiParams & {
  categoryId: number;
};

type CreateParams = OrganizationStoreEntityApiParams & {
  data: CategoryRequest;
};

type UpdateParams = GetParams & { data: Partial<CategoryRequest> };

const getBaseUrl = (organizationId: number, storeId: number) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/categories`;

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

export async function createCategory({
  data,
  organizationId,
  storeId,
}: CreateParams): Promise<Category> {
  const response = await fetch(getBaseUrl(organizationId, storeId), {
    method: "POST",
    body: JSON.stringify({ ...data, name: data.name.trim() }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating category.");
  }

  return res;
}

export async function updateCategory({
  data,
  categoryId,
  organizationId,
  storeId,
}: UpdateParams): Promise<Category> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${categoryId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...data,
        name: data?.name?.trim(),
      }),
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating category.");
  }

  return res;
}

export async function deleteCategory({
  categoryId,
  organizationId,
  storeId,
}: GetParams) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${categoryId}`,
    {
      method: "DELETE",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error deleting category.");
  }

  return res;
}
