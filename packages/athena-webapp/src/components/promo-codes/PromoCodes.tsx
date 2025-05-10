import { EmptyState } from "../states/empty/empty-state";
import { BadgePercent, PackageXIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { Button } from "../ui/button";
import { PlusIcon } from "@radix-ui/react-icons";
import { Product, Store } from "~/types";
import { PromoCodesDataTable } from "./table/data-table";
import { columns } from "./table/columns";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { getOrigin } from "~/src/lib/navigationUtils";
import { GenericDataTable } from "../base/table/data-table";

export default function PromoCodes({ promoCodes }: { promoCodes: any[] }) {
  const { activeStore } = useGetActiveStore();

  return (
    <div className="container mx-auto">
      {promoCodes && promoCodes.length > 0 && (
        <div className="py-8">
          <PromoCodesDataTable data={promoCodes} columns={columns} />
        </div>
      )}
      {promoCodes && promoCodes.length == 0 && (
        <div className="flex items-center justify-center min-h-[60vh] w-full">
          <EmptyState
            icon={<BadgePercent className="w-16 h-16 text-muted-foreground" />}
            title={
              <div className="flex gap-1 text-sm">
                <p className="text-muted-foreground">No promo codes for</p>
                <p className="font-medium">{activeStore?.name}</p>
              </div>
            }
            cta={
              <Link
                to="/$orgUrlSlug/store/$storeUrlSlug/promo-codes/new"
                params={(prev) => ({
                  ...prev,
                  storeUrlSlug: prev.storeUrlSlug!,
                  orgUrlSlug: prev.orgUrlSlug!,
                })}
                search={{
                  o: getOrigin(),
                }}
              >
                <Button variant={"outline"}>
                  <PlusIcon className="w-3 h-3 mr-2" />
                  Add code
                </Button>
              </Link>
            }
          />
        </div>
      )}
    </div>
  );
}
