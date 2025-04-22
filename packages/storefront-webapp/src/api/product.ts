import config from "@/config";
import { FilterParams, OrganizationStoreEntityApiParams } from "./types";
import { FeaturedItem, Product } from "@athena/webapp";

const buildQueryString = (params?: FilterParams) => {
  if (!params) return null;
  const query = new URLSearchParams();
  if (params.color) query.append("color", params.color); // Expecting comma-separated string for color
  if (params.length) query.append("length", params.length); // Expecting comma-separated string for length
  if (params.category) query.append("category", params.category); // Expecting comma-separated string for length
  if (params.subcategory) query.append("subcategory", params.subcategory); // Expecting comma-separated string for length
  query.append("isVisible", "true");
  return query.toString();
};

const getBaseUrl = () => `${config.apiGateway.URL}/products`;

export async function getAllProducts({
  filters,
}: {
  filters?: FilterParams;
}): Promise<Product[]> {
  const queryString = buildQueryString(filters);
  const url = `${getBaseUrl()}${queryString ? `?${queryString}` : ""}`;
  const response = await fetch(url, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading products.");
  }

  return res.products;
}

export async function getProduct(productId: string): Promise<Product> {
  const params = {
    isVisible: "true",
  };
  const queryString = new URLSearchParams(params).toString();
  const url = `${getBaseUrl()}/${productId}${queryString ? `?${queryString}` : ""}`;
  const response = await fetch(url, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading product.");
  }

  return res;
}

export async function getBestSellers(): Promise<Product[]> {
  const response = await fetch(`${getBaseUrl()}/bestSellers`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading best sellers.");
  }

  return res;
}

export async function getFeatured(): Promise<FeaturedItem[]> {
  const response = await fetch(`${getBaseUrl()}/featured`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading featured.");
  }

  return res;
}
