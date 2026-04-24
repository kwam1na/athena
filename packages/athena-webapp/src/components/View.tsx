import { cn } from "@/lib/utils";
import React, { useEffect } from "react";

export default function View({
  children,
  className,
  contentClassName,
  header,
  headerClassName,
  mainClassName,
  hideHeaderBottomBorder = false,
  hideBorder = false,
  width = "contained",
}: {
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  header?: React.ReactNode;
  headerClassName?: string;
  mainClassName?: string;
  hideHeaderBottomBorder?: boolean;
  hideBorder?: boolean;
  width?: "contained" | "full";
}) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <section
      className={cn(
        width === "full"
          ? "w-full max-w-none px-4 sm:px-6 lg:px-8"
          : "container mx-auto",
        className,
      )}
    >
      <div
        className={cn(
          "h-full rounded-lg",
          !hideBorder && "border",
          contentClassName,
        )}
      >
        {header && (
          <header
            className={cn(
              "overflow-hidden",
              !hideHeaderBottomBorder && "border-b",
              headerClassName,
            )}
          >
            {header}
          </header>
        )}
        <main className={mainClassName}>{children}</main>
      </div>
    </section>
  );
}
