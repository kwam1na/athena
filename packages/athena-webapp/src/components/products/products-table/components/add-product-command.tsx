import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Table } from "@tanstack/react-table";
import { useEffect, useState } from "react";

interface AddProductCommandProps<TData> {
  show?: boolean;
  table: Table<TData>;
}

export function AddProductCommand<TData>({
  show,
  table,
}: AddProductCommandProps<TData>) {
  const [open, setOpen] = useState(show);
  const [value, setValue] = useState("");

  const pageCount = table.getPageCount();
  const parsed = parseInt(value, 10);
  const targetPage = !isNaN(parsed) && parsed >= 1 && parsed <= pageCount ? parsed : null;

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  function goToPage(page: number) {
    table.setPageIndex(page - 1);
    setOpen(false);
    setValue("");
  }

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setValue("");
      }}
    >
      <CommandInput
        placeholder={`Go to page (1–${pageCount})...`}
        value={value}
        onValueChange={setValue}
      />
      <CommandList>
        <CommandEmpty>No matching page</CommandEmpty>
        {targetPage && (
          <CommandGroup heading="Navigation">
            <CommandItem onSelect={() => goToPage(targetPage)}>
              Go to page {targetPage}
            </CommandItem>
          </CommandGroup>
        )}
        <CommandGroup heading="Quick jump">
          <CommandItem onSelect={() => goToPage(1)}>First page</CommandItem>
          <CommandItem onSelect={() => goToPage(pageCount)}>
            Last page
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
