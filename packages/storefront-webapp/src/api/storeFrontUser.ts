import config from "@/config";
import { Guest, StoreFrontUser } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}`;

export async function getGuest(): Promise<Guest> {
  const response = await fetch(`${getBaseUrl()}/guests`, {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading guest.");
  }

  return res;
}

export async function getActiveUser(): Promise<StoreFrontUser> {
  const response = await fetch(`${getBaseUrl()}/users/me`, {
    method: "GET",
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading user.");
  }

  return res;
}

export async function updateUser({
  data,
}: {
  data: Partial<StoreFrontUser>;
}): Promise<StoreFrontUser> {
  const response = await fetch(`${getBaseUrl()}/users/me`, {
    method: "PUT",
    body: JSON.stringify(data),
    headers: {
      "Content-Type": "application/json",
    },
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating user.");
  }

  return res;
}
