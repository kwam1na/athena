import * as React from "react";
import { Button, ButtonProps } from "./button";
import { cn } from "@/lib/utils";

interface GhostButtonProps extends ButtonProps {
  selected?: boolean;
}

export const GhostButton: React.FC<GhostButtonProps> = ({
  selected,
  children,
  className,
  ...props
}) => {
  return (
    <Button
      variant={"ghost"}
      {...props}
      className={cn(
        `${selected ? "border border-black" : "border border-background-muted"}`,
        className
      )}
    >
      {children}
    </Button>
  );
};
