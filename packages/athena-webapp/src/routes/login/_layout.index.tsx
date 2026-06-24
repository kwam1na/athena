import { createFileRoute } from "@tanstack/react-router";
import { AthenaLoginReadyView } from "./-login-ready-view";

export const Route = createFileRoute("/login/_layout/")({
  component: AthenaLoginReadyView,
});
