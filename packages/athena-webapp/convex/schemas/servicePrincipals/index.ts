import {
  defineSchema,
  type DataModelFromSchemaDefinition,
  type GenericMutationCtx,
} from "convex/server";

import { servicePrincipalTable } from "./servicePrincipal";
import { servicePrincipalAuthBindingTable } from "./servicePrincipalAuthBinding";
import { servicePrincipalCapabilityTable } from "./servicePrincipalCapability";
import { servicePrincipalSessionTable } from "./servicePrincipalSession";

export * from "./servicePrincipal";
export * from "./servicePrincipalAuthBinding";
export * from "./servicePrincipalCapability";
export * from "./servicePrincipalSession";

export const servicePrincipalTables = {
  servicePrincipal: servicePrincipalTable,
  servicePrincipalCapability: servicePrincipalCapabilityTable,
  servicePrincipalAuthBinding: servicePrincipalAuthBindingTable,
  servicePrincipalSession: servicePrincipalSessionTable,
};

export const servicePrincipalFoundationSchema = defineSchema(
  servicePrincipalTables,
);

export type ServicePrincipalFoundationDataModel =
  DataModelFromSchemaDefinition<typeof servicePrincipalFoundationSchema>;

export type ServicePrincipalFoundationMutationCtx = Pick<
  GenericMutationCtx<ServicePrincipalFoundationDataModel>,
  "db"
>;
