import { Badge } from "@/components/ui/badge";
import { User } from "lucide-react";

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
      <Badge variant="secondary" className="flex items-center gap-1">
        <User className="w-3 h-3" />
        Register {registerNumber}
      </Badge>
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
