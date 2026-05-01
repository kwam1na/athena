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
  lockDocumentScroll = true,
  fullHeight = true,
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
  lockDocumentScroll?: boolean;
  fullHeight?: boolean;
}) {
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (!lockDocumentScroll) {
      return;
    }
    const htmlStyle = document.documentElement.style;
    const bodyStyle = document.body.style;
    const previousHtmlOverflow = htmlStyle.overflow;
    const previousHtmlOverscrollBehaviorY = htmlStyle.overscrollBehaviorY;
    const previousBodyOverflow = bodyStyle.overflow;
    const previousBodyOverscrollBehaviorY = bodyStyle.overscrollBehaviorY;
    htmlStyle.overflow = "hidden";
    htmlStyle.overscrollBehaviorY = "none";
    bodyStyle.overflow = "hidden";
    bodyStyle.overscrollBehaviorY = "none";
    return () => {
      htmlStyle.overflow = previousHtmlOverflow;
      htmlStyle.overscrollBehaviorY = previousHtmlOverscrollBehaviorY;
      bodyStyle.overflow = previousBodyOverflow;
      bodyStyle.overscrollBehaviorY = previousBodyOverscrollBehaviorY;
    };
  }, [lockDocumentScroll]);

  return (
    <section
      className={cn(
        width === "full"
          ? "w-full max-w-none px-4 sm:px-6 lg:px-8"
          : "container mx-auto w-full min-w-0 px-4 sm:px-6 lg:px-8",
        fullHeight &&
          "h-[calc(100dvh-2.5rem)] max-h-[calc(100dvh-2.5rem)] min-h-0",
        "overflow-x-hidden",
        className,
      )}
    >
      <div
        className={cn(
          "h-full min-h-0 flex flex-col rounded-lg min-w-0 overflow-x-hidden",
          fullHeight && "min-h-0 overflow-hidden",
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
        <main
          className={cn(
            fullHeight &&
              "min-h-0 flex-1 overflow-y-auto overflow-x-hidden scrollbar-hide",
            mainClassName,
          )}
        >
          {children}
        </main>
      </div>
    </section>
  );
}
