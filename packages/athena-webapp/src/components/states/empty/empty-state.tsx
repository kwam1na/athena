import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";

interface EmptyStateProps {
  icon: React.ReactNode;
  text: React.ReactNode | string;
  hideButtonIcon?: boolean;
  cta?: React.ReactNode;
  action?: {
    type: "navigate" | "custom";
    params?: Record<string, any>;
    handler?: Function;
    ctaText: string;
  };
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  cta,
  icon,
  text,
  action,
  hideButtonIcon,
}) => {
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
    <div className="flex flex-col items-center justify-center h-[50vh] gap-4">
      <div>{icon}</div>
      {typeof text == "string" ? (
        <p className="text-sm text-center text-muted-foreground">{text}</p>
      ) : (
        text
      )}
      {action && (
        <Button onClick={onClick}>
          {!hideButtonIcon && <Plus className="mr-2 h-4 w-4" />}{" "}
          {action.ctaText}
        </Button>
      )}
      {cta}
    </div>
  );
};
