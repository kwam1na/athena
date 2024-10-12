import React from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Palette, Ruler, Shirt } from "lucide-react";

interface DefaultAttributesToggleGroupProps {
  selectedAttributes: string[];
  setSelectedAttributes: (attrs: string[]) => void;
}

function DefaultAttributesToggleGroup({
  selectedAttributes,
  setSelectedAttributes,
}: DefaultAttributesToggleGroupProps) {
  return (
    <ToggleGroup
      type="multiple"
      value={selectedAttributes}
      onValueChange={(value) => {
        const sortedValue = value.slice().sort((a, b) => {
          if (a === "color") return -1; // 'color' should always come first
          if (b === "color") return 1;
          if (a === "length" && b === "size") return -1; // 'length' should come before 'size'
          if (a === "size" && b === "length") return 1;
          return 0;
        });

        setSelectedAttributes(sortedValue);
      }}
    >
      <ToggleGroupItem
        value="color"
        className="text-muted-foreground"
        aria-label="Toggle color"
      >
        <Palette className="w-4 h-4 mr-2" />
        Color
      </ToggleGroupItem>
      <ToggleGroupItem
        value="length"
        className="text-muted-foreground"
        aria-label="Toggle length"
      >
        <Ruler className="w-4 h-4 mr-2" />
        Length
      </ToggleGroupItem>
      <ToggleGroupItem
        value="size"
        className="text-muted-foreground"
        aria-label="Toggle size"
      >
        <Shirt className="w-4 h-4 mr-2" />
        Size
      </ToggleGroupItem>
    </ToggleGroup>
  );
}

export default DefaultAttributesToggleGroup;