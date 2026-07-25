import { useEffect } from "react";

import { UpdateReadyBanner } from "@/components/app-update/UpdateReadyBanner";
import { useNavigationKeyboardShortcuts } from "@/hooks/use-navigation-keyboard-shortcuts";
import Layout from "./-authed-layout";

export function AuthenticatedLayout() {
  useNavigationKeyboardShortcuts();

  // Mark <html> so the default app zoom (desktop only, see index.css) applies
  // to the authenticated app but not to public/auth pages. Toggled here on
  // mount/unmount rather than in CSS because the scale is route-scoped.
  useEffect(() => {
    document.documentElement.classList.add("app-scaled");
    return () => document.documentElement.classList.remove("app-scaled");
  }, []);

  return (
    <>
      <UpdateReadyBanner />
      <Layout />
    </>
  );
}
