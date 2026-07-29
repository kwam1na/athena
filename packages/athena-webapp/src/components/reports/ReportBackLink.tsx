import { useSearch } from "@tanstack/react-router";
import { ArrowLeftIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useNavigateBack } from "@/hooks/use-navigate-back";

/**
 * Back affordance for a drilled-into reports surface.
 *
 * Renders only when the caller passed an origin (`o`) in the URL, which is
 * how the rest of the app signals "you got here from somewhere specific" —
 * see `getOrigin` and `useNavigateBack`. Absent that, the page was reached
 * directly and there is nothing meaningful to go back to.
 */
export function ReportBackLink({ label = "Back" }: { label?: string }) {
  const navigateBack = useNavigateBack();
  const { o: origin } = useSearch({ strict: false });

  if (!origin) return null;

  return (
    <Button
      className="-ml-2 h-auto gap-2 px-2 py-1 text-muted-foreground"
      onClick={navigateBack}
      type="button"
      variant="ghost"
    >
      <ArrowLeftIcon className="h-4 w-4" />
      {label}
    </Button>
  );
}
