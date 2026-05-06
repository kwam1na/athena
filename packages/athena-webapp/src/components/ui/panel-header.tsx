import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type PanelHeaderProps = {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  className?: string;
};

export function PanelHeader({
  eyebrow,
  title,
  description,
  className,
}: PanelHeaderProps) {
  return (
    <div className={cn("space-y-2", className)}>
      {eyebrow ? (
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
          {eyebrow}
        </p>
      ) : null}
      <h3 className="text-base font-medium text-foreground">{title}</h3>
      {description ? (
        <p className="text-sm text-muted-foreground">{description}</p>
      ) : null}
    </div>
  );
}
