export type BaseApiParams = {
  organizationId: number;
};

export type OrganizationStoreEntityApiParams = BaseApiParams & {
  storeId: number;
};
