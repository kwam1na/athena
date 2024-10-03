import { capitalizeFirstLetter } from "@/lib/utils";
import { InfoIcon } from "lucide-react";

export default function NotFound({
  entity,
  entityName,
}: {
  entity: string;
  entityName: string;
}) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="space-y-2">
        <div className="flex items-center gap-1 justify-center">
          <InfoIcon className="w-4 h-4" />
          <p className="font-medium">{`${capitalizeFirstLetter(entity)} not found`}</p>
        </div>
        <div className="flex gap-1">
          <p className="text-muted-foreground">{`There is no ${entity} with the name`}</p>
          <p>{`${entityName}.`}</p>
        </div>
      </div>
    </div>
  );
}
