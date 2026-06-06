import { createFileRoute } from "@tanstack/react-router";

import { AthenaBoundaryWalkthrough } from "@/components/architecture/AthenaBoundaryWalkthrough";

export const Route = createFileRoute("/athena-boundaries")({
  component: AthenaBoundaryWalkthrough,
});
