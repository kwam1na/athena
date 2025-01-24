import { CogIcon } from "lucide-react";
import { Button } from "../ui/button";
import View from "../View";
import ProductAttributes from "./ProductAttributes";
import { useState } from "react";
import {
  AttributeManageOption,
  AttributesManagerDialog,
} from "./AttributesManager";

export function ProductAttributesView() {
  const [dialogOptions, setDialogOptions] = useState<{
    isOpen: boolean;
    initialSelected: AttributeManageOption;
  }>({
    isOpen: false,
    initialSelected: "color",
  });

  return (
    <View
      hideBorder
      hideHeaderBottomBorder
      className="h-auto"
      header={
        <div className="flex items-center justify-between">
          <p className="text-sm text-sm">Attributes</p>
          <div className="space-x-2">
            <Button
              className="text-muted-foreground"
              variant={"ghost"}
              size={"icon"}
              onClick={() =>
                setDialogOptions((prev) => ({ ...prev, isOpen: true }))
              }
            >
              <CogIcon className="w-4 h-4" />
            </Button>
          </div>
        </div>
      }
    >
      <AttributesManagerDialog
        open={dialogOptions.isOpen}
        initialSelectedOption={dialogOptions.initialSelected}
        onClose={() => setDialogOptions((prev) => ({ ...prev, isOpen: false }))}
      />
      <ProductAttributes />
    </View>
  );
}
