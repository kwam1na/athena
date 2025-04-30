import config from "@/config";

const getBaseUrl = () => `${config.apiGateway.URL}/upsells`;

export async function getLastViewedProduct() {
  const response = await fetch(`${getBaseUrl()}`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading last viewed product.");
  }

  return res;
}
