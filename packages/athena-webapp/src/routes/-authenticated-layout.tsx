import { UpdateReadyBanner } from "@/components/app-update/UpdateReadyBanner";
import { useNavigationKeyboardShortcuts } from "@/hooks/use-navigation-keyboard-shortcuts";
import Layout from "./-authed-layout";

export function AuthenticatedLayout() {
  useNavigationKeyboardShortcuts();

  return (
    <>
      <UpdateReadyBanner />
      <Layout />
    </>
  );
}
