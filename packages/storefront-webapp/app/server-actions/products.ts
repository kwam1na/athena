import { ProductRequest, productsRepository } from "@athena/db";
import { createServerFn } from "@tanstack/start";

export const getProducts = createServerFn("GET", (storeId: number) => {
  return productsRepository.getAll(storeId);
});

export const getProductById = createServerFn("GET", (id: number) => {
  return productsRepository.getById(id);
});

export const getProductBySlug = createServerFn("GET", (slug: string) => {
  return productsRepository.getBySlug(slug);
});

export const createProduct = createServerFn("POST", (data: ProductRequest) => {
  return productsRepository.create(data);
});
