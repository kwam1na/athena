import { createFileRoute } from "@tanstack/react-router";
import { redirectLegacyLanding } from "./-legacy-landing-redirect";

export const Route = createFileRoute("/landing")({
  beforeLoad: redirectLegacyLanding,
});
