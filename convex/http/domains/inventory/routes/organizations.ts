import { Hono } from "hono";
import { HonoWithConvex } from "convex-helpers/server/hono";
import { ActionCtx } from "../../../../_generated/server";

const orgRoutes: HonoWithConvex<ActionCtx> = new Hono();

orgRoutes.post("/", async (c) => {
  const data = await c.req.json();

  return c.json({});
});

orgRoutes.put("/:organizationId", async (c) => {
  const { organizationId } = c.req.param();

  const data = await c.req.json();

  return c.json({});
});

orgRoutes.get("/:organizationId", async (c) => {
  const { organizationId } = c.req.param();

  return c.json({});
});

// List organizations for user
orgRoutes.get("/users/me/organizations", async (c) => {
  return c.json({});
});

orgRoutes.delete("/:organizationId", async (c) => {
  const { organizationId } = c.req.param();
  return c.json({});
});

export { orgRoutes };
