import { createFileRoute } from "@tanstack/react-router";
import { LoginLayout } from "./-login-layout";

export const Route = createFileRoute("/login/_layout")({
  component: LoginLayout,
});
