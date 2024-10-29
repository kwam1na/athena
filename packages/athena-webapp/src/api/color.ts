import config from "@/config";
import { Organization, OrganizationRequest } from "@athena/db";
import { Color } from "~/types";

const baseUrl = `${config.apiGateway.URL}/organizations`;

const getBaseUrl = (organizationId: string, storeId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/colors`;

export async function getAllColors(
  organizationId: string,
  storeId: string
): Promise<Color[]> {
  const response = await fetch(getBaseUrl(organizationId, storeId));

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading colors.");
  }

  return res.organizations;
}

export async function getColor({
  id,
  storeId,
  organizationId,
}: {
  id: string;
  storeId: string;
  organizationId: string;
}): Promise<Color> {
  const response = await fetch(`${getBaseUrl(organizationId, storeId)}/${id}`);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading organization.");
  }

  return res;
}

export async function createColor({
  storeId,
  organizationId,
  data,
}: {
  storeId: string;
  organizationId: string;
  data: { name: string; hexCode?: string };
}): Promise<Color> {
  const response = await fetch(getBaseUrl(organizationId, storeId), {
    method: "POST",
    body: JSON.stringify({
      ...data,
      name: data.name.trim(),
    }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating organization.");
  }

  return res;
}

export async function updateColor({
  id,
  storeId,
  organizationId,
  data,
}: {
  id: string;
  storeId: string;
  organizationId: string;
  data: { name: string; hexCode?: string };
}): Promise<Color> {
  const response = await fetch(`${getBaseUrl(organizationId, storeId)}/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...data,
      name: data?.name?.trim(),
    }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating organization.");
  }

  return res;
}

export async function deleteColor({
  id,
  storeId,
  organizationId,
}: {
  id: string;
  storeId: string;
  organizationId: string;
}) {
  const response = await fetch(`${getBaseUrl(organizationId, storeId)}/${id}`, {
    method: "DELETE",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error deleting organization.");
  }

  return res;
}
