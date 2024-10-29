import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { Separator } from "../ui/separator";
import { useEffect, useState } from "react";
import { LoadingButton } from "../ui/loading-button";
import { CheckCircledIcon } from "@radix-ui/react-icons";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import useGetActiveStore from "@/hooks/useGetActiveStore";
import { useMutation, useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";
import { Color } from "~/types";
import { Id } from "~/convex/_generated/dataModel";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { capitalizeWords } from "~/src/lib/utils";

export type AttributeManageOption = "color" | "size";

function Sidebar({
  selected,
  setSelected,
}: {
  selected: AttributeManageOption;
  setSelected: (option: AttributeManageOption) => void;
}) {
  return (
    <div className="flex gap-4">
      <p
        className={`text-left cursor-pointer ${selected == "color" ? "font-medium" : "text-muted-foreground"}`}
        onClick={() => setSelected("color")}
      >
        Colors
      </p>
    </div>
  );
}

function ColorManager() {
  const { activeStore } = useGetActiveStore();

  const colorsData = useQuery(
    api.inventory.colors.getAll,
    activeStore ? { storeId: activeStore._id } : "skip"
  );

  const [name, setName] = useState<string | null>(null);
  const [colorId, setColorId] = useState<Id<"color"> | null>(null);

  const [selectedColor, setSelectedColor] = useState<string | null>(null);

  const [colorIdToRename, setColorIdToRename] = useState<Id<"color"> | null>(
    null
  );

  const [updatedName, setUpdatedName] = useState<string | null>(null);

  const [isCreateMutationPending, setIsCreateMutationPending] = useState(false);
  const [isUpdateMutationPending, setIsUpdateMutationPending] = useState(false);
  const [isDeleteMutationPending, setIsDeleteMutationPending] = useState(false);

  const colors =
    colorsData?.map((color: Color) => ({
      name: color.name,
      id: color._id,
    })) || [];

  useEffect(() => {
    const idToUse = colorId || colorIdToRename;

    const name = colors.find(({ id }) => id == idToUse?.toString())?.name;

    if (name) setSelectedColor(name);
  }, [colorId, colorIdToRename]);

  const updateColor = useMutation(api.inventory.colors.update);

  const deleteColor = useMutation(api.inventory.colors.remove);

  const update = async () => {
    if (!colorIdToRename || !updatedName || !activeStore) {
      throw new Error("Missing data to update category");
    }

    try {
      setIsUpdateMutationPending(true);
      await updateColor({ id: colorIdToRename, name: updatedName });

      toast(`Color '${updatedName}' updated`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsUpdateMutationPending(false);
    }
  };

  const removeColor = async () => {
    if (!colorId || !activeStore) {
      throw new Error("Missing data to remove category");
    }

    try {
      setIsDeleteMutationPending(true);
      await deleteColor({ id: colorId });

      toast(`Color '${selectedColor}' deleted`, {
        icon: <CheckCircledIcon className="w-4 h-4" />,
      });
    } catch (e) {
      toast("Something went wrong", {
        icon: <Ban className="w-4 h-4" />,
        description: (e as Error).message,
      });
    } finally {
      setIsDeleteMutationPending(false);
    }
  };

  return (
    <div className="space-y-16">
      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Update color</p>
        <Separator className="mt-2" />

        <div className="grid gap-4 py-4">
          <div className="flex gap-4 items-center">
            <Label className="text-muted-foreground w-[30%]" htmlFor="category">
              Category
            </Label>

            <div className="flex gap-4 w-full">
              <Select
                onValueChange={(value) =>
                  setColorIdToRename(value as Id<"color">)
                }
              >
                <SelectTrigger id="color" aria-label="Select color">
                  <SelectValue placeholder="Select color" />
                </SelectTrigger>
                <SelectContent>
                  {colors.map((color) => {
                    return (
                      <SelectItem key={color.id} value={color.id}>
                        {capitalizeWords(color.name)}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="flex w-full items-center gap-4">
            <Label className="text-muted-foreground w-[30%]" htmlFor="name">
              Updated name
            </Label>

            <div className="flex gap-4 w-full">
              <Input
                id="name"
                onChange={(e) => setUpdatedName(e.target.value)}
              />
              <LoadingButton
                disabled={!colorIdToRename || !updatedName}
                isLoading={isUpdateMutationPending}
                onClick={() => update()}
                variant={"outline"}
              >
                Update
              </LoadingButton>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-muted-foreground text-sm">Delete color</p>
        <Separator className="mt-2" />

        <div className="flex gap-4 items-center py-4">
          <Label className="text-muted-foreground w-[30%]" htmlFor="color">
            Color
          </Label>

          <div className="flex gap-4 w-full">
            <Select onValueChange={(value) => setColorId(value as Id<"color">)}>
              <SelectTrigger id="color" aria-label="Select color">
                <SelectValue placeholder="Select color" />
              </SelectTrigger>
              <SelectContent>
                {colors.map((color) => {
                  return (
                    <SelectItem key={color.id} value={color.id}>
                      {capitalizeWords(color.name)}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <LoadingButton
              variant={"destructive"}
              disabled={!colorId}
              isLoading={isDeleteMutationPending}
              onClick={() => removeColor()}
            >
              Delete
            </LoadingButton>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AttributesManager({
  initialSelectedOption = "color",
}: {
  initialSelectedOption?: AttributeManageOption;
}) {
  const [selected, setSelected] = useState<AttributeManageOption>(
    initialSelectedOption
  );

  return (
    <div className="flex flex-col gap-8 pb-12">
      <div className="w-[30%]">
        <Sidebar selected={selected} setSelected={setSelected} />
      </div>

      {selected == "color" && <ColorManager />}
    </div>
  );
}

export function AttributesManagerDialog({
  initialSelectedOption,
  open,
  onClose,
}: {
  initialSelectedOption?: AttributeManageOption;
  open: boolean;
  onClose: () => void;
}) {
  const handleClose = () => {
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{`Manage`}</DialogTitle>
        </DialogHeader>
        <AttributesManager initialSelectedOption={initialSelectedOption} />
      </DialogContent>
    </Dialog>
  );
}
