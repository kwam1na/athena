import Footer from "@/components/footer/Footer";
import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_layout/_ordersLayout")({
  component: LayoutComponent,
});

function LayoutComponent() {
  return (
    <div className="container mx-auto mx-auto max-w-[1024px] px-6 xl:px-0">
      <Outlet />
    </div>
  );
}
