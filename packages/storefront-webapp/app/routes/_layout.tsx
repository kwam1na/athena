import Footer from "@/components/footer/Footer";
import { createFileRoute, Outlet } from "@tanstack/react-router";

function LayoutComponent() {
  return (
    <>
      <Outlet />
      <Footer />
    </>
  );
}

export const Route = createFileRoute("/_layout")({
  component: LayoutComponent,
});
