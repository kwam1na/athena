import config from "@/config";
import { MARKER_KEY } from "@/lib/constants";
import { Store } from "@athena/webapp";

export async function getStore(asNewUser: boolean): Promise<Store> {
  let marker = localStorage.getItem(MARKER_KEY);

  if (!marker) {
    marker = Math.random().toString(36).substring(7);
    localStorage.setItem(MARKER_KEY, marker);
  }

  const response = await fetch(
    `${config.apiGateway.URL}/storefront?storeName=${config.storefront.storeName}&marker=${marker}&asNewUser=${asNewUser}`,
    {
      credentials: "include",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading store.");
  }

  return res;
}
