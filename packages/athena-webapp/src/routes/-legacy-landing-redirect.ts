import { redirect } from "@tanstack/react-router";

import { PUBLIC_HOME_PATH } from "@/lib/navigation/appEntryRoutes";

export function redirectLegacyLanding() {
  throw redirect({ to: PUBLIC_HOME_PATH, replace: true });
}
