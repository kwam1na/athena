import { ColumnDef } from "@tanstack/react-table";
import { DataTableColumnHeader } from "./data-table-column-header";
import CopyButton from "../../ui/copy-button";
import { Button } from "../../ui/button";
import useGetActiveStore from "~/src/hooks/useGetActiveStore";
import { TrashIcon } from "@radix-ui/react-icons";
import { useMutation } from "convex/react";
import { api } from "~/convex/_generated/api";
import { useState } from "react";
import { toast } from "sonner";
import { LoadingButton } from "../../ui/loading-button";

export type Asset = {
  url: string;
};

export const assetColumns: ColumnDef<Asset>[] = [
  {
    accessorKey: "url",
    header: ({ column }) => (
      <DataTableColumnHeader column={column} title="Image" />
    ),
    cell: ({ row }) => {
      const [isUpdating, setIsUpdating] = useState(false);
      const [isUpdatingShopTheLook, setIsUpdatingShopTheLook] = useState(false);
      const updateConfig = useMutation(api.inventory.stores.updateConfig);
      const { activeStore } = useGetActiveStore();

      const handleUpdateShowroomImage = async () => {
        setIsUpdating(true);

        try {
          await updateConfig({
            id: activeStore?._id!,
            config: {
              ...activeStore?.config,
              showroomImage: row.original.url,
            },
          });
          toast.success("Showroom image updated");
        } catch (error) {
          console.log(error);
          toast.error("An error occurred while updating the showroom image", {
            description: (error as Error).message,
          });
        }

        setIsUpdating(false);
      };

      const handleUpdateShopTheLookImage = async () => {
        setIsUpdatingShopTheLook(true);

        try {
          await updateConfig({
            id: activeStore?._id!,
            config: {
              ...activeStore?.config,
              shopTheLookImage: row.original.url,
            },
          });
          toast.success("Shop the Look image updated");
        } catch (error) {
          console.log(error);
          toast.error(
            "An error occurred while updating the shop the look image",
            {
              description: (error as Error).message,
            }
          );
        }

        setIsUpdatingShopTheLook(false);
      };

      return (
        <div className="flex items-center gap-8">
          <img
            alt="Uploaded image"
            className={`aspect-square w-24 h-24 rounded-md object-cover`}
            src={row.original.url}
          />

          <div className="space-y-4">
            <div className="flex items-center space-x-2">
              <CopyButton stringToCopy={row.original.url} />
              <LoadingButton
                isLoading={isUpdating}
                variant={"outline"}
                size={"sm"}
                onClick={handleUpdateShowroomImage}
              >
                Set as showroom image
              </LoadingButton>
              <LoadingButton
                isLoading={isUpdatingShopTheLook}
                variant={"outline"}
                size={"sm"}
                onClick={handleUpdateShopTheLookImage}
              >
                Set as shop this look image
              </LoadingButton>
              <Button variant={"outline"} size={"sm"}>
                <TrashIcon className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      );
    },
    enableSorting: false,
    enableHiding: false,
  },
];
