import { DotsHorizontalIcon } from "@radix-ui/react-icons";
import { Cog } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { useNavigate } from "@tanstack/react-router";

export function StoreActions() {
  const navigate = useNavigate();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-8 w-8 p-0 data-[state=open]:bg-muted"
        >
          <DotsHorizontalIcon className="h-4 w-4" />
          <span className="sr-only">Open menu</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[160px]">
        <DropdownMenuItem
          onClick={() =>
            navigate({
              to: "/$orgUrlSlug/settings/stores/$storeUrlSlug",
              params: (prev) => ({
                ...prev,
                orgUrlSlug: prev.orgUrlSlug!,
                storeUrlSlug: prev.storeUrlSlug!,
              }),
            })
          }
        >
          <Cog className="w-4 h-4 mr-2 text-muted-foreground" />
          Store settings
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
