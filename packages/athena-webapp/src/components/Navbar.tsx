import {
  Link,
  useLoaderData,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StoresAccordion } from "./StoresAccordion";
import { getAllOrganizations } from "@/api/organization";
import OrganizationSwitcher from "./organization-switcher";
import { StoreAccordion } from "./StoreAccordion";
import { Button } from "./ui/button";
import { ArrowLeftIcon, ChevronLeftIcon } from "@radix-ui/react-icons";
import { StoresSettingsAccordion } from "../settings/store/StoresSettingsAccordion";
import { OrganizationSettingsAccordion } from "@/settings/organization/components/OrganizationsSettingsAccordion";
import { Organization } from "@athena/db";
import { useAppLayout } from "@/contexts/AppLayoutContext";
import { ArrowLeftToLine, ArrowRightFromLine } from "lucide-react";
import { StoresDropdown } from "./StoresDropdown";
import { StoreDropdown } from "./StoreDropdown";
import { useGetOrganizations } from "@/hooks/useGetOrganizations";

function SettingsHeader() {
  const navigate = useNavigate();
  const { storeUrlSlug, orgUrlSlug } = useParams({ strict: false });

  const handleGoBack = () => {
    if (storeUrlSlug) {
      navigate({
        to: "/$orgUrlSlug/store/$storeUrlSlug",
        params: (prev) => {
          return {
            ...prev,
            orgUrlSlug: prev.orgUrlSlug!,
            storeUrlSlug,
          };
        },
      });
    } else {
      navigate({
        to: "/$orgUrlSlug/store",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: prev.orgUrlSlug!,
        }),
      });
    }
  };

  return (
    <div className="flex items-center gap-1 h-[56px] px-2">
      <Button
        variant="ghost"
        className="h-8 px-2 lg:px-3"
        onClick={handleGoBack}
      >
        <ChevronLeftIcon className="h-4 w-4" />
      </Button>
      <p className="text-sm">Settings</p>
    </div>
  );
}

const Header = () => {
  const organizations = useGetOrganizations();

  return (
    <div className="flex items-center justify-between h-[56px]">
      <div className="flex items-center gap-2">
        <Link href={"/"} className="flex items-center">
          <p className="font-medium">athena</p>
        </Link>
        <p className="text-muted-foreground">/</p>
        <OrganizationSwitcher items={organizations || []} />
      </div>
    </div>
  );
};

const Navbar = () => {
  const router = useRouterState();

  const currentPath = router.location.pathname;

  const isOnSettings = currentPath.includes("settings");

  return (
    <section className={`px-8 border-b w-full flex-none space-y-4`}>
      <Header />
    </section>
  );
};

export default Navbar;
