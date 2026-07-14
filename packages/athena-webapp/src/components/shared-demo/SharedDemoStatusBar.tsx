import { Home } from "lucide-react";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
export function SharedDemoStatusBar({ homeHref }: { homeHref: string }) {
  return (
    <div
      aria-label="Demo controls"
      className="flex shrink-0 items-center gap-1 sm:gap-layout-xs"
    >
      <Button asChild variant="utility" size="sm">
        <Link to={homeHref} aria-label="Owner home">
          <Home aria-hidden="true" />
          <span className="hidden lg:inline">Owner home</span>
        </Link>
      </Button>
    </div>
  );
}
