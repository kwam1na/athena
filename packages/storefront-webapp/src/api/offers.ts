import config from "@/config";

export interface OfferRequest {
  email: string;
  promoCodeId: string;
}

export interface OfferResponse {
  success: boolean;
  message: string;
}

const getBaseUrl = () => `${config.apiGateway.URL}/offers`;

/**
 * Submit an offer request to get a discount code
 *
 * @param data The offer request data
 * @returns The response with success status and message
 */
export async function submitOffer(data: OfferRequest): Promise<OfferResponse> {
  const response = await fetch(getBaseUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include", // This is important to include the guest ID cookie
    body: JSON.stringify(data),
  });

  const result = await response.json();

  if (!response.ok) {
    throw new Error(result.error || "Failed to submit offer request");
  }

  return result;
}
