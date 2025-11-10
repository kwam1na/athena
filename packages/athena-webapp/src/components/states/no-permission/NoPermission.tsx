import { ShieldAlert } from "lucide-react";

export default function NoPermission() {
  return (
    <div className="h-full flex items-center justify-center min-h-[60vh]">
      <div className="space-y-2 text-center">
        <div className="flex items-center gap-2 justify-center">
          <ShieldAlert className="w-5 h-5 text-amber-600" />
          <p className="font-medium text-lg">Access Denied</p>
        </div>

        <div className="flex flex-col gap-1 max-w-md">
          <p className="text-muted-foreground">
            You don't have permission to access this feature
          </p>
        </div>
      </div>
    </div>
  );
}
