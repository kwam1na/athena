import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type FinancialValueProps = {
  canView: boolean;
  children: ReactNode;
  className?: string;
  label?: string;
};

export function FinancialValue({
  canView,
  children,
  className,
  label = "Financial detail",
}: FinancialValueProps) {
  if (canView) {
    return <>{children}</>;
  }

  return (
    <span
      aria-label={`${label} hidden until manager access is active`}
      className={cn(
        "inline-flex min-w-[6.5rem] items-center justify-center rounded-md border border-border bg-muted/60 px-2 py-0.5 text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      Manager only
    </span>
  );
}
