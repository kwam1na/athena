import config from "@/config";
import { PromoCode } from "@athena/webapp";

const getBaseUrl = (
  organizationId: string,
  storeId: string,
  storeFrontUserId: string
) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/users/${storeFrontUserId}/promoCodes`;

export async function redeemPromoCode({
  storeFrontUserId,
  organizationId,
  storeId,
  code,
}: {
  storeFrontUserId: string;
  organizationId: string;
  storeId: string;
  code: string;
}): Promise<PromoCode> {
  const response = await fetch(
    getBaseUrl(organizationId, storeId, storeFrontUserId),
    {
      method: "POST",
      body: JSON.stringify({
        code,
      }),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error redeeming promo code");
  }

  return res;
}
