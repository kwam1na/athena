import { createFileRoute, Outlet } from "@tanstack/react-router";

function LayoutComponent() {
  return (
    <div>
      <Outlet />
    </div>
  );
}

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});
