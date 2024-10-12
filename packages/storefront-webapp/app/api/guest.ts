import config from "@/config";
import { BagResponseBody } from "@/lib/schemas/bag";
import { BagItemResponseBody } from "@/lib/schemas/bagItem";
import { Bag } from "@athena/db";

type GetGuestParams = {
  guestId: string;
  organizationId: string;
};

const getBaseUrl = (organizationId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/guests`;

export async function createGuest(organizationId: string) {
  const response = await fetch(getBaseUrl(organizationId), {
    method: "POST",
    body: JSON.stringify({}),
    headers: {
      "Content-Type": "application/json",
    },
  });

  const res = await response.json();

  console.log("res for guest ->", res);

  if (!response.ok) {
    throw new Error(res.error || "Error creating guest.");
  }

  return res;
}

export async function getGuest({
  guestId,
  organizationId,
}: GetGuestParams): Promise<BagResponseBody> {
  const response = await fetch(`${getBaseUrl(organizationId)}/${guestId}`);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading guest.");
  }

  return res;
}
