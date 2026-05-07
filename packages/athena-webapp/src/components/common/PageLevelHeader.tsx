import type { ElementType, ReactNode } from "react";

import { cn } from "@/lib/utils";

type PageLevelHeaderProps = {
  eyebrow: string;
  title: string;
  description: ReactNode;
  className?: string;
};

export function PageLevelHeader({
  eyebrow,
  title,
  description,
  className,
}: PageLevelHeaderProps) {
  return (
    <header
      className={cn(
        "max-w-4xl space-y-layout-sm border-b border-border pb-layout-lg",
        className,
      )}
    >
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
        {eyebrow}
      </p>
      <div className="space-y-3">
        <h1 className="font-display text-[clamp(2.75rem,4.6vw,4.75rem)] leading-[0.95] tracking-[-0.05em] text-foreground">
          {title}
        </h1>
        <p className="max-w-3xl text-base leading-7 text-muted-foreground md:text-lg">
          {description}
        </p>
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
    <Component className={cn("min-w-0 space-y-layout-2xl", className)}>
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
        "grid gap-layout-2xl xl:grid-cols-[minmax(0,1fr)_320px]",
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
    <Component className={cn("min-w-0 space-y-layout-3xl", className)}>
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
    <Component className={cn("flex flex-col gap-layout-lg", className)}>
      {children}
    </Component>
  );
}
