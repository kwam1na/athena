import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";
import {
  createOrganizationRouteOperationDefinition,
  deleteOrganizationRouteOperationDefinition,
  updateOrganizationRouteOperationDefinition,
} from "../../../../operationAdmission/domains/httpCore_definitions";
import {
  getOrganizationRouteReadDefinition,
  listMyOrganizationsRouteReadDefinition,
} from "../../../../operationAdmission/domains/httpCore_readDefinitions";
import {
  admitHttpRead,
  admitHttpRoute,
} from "../../../../platform/operationAdmission";

const orgRoutes: HonoWithConvex<ActionCtx> = new Hono();

// Every route here is an inert stub: it reads nothing, writes nothing, and
// returns an empty object. They remain registered, but as operator ingress —
// an organization-management path that answers anonymous callers is exactly
// the unaccounted-for surface this rail exists to close.
orgRoutes.post(
  "/",
  admitHttpRoute(createOrganizationRouteOperationDefinition, async (c) => {
    return c.json({});
  }),
);

orgRoutes.put(
  "/:organizationId",
  admitHttpRoute(updateOrganizationRouteOperationDefinition, async (c) => {
    return c.json({});
  }),
);

orgRoutes.get(
  "/:organizationId",
  admitHttpRead(getOrganizationRouteReadDefinition, async (c) => {
    return c.json({});
  }),
);

// List organizations for user
orgRoutes.get(
  "/users/me/organizations",
  admitHttpRead(listMyOrganizationsRouteReadDefinition, async (c) => {
    return c.json({});
  }),
);

orgRoutes.delete(
  "/:organizationId",
  admitHttpRoute(deleteOrganizationRouteOperationDefinition, async (c) => {
    return c.json({});
  }),
);

export { orgRoutes };
