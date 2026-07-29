import { Outlet, useRouterState } from "@tanstack/react-router";

import { InventoryImportView } from "~/src/components/operations/InventoryImportView";

export function InventoryImportRoute() {
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });

  if (!pathname.endsWith("/operations/inventory-import")) {
    return <Outlet />;
  }

  return <InventoryImportView mode="import" />;
}
