import {
  Link,
  Outlet,
  useLocation,
  useNavigate,
  useParams,
  useSearch,
} from "@tanstack/react-router";

import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
} from "@/components/common/PageLevelHeader";
import { cn } from "@/lib/utils";
import { ReportsWorkspaceControls } from "./ReportsWorkspaceControls";

const REPORT_TABS = [
  {
    label: "Overview",
    suffix: "",
    to: "/$orgUrlSlug/store/$storeUrlSlug/reports",
  },
  {
    label: "Items",
    suffix: "/items",
    to: "/$orgUrlSlug/store/$storeUrlSlug/reports/items",
  },
  {
    label: "Inventory",
    suffix: "/inventory",
    to: "/$orgUrlSlug/store/$storeUrlSlug/reports/inventory",
  },
  {
    label: "Storefront",
    suffix: "/storefront",
    to: "/$orgUrlSlug/store/$storeUrlSlug/reports/storefront",
  },
] as const;

function reportWorkspaceSearch(
  current: Record<string, unknown>,
  preserveCustomRun: boolean,
): Record<string, unknown> {
  return {
    ...(current.comparison === undefined
      ? {}
      : { comparison: current.comparison }),
    ...(current.end === undefined ? {} : { end: current.end }),
    ...(current.preset === undefined ? {} : { preset: current.preset }),
    ...(preserveCustomRun &&
    current.preset === "custom" &&
    current.runId !== undefined
      ? { runId: current.runId }
      : {}),
    ...(current.start === undefined ? {} : { start: current.start }),
  };
}

export function shouldShowReportPeriodControls(pathname: string) {
  return !pathname.includes("/reports/storefront");
}

export function ReportsLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });
  const search = useSearch({ strict: false });
  const showPeriodControls = shouldShowReportPeriodControls(location.pathname);
  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      scrollMode="page"
    >
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store performance"
            title="Reports"
            description="Track money, item movement, inventory exposure, and the work that needs attention."
          />
          <nav
            aria-label="Reports views"
            className="overflow-x-auto border-b border-border"
          >
            <div className="flex min-w-max gap-layout-lg" role="list">
              {REPORT_TABS.map((tab) => {
                const active = tab.suffix
                  ? location.pathname.includes(`/reports${tab.suffix}`)
                  : /\/reports\/?$/.test(location.pathname);
                return (
                  <Link
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "border-b-2 border-transparent px-1 py-3 text-sm font-medium text-muted-foreground",
                      active && "border-foreground text-foreground",
                    )}
                    key={tab.label}
                    params={{
                      orgUrlSlug: orgUrlSlug!,
                      storeUrlSlug: storeUrlSlug!,
                    }}
                    search={(current) =>
                      reportWorkspaceSearch(
                        current,
                        tab.label !== "Storefront",
                      )
                    }
                    to={tab.to}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          </nav>
          {showPeriodControls ? (
            <ReportsWorkspaceControls
              onSearchChange={(next) => {
                void navigate({
                  replace: true,
                  search: ((current: Record<string, unknown>) => ({
                    ...current,
                    ...next,
                  })) as never,
                });
              }}
              search={search}
            />
          ) : null}
          <Outlet />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
