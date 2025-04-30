import { Products } from "@/app/components/Products";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/products/")({
  component: Products,
});
