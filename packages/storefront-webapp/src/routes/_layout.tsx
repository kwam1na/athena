import Footer from "@/components/footer/Footer";
import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useEffect } from "react";

function LayoutComponent() {
  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();

  useEffect(() => {
    setNavBarLayout("fixed");
    setAppLocation("shop");
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
