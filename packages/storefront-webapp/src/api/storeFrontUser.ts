import config from "@/config";
import { MARKER_KEY } from "@/lib/constants";
import { Guest, StoreFrontUser } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}`;

export async function getGuest(): Promise<Guest> {
  let marker = localStorage.getItem(MARKER_KEY);

  if (!marker) {
    marker = Math.random().toString(36).substring(7);
    localStorage.setItem(MARKER_KEY, marker);
  }

  const response = await fetch(`${getBaseUrl()}/guests?marker=${marker}`, {
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
