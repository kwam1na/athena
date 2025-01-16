export type BaseApiParams = {
  organizationId: string;
};

export type OrganizationStoreEntityApiParams = BaseApiParams & {
  storeId: string;
};

export type FilterParams = {
  color?: string;
  length?: string;
  type?: string;
  category?: string;
  subcategory?: string;
};
