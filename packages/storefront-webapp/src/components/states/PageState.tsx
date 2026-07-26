import * as React from "react";
import {
  AlertCircle,
  CheckCircle2,
  CircleSlash2,
  Info,
  LoaderCircle,
} from "lucide-react";

import { cn } from "@/lib/utils";

export type PageStateKind =
  | "loading"
  | "empty"
  | "error"
  | "terminal"
  | "unavailable"
  | "success";

const stateIcons = {
  loading: LoaderCircle,
  empty: Info,
  error: AlertCircle,
  terminal: CircleSlash2,
  unavailable: CircleSlash2,
  success: CheckCircle2,
} as const;

export interface PageStateProps
  extends Omit<React.HTMLAttributes<HTMLDivElement>, "title"> {
  state: PageStateKind;
  title: React.ReactNode;
  description?: React.ReactNode;
  primaryAction?: React.ReactNode;
  secondaryAction?: React.ReactNode;
  icon?: React.ReactNode;
  inline?: boolean;
}

function PageState({
  state,
  title,
  description,
  primaryAction,
  secondaryAction,
  icon,
  inline = false,
  className,
  ...props
}: PageStateProps) {
  const Icon = stateIcons[state];
  const isLoading = state === "loading";
  const isUrgent = state === "error" || state === "terminal";

  return (
    <div
      role={isUrgent ? "alert" : "status"}
      aria-live={isUrgent ? "assertive" : "polite"}
      aria-busy={isLoading || undefined}
      data-state={state}
      className={cn(
        "flex w-full flex-col items-center justify-center gap-4 text-center",
        inline ? "min-h-32 p-4" : "min-h-96 p-8",
        className,
      )}
      {...props}
    >
      {icon ?? (
        <Icon
          aria-hidden="true"
          className={cn(
            "h-6 w-6 text-muted-foreground",
            isLoading && "animate-spin motion-reduce:animate-none",
            (state === "error" || state === "terminal") && "text-danger",
            state === "unavailable" && "text-warning",
            state === "success" && "text-success",
          )}
        />
      )}
      <div className="max-w-md space-y-2">
        <h2 className="text-xl font-semibold text-foreground">{title}</h2>
        {description && (
          <p className="text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {(primaryAction || secondaryAction) && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          {primaryAction}
          {secondaryAction}
        </div>
      )}
    </div>
  );
}

function getCustomerErrorMessage(error: unknown): string {
  if (
    error instanceof Error &&
    /network|failed to fetch|connection/i.test(error.message)
  ) {
    return "We're having trouble connecting. Check your connection and try again.";
  }

  return "Something went wrong. Try again, or return to the storefront.";
}

export { PageState, getCustomerErrorMessage };
