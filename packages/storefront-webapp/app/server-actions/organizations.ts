import { organizationsRepository } from "@athena/db";
import { createServerFn } from "@tanstack/start";

export const getOrganization = createServerFn("GET", (slug: string) => {
  return organizationsRepository.getBySlug(slug);
});
