import { organizationsRepository } from "@athena/db";
import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { getCookie } from "vinxi/http";

export const getOrganization = createServerFn("GET", (slug: string) => {
  return organizationsRepository.getBySlug(slug);
});

export const getOrganizations = createServerFn("GET", async () => {
  const userId = getCookie("athena-user-id");

  if (!userId) {
    throw redirect({ to: "/login" });
  }

  return organizationsRepository.getOrganizationsForUser(parseInt(userId));
});
