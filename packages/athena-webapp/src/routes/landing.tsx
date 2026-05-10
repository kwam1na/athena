import { createFileRoute } from "@tanstack/react-router";

import { AthenaLandingPage } from "@/components/landing/AthenaLandingPage";

export const Route = createFileRoute("/landing")({
  component: AthenaLandingPage,
});
