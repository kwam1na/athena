import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, CircleAlert, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const statusBadgeVariants = cva(
  "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
  {
    variants: {
      tone: {
        neutral: "border-border bg-muted text-muted-foreground",
        success: "border-success/20 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning-foreground",
        danger: "border-danger/20 bg-danger/10 text-danger",
        info: "border-info/20 bg-info/10 text-info",
      },
    },
    defaultVariants: {
      tone: "neutral",
    },
  },
);

const toneIcons = {
  neutral: null,
  success: CheckCircle2,
  warning: CircleAlert,
  danger: AlertCircle,
  info: Info,
} as const;

export interface StatusBadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof statusBadgeVariants> {
  showIcon?: boolean;
}

function StatusBadge({
  className,
  tone = "neutral",
  showIcon = true,
  children,
  ...props
}: StatusBadgeProps) {
  const Icon = toneIcons[tone ?? "neutral"];

  return (
    <span
      className={cn(statusBadgeVariants({ tone }), className)}
      data-tone={tone}
      {...props}
    >
      {showIcon && Icon && <Icon aria-hidden="true" className="h-3.5 w-3.5" />}
      {children}
    </span>
  );
}

export { StatusBadge, statusBadgeVariants };
