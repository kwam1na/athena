import config from "@/config";
import { OrganizationStoreEntityApiParams } from "./types";
import { Category } from "@athena/webapp";

type GetParams = OrganizationStoreEntityApiParams & {
  categoryId: string;
};

const getBaseUrl = () => `${config.apiGateway.URL}/categories`;

export async function getAllCategories(): Promise<Category[]> {
  const response = await fetch(getBaseUrl(), {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading categories.");
  }

  return res.categories;
}

export async function getAllCategoriesWithSubcategories(): Promise<Category[]> {
  const response = await fetch(`${getBaseUrl()}?withSubcategories='true'`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading categories.");
  }

  return res.categories;
}

export async function getCategory({
  categoryId,
}: GetParams): Promise<Category> {
  const response = await fetch(`${getBaseUrl()}/${categoryId}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading category.");
  }

  return res;
}
