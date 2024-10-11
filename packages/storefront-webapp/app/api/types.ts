export type BaseApiParams = {
  organizationId: string;
};

export type OrganizationStoreEntityApiParams = BaseApiParams & {
  storeId: string;
};
