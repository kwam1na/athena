import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";
import { NavigateBackButton } from "./PageHeader";

type PageLevelHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  className?: string;
  showBackButton?: boolean;
  showBottomBorder?: boolean;
};

export function PageLevelHeader({
  eyebrow,
  title,
  description,
  className,
  showBackButton = false,
  showBottomBorder = false,
}: PageLevelHeaderProps) {
  return (
    <header
      className={cn(
        "max-w-4xl space-y-layout-sm",
        showBottomBorder ? "border-b border-border pb-layout-lg" : null,
        className,
      )}
    >
      {showBackButton ? <NavigateBackButton /> : null}
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <div className="space-y-3">
        <h1 className="font-display text-4xl leading-tight tracking-normal text-foreground sm:text-[clamp(2.75rem,4.6vw,4.75rem)] sm:leading-[0.95] sm:tracking-[-0.05em]">
          {title}
        </h1>
        {description ? (
          <p className="max-w-3xl text-sm leading-6 text-muted-foreground md:text-lg md:leading-7">
            {description}
          </p>
        ) : null}
      </div>
    </header>
  );
}

type PageWorkspaceProps = {
  as?: ElementType;
  children: ReactNode;
  className?: string;
};

export function PageWorkspace({
  as: Component = "section",
  children,
  className,
}: PageWorkspaceProps) {
  return (
    <Component
      className={cn("min-w-0 space-y-layout-xl md:space-y-layout-2xl", className)}
    >
      {children}
    </Component>
  );
}

type PageWorkspaceGridProps = {
  children: ReactNode;
  className?: string;
};

export function PageWorkspaceGrid({
  children,
  className,
}: PageWorkspaceGridProps) {
  return (
    <div
      className={cn(
        "grid gap-layout-xl lg:gap-layout-2xl xl:grid-cols-[minmax(0,1fr)_320px]",
        className,
      )}
    >
      {children}
    </div>
  );
}

type PageWorkspaceStackProps = {
  as?: ElementType;
  children: ReactNode;
  className?: string;
};

export function PageWorkspaceMain({
  as: Component = "section",
  children,
  className,
}: PageWorkspaceStackProps) {
  return (
    <Component
      className={cn("min-w-0 space-y-layout-xl md:space-y-layout-3xl", className)}
    >
      {children}
    </Component>
  );
}

export function PageWorkspaceRail({
  as: Component = "aside",
  children,
  className,
}: PageWorkspaceStackProps) {
  return (
    <Component
      className={cn("flex flex-col gap-layout-md md:gap-layout-lg", className)}
    >
      {children}
    </Component>
  );
}
