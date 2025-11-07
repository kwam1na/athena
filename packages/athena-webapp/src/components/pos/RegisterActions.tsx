import { Badge } from "@/components/ui/badge";
import { Store, Terminal, User } from "lucide-react";

interface RegisterActionsProps {
  customerName?: string;
  registerNumber: string;
}

export function RegisterActions({
  customerName,
  registerNumber,
}: RegisterActionsProps) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex items-center gap-2">
        <Store className="w-3.5 h-3.5" />
        <p className="text-sm font-semibold">{registerNumber}</p>
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
