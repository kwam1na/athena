import { createFileRoute } from "@tanstack/react-router";
import { Login } from "~/src/components/auth/Login";

export const Route = createFileRoute("/login/_layout/")({
  component: Login,
});
