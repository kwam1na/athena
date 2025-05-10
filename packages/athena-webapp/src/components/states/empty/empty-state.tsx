import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import { LucideIcon } from "lucide-react";

interface EmptyStateProps {
  icon: React.ReactNode;
  title: string | React.ReactNode;
  description?: string;
  hideButtonIcon?: boolean;
  cta?: React.ReactNode;
  action?: {
    type: "navigate" | "custom";
    params?: Record<string, any>;
    handler?: Function;
    ctaText: string;
  };
}

export function EmptyState({
  icon,
  title,
  description,
  cta,
  action,
  hideButtonIcon,
}: EmptyStateProps) {
  const { type, params, handler } = action || {};

  const onClick = () => {
    switch (type) {
      case "navigate":
        const { url } = params || {};
        // router.push(url);
        break;

      case "custom":
        handler?.();
        break;

      default:
        break;
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="mb-4 text-muted-foreground">{icon}</div>
      {typeof title === "string" ? (
        <h3 className="text-lg font-medium">{title}</h3>
      ) : (
        title
      )}
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      {action && (
        <Button onClick={onClick}>
          {!hideButtonIcon && <Plus className="mr-2 h-4 w-4" />}{" "}
          {action.ctaText}
        </Button>
      )}
      {cta}
    </div>
  );
}
