import type { ReactNode } from "react";

import {
  AppMessagesProvider,
  useHasAppMessagesProvider,
} from "@/lib/app-messages";

export function UpdateCommunicationPreferenceProvider({
  children,
}: {
  children: ReactNode;
}) {
  const hasAppMessagesProvider = useHasAppMessagesProvider();
  if (hasAppMessagesProvider) {
    return <>{children}</>;
  }

  return <AppMessagesProvider>{children}</AppMessagesProvider>;
}
