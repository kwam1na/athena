import { storeRepository } from "@athena/db";
import { createServerFn } from "@tanstack/start";

export const getStore = createServerFn("GET", (slug: string) => {
  return storeRepository.getBySlug(slug);
});

export const getStores = createServerFn("GET", (organizationId: number) => {
  return storeRepository.getAll(organizationId);
});
