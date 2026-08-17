import config from "@/config";
import { getOrCreateGuestMarker } from "@/lib/guestMarker";
import { Store } from "@athena/webapp";

export async function getStore(asNewUser: boolean): Promise<Store> {
  const marker = getOrCreateGuestMarker();

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
