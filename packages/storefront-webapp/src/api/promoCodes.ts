import config from "@/config";
import { PromoCode } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}/stores/promoCodes`;

export async function redeemPromoCode(code: string): Promise<PromoCode> {
  const response = await fetch(getBaseUrl(), {
    method: "POST",
    body: JSON.stringify({
      code,
    }),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error redeeming promo code");
  }

  return res;
}

export async function getPromoCodes(): Promise<PromoCode[]> {
  const response = await fetch(getBaseUrl(), {
    method: "GET",
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error getting promo codes");
  }

  return res;
}
