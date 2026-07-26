import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertCircle, CheckCircle2, CircleAlert, Info } from "lucide-react";

import { cn } from "@/lib/utils";

const inlineAlertVariants = cva(
  "flex gap-3 rounded-md border p-4 text-sm",
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
  neutral: Info,
  success: CheckCircle2,
  warning: CircleAlert,
  danger: AlertCircle,
  info: Info,
} as const;

export interface InlineAlertProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title">,
    VariantProps<typeof inlineAlertVariants> {
  title?: React.ReactNode;
  announce?: boolean;
}

function InlineAlert({
  className,
  tone = "neutral",
  title,
  announce,
  children,
  ...props
}: InlineAlertProps) {
  const Icon = toneIcons[tone ?? "neutral"];
  const shouldAlert = announce ?? tone === "danger";

  return (
    <div
      role={shouldAlert ? "alert" : "status"}
      aria-live={shouldAlert ? "assertive" : "polite"}
      className={cn(inlineAlertVariants({ tone }), className)}
      data-tone={tone}
      {...props}
    >
      <Icon aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div>{children}</div>}
      </div>
    </div>
  );
}

export { InlineAlert, inlineAlertVariants };
