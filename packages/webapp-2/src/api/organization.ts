import config from "@/config";
import { Organization, OrganizationRequest } from "@athena/db";

const baseUrl = `${config.apiGateway.URL}/organizations`;

export async function getAllOrganizations(): Promise<Organization[]> {
  const response = await fetch(`${baseUrl}/users/me/organizations`);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading organizations.");
  }

  return res.organizations;
}

export async function getOrganization(id: number): Promise<Organization> {
  const response = await fetch(`${baseUrl}/${id}`);

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading organization.");
  }

  return res;
}

export async function createOrganization(
  data: OrganizationRequest
): Promise<Organization> {
  const response = await fetch(baseUrl, {
    method: "POST",
    body: JSON.stringify({
      ...data,
      createdByUserId: "1",
      name: data.name.trim(),
    }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error creating organization.");
  }

  return res;
}

export async function updateOrganization(
  id: number,
  data: Partial<OrganizationRequest>
): Promise<Organization> {
  const response = await fetch(`${baseUrl}/${id}`, {
    method: "PUT",
    body: JSON.stringify({
      ...data,
      createdByUserId: "1",
      name: data?.name?.trim(),
    }),
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error updating organization.");
  }

  return res;
}

export async function deleteOrganization(id: number) {
  const response = await fetch(`${baseUrl}/${id}`, {
    method: "DELETE",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error deleting organization.");
  }

  return res;
}
