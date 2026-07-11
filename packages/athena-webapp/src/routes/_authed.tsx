import { createFileRoute } from "@tanstack/react-router";
import { UpdateReadyBanner } from "@/components/app-update/UpdateReadyBanner";
import { useNavigationKeyboardShortcuts } from "@/hooks/use-navigation-keyboard-shortcuts";
import Layout from "./-authed-layout";

export const Route = createFileRoute("/_authed")({
  component: AuthenticatedLayout,
});

export function AuthenticatedLayout() {
  useNavigationKeyboardShortcuts();

  return (
    <>
      <UpdateReadyBanner />
      <Layout />
    </>
  );
}
