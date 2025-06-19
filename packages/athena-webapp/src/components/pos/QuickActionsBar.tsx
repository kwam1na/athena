import { Button } from "@/components/ui/button";
import * as Collapsible from "@radix-ui/react-collapsible";
import { User, ChevronDown, ChevronUp } from "lucide-react";

interface QuickActionsBarProps {
  showCustomerInfo: boolean;
  setShowCustomerInfo: (show: boolean) => void;
}

export function QuickActionsBar({
  showCustomerInfo,
  setShowCustomerInfo,
}: QuickActionsBarProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-3">
        <div className="h-6 w-1 bg-green-600 rounded-full"></div>
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Quick Actions</h3>
          <p className="text-sm text-gray-500">Manage customer information</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Collapsible.Root
          open={showCustomerInfo}
          onOpenChange={setShowCustomerInfo}
        >
          <Collapsible.Trigger asChild>
            <Button
              variant={showCustomerInfo ? "default" : "outline"}
              className="flex items-center gap-2"
            >
              <User className="w-4 h-4" />
              Customer Information
              {showCustomerInfo ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </Button>
          </Collapsible.Trigger>
        </Collapsible.Root>
      </div>
    </div>
  );
}
