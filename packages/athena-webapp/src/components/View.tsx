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
  lockDocumentScroll = false,
  fullHeight = true,
  scrollMode = "content",
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
  scrollMode?: "content" | "page";
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
          : "container mx-auto",
        fullHeight && "h-full max-h-full min-h-0",
        className,
      )}
    >
      <div
        className={cn(
          "min-h-0 flex flex-col rounded-lg",
          fullHeight && scrollMode === "content" && "h-full overflow-hidden",
          fullHeight &&
            scrollMode === "page" &&
            "h-full overflow-y-auto overscroll-contain overflow-x-hidden scrollbar-hide",
          !fullHeight && "h-auto",
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
              scrollMode === "content" &&
              "min-h-0 flex-1 overflow-y-auto overscroll-contain overflow-x-hidden scrollbar-hide",
            fullHeight && scrollMode === "page" && "min-h-0 flex-none",
            mainClassName,
          )}
        >
          {children}
        </main>
      </div>
    </section>
  );
}
