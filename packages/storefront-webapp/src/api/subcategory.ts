import config from "@/config";
import { FilterParams, OrganizationStoreEntityApiParams } from "./types";
import { Subcategory } from "@athena/webapp";

type GetParams = OrganizationStoreEntityApiParams & {
  subcategoryId: string;
};

const getBaseUrl = () => `${config.apiGateway.URL}/subcategories`;

export async function getAllSubcategories(): Promise<Subcategory[]> {
  const response = await fetch(getBaseUrl(), {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading subcategories.");
  }

  return res.subcategories;
}

export async function getSubategory({
  subcategoryId,
}: GetParams): Promise<Subcategory> {
  const response = await fetch(`${getBaseUrl()}/${subcategoryId}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading subcategory.");
  }

  return res;
}
