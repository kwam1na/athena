import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/start";
import { useAppSession } from "@/utils/session";
import { deleteCookie } from "vinxi/http";

const logoutFn = createServerFn("POST", async () => {
  const session = await useAppSession();

  session.clear();

  deleteCookie("athena-user-id");

  throw redirect({
    href: "/login",
  });
});

export const Route = createFileRoute("/logout")({
  preload: false,
  loader: () => logoutFn(),
});
