import Footer from "@/components/footer/Footer";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

function LayoutComponent() {
  const { setNavBarLayout } = useNavigationBarContext();

  useEffect(() => {
    setNavBarLayout("fixed");
  }, []);

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
