import config from "@/config";
import { Store } from "@athena/webapp";

export async function getStore(storeName: string): Promise<Store> {
  const response = await fetch(
    `${config.apiGateway.URL}/storefront?storeName=${storeName}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading store.");
  }

  return res;
}
