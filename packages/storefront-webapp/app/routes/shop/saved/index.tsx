import SavedBag from "@/components/saved-items/SavedBag";
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shop/saved/")({
  component: SavedBag,
});
