import type { ReactNode } from "react";
import { Search, X } from "lucide-react";

import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn } from "@/lib/utils";

type SkuSearchFilterOption<TValue extends string> = {
  label: string;
  value: TValue;
};

type SkuSearchFilterBarProps<TValue extends string> = {
  action?: ReactNode;
  ariaLabel: string;
  className?: string;
  clearLabel?: string;
  filterId: string;
  filterLabel: string;
  filterOptions: Array<SkuSearchFilterOption<TValue>>;
  filterTriggerClassName?: string;
  filterValue: TValue;
  hasActiveFilters: boolean;
  onClearFilters: () => void;
  onFilterChange: (value: TValue) => void;
  onQueryChange: (query: string) => void;
  query: string;
  scanAction?: ReactNode;
  searchId: string;
  searchLabel: string;
  searchPlaceholder: string;
  secondaryFilters?: ReactNode;
  summary: ReactNode;
};

export function SkuSearchFilterBar<TValue extends string>({
  action,
  ariaLabel,
  className,
  clearLabel = "Clear",
  filterId,
  filterLabel,
  filterOptions,
  filterTriggerClassName = "w-[180px]",
  filterValue,
  hasActiveFilters,
  onClearFilters,
  onFilterChange,
  onQueryChange,
  query,
  scanAction,
  searchId,
  searchLabel,
  searchPlaceholder,
  secondaryFilters,
  summary,
}: SkuSearchFilterBarProps<TValue>) {
  return (
    <section
      aria-label={ariaLabel}
      className={cn(
        "rounded-md border border-border bg-surface-raised px-layout-md py-layout-md",
        className,
      )}
    >
      <div className="flex flex-col gap-layout-md lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0 flex-1">
          <Label className="sr-only" htmlFor={searchId}>
            {searchLabel}
          </Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              className={scanAction ? "pl-9 pr-12" : "pl-9"}
              id={searchId}
              onChange={(event) => onQueryChange(event.target.value)}
              placeholder={searchPlaceholder}
              value={query}
            />
            {scanAction}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Label className="sr-only" htmlFor={filterId}>
            {filterLabel}
          </Label>
          <Select
            onValueChange={(value) => onFilterChange(value as TValue)}
            value={filterValue}
          >
            <SelectTrigger className={filterTriggerClassName} id={filterId}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {filterOptions.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {action}
          {hasActiveFilters ? (
            <Button
              className="text-muted-foreground"
              onClick={onClearFilters}
              type="button"
              variant="outline"
            >
              <X className="h-4 w-4" />
              {clearLabel}
            </Button>
          ) : null}
        </div>
      </div>
      {secondaryFilters ? (
        <div className="mt-layout-md border-t border-border pt-layout-sm">
          {secondaryFilters}
        </div>
      ) : null}
      <p className="mt-layout-sm text-xs text-muted-foreground">{summary}</p>
    </section>
  );
}
