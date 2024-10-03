import { Hono } from "hono";
import { organizationsRepository } from "@athena/db";

const orgRoutes = new Hono();

orgRoutes.post("/", async (c) => {
  const data = await c.req.json();

  const newOrg = await organizationsRepository.create(data);

  return c.json(newOrg, 201);
});

orgRoutes.put("/:organizationId", async (c) => {
  const { organizationId } = c.req.param();

  const data = await c.req.json();

  const updatedOrg = await organizationsRepository.update(
    parseInt(organizationId),
    data
  );

  return updatedOrg
    ? c.json(updatedOrg)
    : c.json({ error: "Yuhh, Not found" }, 404);
});

orgRoutes.get("/:organizationId", async (c) => {
  const { organizationId } = c.req.param();

  const org = await organizationsRepository.getById(parseInt(organizationId));

  return org ? c.json(org) : c.json({ error: "Yuh, Not found" }, 404);
});

// List organizations for user
orgRoutes.get("/users/me/organizations", async (c) => {
  const organizations = await organizationsRepository.getOrganizationsForUser(
    1
  );
  return c.json({ organizations });
});

orgRoutes.delete("/:organizationId", async (c) => {
  const { organizationId } = c.req.param();
  const result = await organizationsRepository.delete(parseInt(organizationId));
  return result
    ? c.json({ message: "Deleted" })
    : c.json({ error: "Not found" }, 404);
});

export { orgRoutes };
