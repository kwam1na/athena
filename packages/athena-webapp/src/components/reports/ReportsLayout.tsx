import { Link, Outlet, useLocation, useParams } from "@tanstack/react-router";

import View from "@/components/View";
import { FadeIn } from "@/components/common/FadeIn";
import { PageLevelHeader, PageWorkspace } from "@/components/common/PageLevelHeader";
import { cn } from "@/lib/utils";

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
] as const;

export function ReportsLayout() {
  const location = useLocation();
  const { orgUrlSlug, storeUrlSlug } = useParams({ strict: false });

  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            eyebrow="Store performance"
            title="Reports"
            description="Track sales, item movement, and reconciliation status."
          />
          <nav aria-label="Reports views" className="overflow-x-auto border-b border-border">
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
                      active && "border-primary text-primary",
                    )}
                    key={tab.label}
                    params={{ orgUrlSlug: orgUrlSlug!, storeUrlSlug: storeUrlSlug! }}
                    to={tab.to}
                  >
                    {tab.label}
                  </Link>
                );
              })}
            </div>
          </nav>
          <Outlet />
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
