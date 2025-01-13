import config from "@/config";
import { OrganizationStoreEntityApiParams } from "./types";
import { Color } from "@athena/webapp";

type GetParams = OrganizationStoreEntityApiParams & {
  productId: string;
};

const getBaseUrl = (organizationId: string, storeId: string) =>
  `${config.apiGateway.URL}/organizations/${organizationId}/stores/${storeId}/colors`;

export async function getAllColors({
  organizationId,
  storeId,
}: OrganizationStoreEntityApiParams): Promise<Color[]> {
  const response = await fetch(getBaseUrl(organizationId, storeId));

  const res = await response.json();

  if (!response.ok) {
    throw new Error(res.error || "Error loading colors.");
  }

  return res.colors;
}

// export async function getProduct({
//   organizationId,
//   storeId,
//   productId,
// }: GetParams): Promise<Product> {
//   const response = await fetch(
//     `${getBaseUrl(organizationId, storeId)}/${productId}`
//   );

//   const res = await response.json();

//   if (!response.ok) {
//     throw new Error(res.error || "Error loading product.");
//   }

//   return res;
// }
