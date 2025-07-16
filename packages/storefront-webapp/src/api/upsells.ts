import config from "@/config";

const getBaseUrl = () => `${config.apiGateway.URL}/upsells`;

export async function getLastViewedProduct(category?: string) {
  const url = category ? `${getBaseUrl()}?category=${category}` : getBaseUrl();
  const response = await fetch(url, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading last viewed product.");
  }

  return res;
}
