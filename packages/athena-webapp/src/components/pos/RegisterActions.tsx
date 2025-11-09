import { Badge } from "@/components/ui/badge";
import { AlertTriangle, Store, User } from "lucide-react";
import { cn } from "~/src/lib/utils";

interface RegisterActionsProps {
  customerName?: string;
  registerNumber: string;
  hasTerminal: boolean;
}

export function RegisterActions({
  customerName,
  registerNumber,
  hasTerminal,
}: RegisterActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2">
        {hasTerminal ? (
          <Store className="w-3.5 h-3.5" />
        ) : (
          <AlertTriangle className="w-3.5 h-3.5" />
        )}
        <p
          className={cn(
            "text-sm font-semibold",
            !hasTerminal && "text-red-500"
          )}
        >
          {registerNumber}
        </p>
      </div>
      {customerName && (
        <Badge
          variant="default"
          className="flex items-center gap-1 bg-pink-600"
        >
          <User className="w-3 h-3" />
          {customerName}
        </Badge>
      )}
    </div>
  );
}
