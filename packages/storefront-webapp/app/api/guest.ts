import config from "@/config";
import { BagResponseBody } from "@/lib/schemas/bag";
import { StoreFrontUser } from "@athena/webapp-2";

type GetGuestParams = {
  guestId: string;
  organizationId: string;
  storeId: string;
};

const getBaseUrl = (organizationId: string, storeId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}`;

export async function createGuest(organizationId: string, storeId: string) {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/guests`,
    {
      method: "POST",
      body: JSON.stringify({}),
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating guest.");
  }

  return res;
}

export async function getGuest({
  guestId,
  storeId,
  organizationId,
}: GetGuestParams): Promise<BagResponseBody> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/guests/${guestId}`
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading guest.");
  }

  return res;
}

export async function getActiveUser({
  storeId,
  organizationId,
  userId,
}: {
  storeId: string;
  organizationId: string;
  userId: string;
}): Promise<StoreFrontUser> {
  const response = await fetch(
    `${getBaseUrl(organizationId, storeId)}/users/${userId}`,
    {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
      },
      credentials: "include",
    }
  );

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading user.");
  }

  return res;
}
