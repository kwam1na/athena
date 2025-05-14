import config from "@/config";

export type OfferDetails = {
  code: string;
  displayText: string;
  discountType: "percentage" | "amount";
  discountValue: number;
  promoId: string | null;
};

export type UserEligibility = {
  isReturningUser: boolean;
  isEngaged: boolean;
  isEligibleForWelcome25: boolean;
  eligibleOffers?: OfferDetails[];
};

const getBaseUrl = () => `${config.apiGateway.URL}/user-offers`;

/**
 * Fetch eligibility for offers for the current user
 */
export async function getUserOffersEligibility(): Promise<UserEligibility> {
  const response = await fetch(getBaseUrl(), {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();
  if (!response.ok) {
    throw new Error(res.error || "Failed to get offer eligibility");
  }
  return res;
}
