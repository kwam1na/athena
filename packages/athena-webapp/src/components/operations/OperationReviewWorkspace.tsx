import type { ReactNode } from "react";

import View from "../View";
import { FadeIn } from "../common/FadeIn";
import {
  PageLevelHeader,
  PageWorkspace,
  PageWorkspaceGrid,
  PageWorkspaceMain,
} from "../common/PageLevelHeader";

type OperationReviewWorkspaceProps = {
  actions?: ReactNode;
  afterGrid?: ReactNode;
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
