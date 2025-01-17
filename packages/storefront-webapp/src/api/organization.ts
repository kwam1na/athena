import config from "@/config";
import { Organization } from "@athena/webapp";

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
