import config from "@/config";
import { PromoCode, PromoCodeItem } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}/stores/promoCodes`;

export async function redeemPromoCode({
  code,
  checkoutSessionId,
}: {
  code: string;
  checkoutSessionId: string;
}): Promise<PromoCode> {
  const response = await fetch(getBaseUrl(), {
    method: "POST",
    body: JSON.stringify({
      code,
      checkoutSessionId,
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

export async function getPromoCodeItems(): Promise<PromoCodeItem[]> {
  const response = await fetch(
    `${config.apiGateway.URL}/stores/promoCodeItems`,
    {
      method: "GET",
      credentials: "include",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error("Error getting promo items");
  }

  return res;
}
