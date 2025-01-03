import {
  Link,
  useLoaderData,
  useNavigate,
  useParams,
  useRouterState,
} from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { StoresAccordion } from "./StoresAccordion";
import OrganizationSwitcher from "./organization-switcher";
import { StoreAccordion } from "./StoreAccordion";
import { Button } from "./ui/button";
import { ArrowLeftIcon, ChevronLeftIcon } from "@radix-ui/react-icons";
import { StoresSettingsAccordion } from "../settings/store/StoresSettingsAccordion";
import { OrganizationSettingsAccordion } from "@/settings/organization/components/OrganizationsSettingsAccordion";
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

  const { isSidebarCollapsed, isSidebarExpanded, setSidebarState } =
    useAppLayout();

  const icon = isSidebarCollapsed ? (
    <ArrowRightFromLine className="w-5 h-5 text-muted-foreground" />
  ) : (
    <ArrowLeftToLine className="w-5 h-5 text-muted-foreground" />
  );

  return (
    <div className="flex items-center justify-between h-[56px]">
      {isSidebarExpanded && (
        <div className="flex items-center gap-2">
          <Link href={"/"} className="flex items-center">
            <p className="font-medium">athena</p>
          </Link>
          <p className="text-muted-foreground">/</p>
          <OrganizationSwitcher items={organizations || []} />
        </div>
      )}

      {/* <Button
        onClick={() => {
          const newState = isSidebarCollapsed ? "expanded" : "collapsed";
          setSidebarState(newState);
        }}
        variant={"ghost"}
      >
        {icon}
      </Button> */}
    </div>
  );
};

const Sidebar = () => {
  const router = useRouterState();

  const currentPath = router.location.pathname;

  const isOnSettings = currentPath.includes("settings");

  const { isSidebarCollapsed } = useAppLayout();

  return (
    <section
      className={`bg-zinc-50 ${isSidebarCollapsed ? "w-[80px]" : "w-[320px]"} flex-none space-y-4 h-full rounded-md`}
    >
      {!isOnSettings && <Header />}
      {isOnSettings && <SettingsHeader />}

      {!isOnSettings && (
        <div className="flex flex-col space-y-4 px-4">
          {isSidebarCollapsed ? (
            <>
              <StoresDropdown />
              <StoreDropdown />
            </>
          ) : (
            <>
              <StoresAccordion />
              <StoreAccordion />
            </>
          )}
        </div>
      )}

      {isOnSettings && (
        <div className="flex flex-col space-y-4 px-4">
          <OrganizationSettingsAccordion />
          <StoresSettingsAccordion />
        </div>
      )}
    </section>
  );
};

export default Sidebar;
