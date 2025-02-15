import { useNavigationBarContext } from "@/contexts/NavigationBarProvider";
import { useEffect } from "react";

export const AuthComponent = ({ children }: { children: React.ReactNode }) => {
  const { setNavBarLayout, setAppLocation } = useNavigationBarContext();

  useEffect(() => {
    setNavBarLayout("fixed");
    setAppLocation("shop");
  }, []);

  return <>{children}</>;
};
