import config from "@/config";
import { OrganizationStoreEntityApiParams } from "./types";
import { Subcategory, SubcategoryRequest } from "@athena/db";

type GetParams = OrganizationStoreEntityApiParams & {
  subcategoryId: number;
};

type CreateParams = OrganizationStoreEntityApiParams & {
  data: SubcategoryRequest;
};

type UpdateParams = GetParams & { data: Partial<SubcategoryRequest> };

const getBaseUrl = (organizationId: number, storeId: number) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/subcategories`;

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

export async function createSubcategory({
  data,
  organizationId,
  storeId,
}: CreateParams): Promise<Subcategory> {
  const response = await fetch(getBaseUrl(organizationId, storeId), {
    method: "POST",
    body: JSON.stringify({
      ...data,
      name: data.name.trim(),
    }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating subcategory.");
  }

  return res;
}

export async function updateSubcategory({
  data,
  organizationId,
  storeId,
  subcategoryId,
}: UpdateParams): Promise<Subcategory> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${subcategoryId}`,
    {
      method: "PUT",
      body: JSON.stringify({
        ...data,
        name: data.name?.trim(),
      }),
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating subcategory.");
  }

  return res;
}

export async function deleteSubategory({
  organizationId,
  storeId,
  subcategoryId,
}: GetParams) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/${subcategoryId}`,
    {
      method: "DELETE",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error deleting subcategory.");
  }

  return res;
}
