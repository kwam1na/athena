import { Button } from "@/components/ui/button";
import { PageState } from "@/components/states/PageState";
import { Link } from "@tanstack/react-router";
import { ArrowRight } from "lucide-react";

export const EmptyState = ({
  message,
  cta,
  ctaDestination,
  showButton = true,
}: {
  message: string;
  cta?: string;
  ctaDestination?: string;
  showButton?: boolean;
}) => {
  const categorySlug =
    ctaDestination?.match(/^\/shop\/([^/?#]+)/)?.[1] ?? "hair";

  return (
    <PageState
      state="empty"
      title={message}
      primaryAction={
        showButton ? (
          <Link to="/shop/$categorySlug" params={{ categorySlug }}>
            <Button variant="clear" className="group">
              {cta || "Continue Shopping"}
              <ArrowRight className="w-4 h-4 ml-2 -me-1 ms-2 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
        ) : undefined
      }
    />
  );
};
