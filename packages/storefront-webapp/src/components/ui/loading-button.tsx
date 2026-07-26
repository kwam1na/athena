import * as React from "react";
import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";
import { Icons } from "./icons";

export interface LoadingButtonProps extends ButtonProps {
  isLoading: boolean;
  loadingLabel?: string;
}

export const LoadingButton = React.forwardRef<
  HTMLButtonElement,
  LoadingButtonProps
>(
  (
    {
      isLoading,
      loadingLabel,
      children,
      className,
      disabled,
      ...props
    },
    ref,
  ) => (
    <Button
      ref={ref}
      {...props}
      className={cn("relative", className)}
      disabled={disabled || isLoading}
      aria-busy={isLoading || undefined}
    >
      <span className={cn(isLoading && "invisible")}>{children}</span>
      {isLoading && (
        <span
          className="absolute inset-0 flex items-center justify-center"
          aria-hidden="true"
        >
          <Icons.spinner className="h-4 w-4 animate-spin motion-reduce:animate-none" />
        </span>
      )}
      {isLoading && loadingLabel && (
        <span className="sr-only" aria-live="polite">
          {loadingLabel}
        </span>
      )}
    </Button>
  ),
);
LoadingButton.displayName = "LoadingButton";
