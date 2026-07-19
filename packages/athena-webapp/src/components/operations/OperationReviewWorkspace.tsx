import type { ComponentProps, ReactNode } from "react";

import { cn } from "@/lib/utils";

import View from "../View";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";
import { TabsList, TabsTrigger } from "../ui/tabs";

export function OperationReviewBucketTabsList({
  className,
  ...props
}: ComponentProps<typeof TabsList>) {
  return (
    <TabsList
      className={cn(
        "h-auto w-full flex-wrap justify-start gap-1 rounded-lg border border-border bg-surface-raised p-1 text-muted-foreground shadow-none",
        className,
      )}
      {...props}
    />
  );
}

export function OperationReviewBucketTabTrigger({
  className,
  ...props
}: ComponentProps<typeof TabsTrigger>) {
  return (
    <TabsTrigger
      className={cn(
        "min-h-9 gap-2 rounded-none border-b-2 border-transparent px-3 data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none",
        className,
      )}
      {...props}
    />
  );
}

export function OperationReviewBucketShell({
  className,
  role = "region",
  ...props
}: ComponentProps<"section">) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-lg border border-border",
        className,
      )}
      role={role}
      {...props}
    />
  );
}

export function OperationReviewBucketHeader({
  className,
  ...props
}: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "flex flex-col gap-layout-sm border-b border-border/80 bg-surface-raised px-layout-md py-layout-md md:flex-row md:items-start md:justify-between",
        className,
      )}
      {...props}
    />
  );
}

export function OperationReviewBucketBody({
  className,
  hasItems,
  ...props
}: ComponentProps<"div"> & { hasItems: boolean }) {
  return (
    <div
      className={cn(
        "bg-surface-raised",
        hasItems ? "space-y-layout-sm p-layout-sm" : "py-layout-md",
        className,
      )}
      {...props}
    />
  );
}

export function OperationReviewRailShell({
  className,
  ...props
}: ComponentProps<"aside">) {
  return (
    <aside
      className={cn(
        "rounded-lg border border-border bg-transparent p-layout-md",
        className,
      )}
      {...props}
    />
  );
}

type OperationReviewWorkspaceProps = {
  actions?: ReactNode;
  afterGrid?: ReactNode;
  beforeMetrics?: ReactNode;
  description: ReactNode;
  eyebrow: string;
  isLoading?: boolean;
  loadingContent?: ReactNode;
  main: ReactNode;
  metrics: ReactNode;
  rail: ReactNode;
  showBackButton?: boolean;
  statusDescription: ReactNode;
  statusTitle: ReactNode;
  title: string;
};

export function OperationReviewWorkspace({
  actions,
  afterGrid,
  beforeMetrics,
  description,
  eyebrow,
  isLoading = false,
  loadingContent = null,
  main,
  metrics,
  rail,
  showBackButton = false,
  statusDescription,
  statusTitle,
  title,
}: OperationReviewWorkspaceProps) {
  return (
    <View hideBorder hideHeaderBottomBorder scrollMode="page">
      <FadeIn className="container mx-auto py-layout-xl">
        <PageWorkspace>
          <PageLevelHeader
            description={description}
            eyebrow={eyebrow}
            showBackButton={showBackButton}
            title={title}
          />

          {isLoading ? (
            loadingContent
          ) : (
            <PageWorkspace>
              <section className="space-y-layout-xl">
                <div className="flex flex-col gap-layout-md lg:flex-row lg:items-end lg:justify-between">
                  <div className="space-y-layout-xs">
                    {statusTitle}
                    <div className="max-w-2xl text-sm leading-6 text-muted-foreground">
                      {statusDescription}
                    </div>
                  </div>
                  {actions ? (
                    <div className="flex flex-col gap-layout-sm sm:flex-row sm:items-center">
                      {actions}
                    </div>
                  ) : null}
                </div>

                {beforeMetrics}

                <div className="grid gap-layout-lg md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-5">
                  {metrics}
                </div>
              </section>

              <PageWorkspaceGrid>
                <PageWorkspaceMain>{main}</PageWorkspaceMain>
                {rail}
              </PageWorkspaceGrid>

              {afterGrid}
            </PageWorkspace>
          )}
        </PageWorkspace>
      </FadeIn>
    </View>
  );
}
