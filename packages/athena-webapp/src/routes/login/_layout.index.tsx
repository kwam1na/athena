import { createFileRoute } from "@tanstack/react-router";
import { Login } from "~/src/components/auth/Login";

export function AthenaLoginReadyView() {
  return (
    <section data-testid="athena-login-ready">
      <Login />
    </section>
  );
}

export const Route = createFileRoute("/login/_layout/")({
  component: AthenaLoginReadyView,
});
