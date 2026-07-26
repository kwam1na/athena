import * as React from "react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "./button";

export interface IconButtonProps
  extends Omit<ButtonProps, "aria-label" | "asChild" | "size"> {
  label: string;
}

const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ label, className, children, type = "button", ...props }, ref) => (
    <Button
      ref={ref}
      size="icon"
      type={type}
      aria-label={label}
      className={cn("min-h-control-standard min-w-control-standard", className)}
      {...props}
    >
      {children}
    </Button>
  ),
);
IconButton.displayName = "IconButton";

export { IconButton };
