import SavedBag from "@/components/saved-items/SavedBag";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/shop/saved/")({
  component: SavedBag,
});
