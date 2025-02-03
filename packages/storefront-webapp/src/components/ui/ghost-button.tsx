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
        `${selected ? "border border-[#EC4683] text-[#EC4683] shadow-md" : "border border-background-muted"} hover:shadow-md hover:border-[#EC4683]`,
        className
      )}
    >
      {children}
    </Button>
  );
};
