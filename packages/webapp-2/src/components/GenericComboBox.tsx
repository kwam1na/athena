import { Check, ChevronsUpDown, Palette, Ruler, Shirt } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { useState } from "react";

export interface ComboBoxItem<T> {
  label: string;
  value: T;
}

export function GenericComboBox<T>({
  items,
  activeItem,
  onValueChange,
  equalityFn = (a: T, b: T) => a === b,
}: {
  items: ComboBoxItem<T>[];
  activeItem?: T;
  onValueChange: (value: T) => void;
  placeholder?: string;
  equalityFn?: (a: T, b: T) => boolean;
}) {
  const [open, setOpen] = useState(false);

  const [active, setActive] = useState<T | undefined>(activeItem);

  const actv = activeItem || active;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          className="justify-between"
          variant="outline"
          role="combobox"
          aria-expanded={open}
        >
          {actv && items.find((item) => equalityFn(item.value, actv))?.label}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="max-w-[124px] p-0">
        <Command>
          <CommandList>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.label}
                  value={item.label}
                  onSelect={() => {
                    onValueChange(item.value);
                    setActive(item.value);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      actv === item.value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {item.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
