import { Button } from "@/components/ui/button";
import * as Collapsible from "@radix-ui/react-collapsible";
import { User, ChevronDown, ChevronUp } from "lucide-react";

interface QuickActionsBarProps {
  showCustomerInfo: boolean;
  setShowCustomerInfo: (show: boolean) => void;
  disabled: boolean;
}

export function QuickActionsBar({
  showCustomerInfo,
  setShowCustomerInfo,
  disabled,
}: QuickActionsBarProps) {
  return (
    <Collapsible.Root
      open={showCustomerInfo}
      onOpenChange={setShowCustomerInfo}
    >
      <Collapsible.Trigger asChild>
        <Button
          variant={showCustomerInfo ? "default" : "outline"}
          size="sm"
          disabled={disabled}
          className="flex items-center gap-2"
        >
          <User className="w-4 h-4" />
          Customer Info
          {showCustomerInfo ? (
            <ChevronUp className="w-4 h-4" />
          ) : (
            <ChevronDown className="w-4 h-4" />
          )}
        </Button>
      </Collapsible.Trigger>
    </Collapsible.Root>
  );
}
