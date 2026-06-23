import type { ElementType, ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { cn } from "@/lib/utils";
import { NavigateBackButton } from "./PageHeader";

type PageLevelHeaderProps = {
  animateContent?: boolean;
  backButtonLabel?: string;
  contentKey?: string;
  eyebrow?: string;
  title: string;
  description?: ReactNode;
  className?: string;
  onNavigateBack?: () => void;
  showBackButton?: boolean;
  showBottomBorder?: boolean;
};

export function PageLevelHeader({
  animateContent = false,
  backButtonLabel,
  contentKey,
  eyebrow,
  title,
  description,
  className,
  onNavigateBack,
  showBackButton = false,
  showBottomBorder = false,
}: PageLevelHeaderProps) {
  const titleClassName =
    "font-display text-4xl leading-tight tracking-normal text-foreground sm:text-[clamp(2.75rem,4.6vw,4.75rem)] sm:leading-[0.95] sm:tracking-[-0.05em]";
  const descriptionClassName =
    "max-w-3xl text-sm leading-6 text-muted-foreground md:text-lg md:leading-7";
  const animatedContentKey = contentKey ?? title;
  const textTransition = {
    duration: 0.2,
    ease: "easeIn" as const,
  };
  const exitTransition = {
    duration: 0.15,
    ease: "easeIn" as const,
  };

  return (
    <header
      className={cn(
        "max-w-4xl space-y-layout-sm",
        showBottomBorder ? "border-b border-border pb-layout-lg" : null,
        className,
      )}
    >
      {showBackButton ? (
        <NavigateBackButton label={backButtonLabel} onNavigateBack={onNavigateBack} />
      ) : null}
      {eyebrow ? (
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <div className="space-y-3">
        {animateContent ? (
          <>
            <AnimatePresence initial={false} mode="wait">
              <motion.h1
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                className={titleClassName}
                exit={{
                  opacity: 0,
                  y: 8,
                  filter: "blur(3px)",
                  transition: exitTransition,
                }}
                initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
                key={`title-${animatedContentKey}`}
                transition={textTransition}
              >
                {title}
              </motion.h1>
            </AnimatePresence>
            {description ? (
              <AnimatePresence initial={false} mode="wait">
                <motion.p
                  animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                  className={descriptionClassName}
                  exit={{
                    opacity: 0,
                    y: 8,
                    filter: "blur(3px)",
                    transition: exitTransition,
                  }}
                  initial={{ opacity: 0, y: 8, filter: "blur(3px)" }}
                  key={`description-${animatedContentKey}`}
                  transition={textTransition}
                >
                  {description}
                </motion.p>
              </AnimatePresence>
            ) : null}
          </>
        ) : (
          <>
            <h1 className={titleClassName}>{title}</h1>
            {description ? (
              <p className={descriptionClassName}>{description}</p>
            ) : null}
          </>
        )}
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
