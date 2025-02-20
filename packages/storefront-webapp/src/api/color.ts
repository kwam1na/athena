import config from "@/config";
import { OrganizationStoreEntityApiParams } from "./types";
import { Color } from "@athena/webapp";

const getBaseUrl = () => `${config.apiGateway.URL}/colors`;

export async function getAllColors(): Promise<Color[]> {
  const response = await fetch(getBaseUrl(), {
    credentials: "include",
  });

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading colors.");
  }

  return res.colors;
}
