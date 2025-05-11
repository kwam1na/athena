import Footer from "@/components/footer/Footer";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_ordersLayout")({
  component: LayoutComponent,
});

function LayoutComponent() {
  return (
    <div className="mx-auto">
      <Outlet />
    </div>
  );
}
