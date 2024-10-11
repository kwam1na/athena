import { Button } from "@/components/ui/button";
import { capitalizeFirstLetter } from "@/lib/utils";
import { Link } from "@tanstack/react-router";
import { ArrowLeft, InfoIcon } from "lucide-react";

export default function NotFound({
  entity,
  entityIdentifier,
}: {
  entity: string;
  entityIdentifier: string;
}) {
  return (
    <div className="h-full flex items-center justify-center">
      <div className="space-y-2">
        <div className="flex items-center gap-1 justify-center">
          <InfoIcon className="w-4 h-4" />
          <p className="font-medium">{`${capitalizeFirstLetter(entity)} not found`}</p>
        </div>

        <div className="flex gap-1">
          <p className="text-muted-foreground">{`There is no ${entity} with the identifier`}</p>
          <p>{`${entityIdentifier}.`}</p>
        </div>

        <Link to="/" className="flex justify-center text-muted-foreground pt-4">
          <Button variant={"outline"}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Take me home
          </Button>
        </Link>
      </div>
    </div>
  );
}
