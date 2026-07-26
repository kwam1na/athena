import { cn } from "@/lib/utils";
import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";

type Props<T extends ElementType = "section"> = {
  as?: T;
  children: ReactNode;
  width?: "content" | "wide" | "full";
  spacing?: "compact" | "default" | "relaxed";
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children">;
const widths = {
  content: "max-w-content",
  wide: "max-w-screen-xl",
  full: "max-w-none",
};
const spaces = {
  compact: "py-layout-sm",
  default: "py-layout-xl",
  relaxed: "py-layout-3xl",
};

export function StorefrontPage<T extends ElementType = "section">({
  as,
  children,
  className,
  width = "content",
  spacing = "default",
  ...props
}: Props<T>) {
  const Component = as ?? "section";
  return (
    <Component
      className={cn(
        "mx-auto w-full px-gutter",
        widths[width],
        spaces[spacing],
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}
