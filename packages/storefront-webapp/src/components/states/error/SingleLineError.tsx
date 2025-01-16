import { InfoIcon } from "lucide-react";

export default function SingleLineError({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="space-y-2">
        <div className="flex items-center gap-1 justify-center">
          <InfoIcon className="w-4 h-4" />
          <p className="font-medium">{message}</p>
        </div>
      </div>
    </div>
  );
}
