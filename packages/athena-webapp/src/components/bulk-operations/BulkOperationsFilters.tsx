import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  BulkOperationType,
  OPERATION_LABELS,
} from "~/src/hooks/useBulkOperations";
import { useGetCategories } from "~/src/hooks/useGetCategories";
import { Loader2 } from "lucide-react";

interface BulkOperationsFiltersProps {
  operation: BulkOperationType;
  operationValue: string;
  validationError: string | null;
  skuCount: number;
  hasPreview: boolean;
  onOperationChange: (op: BulkOperationType) => void;
  onOperationValueChange: (val: string) => void;
  onLoadProducts: (categorySlug?: string, nameSearch?: string) => void;
  onCalculatePreview: () => void;
  isLoading?: boolean;
}

export function BulkOperationsFilters({
  operation,
  operationValue,
  validationError,
  skuCount,
  hasPreview,
  onOperationChange,
  onOperationValueChange,
  onLoadProducts,
  onCalculatePreview,
  isLoading,
}: BulkOperationsFiltersProps) {
  const [categorySlug, setCategorySlug] = useState<string>("");
  const [nameSearch, setNameSearch] = useState("");

  const categories = useGetCategories();

  const handleLoadProducts = () => {
    onLoadProducts(categorySlug || undefined, nameSearch || undefined);
  };

  return (
    <section className="space-y-layout-lg rounded-lg border border-border bg-surface p-layout-md shadow-surface md:p-layout-lg">
      <div className="space-y-1 border-b border-border pb-layout-md">
        <h2 className="text-xl font-semibold text-foreground">
          Bulk price update
        </h2>
        <p className="max-w-2xl text-sm leading-6 text-muted-foreground">
          Filter products, choose an operation, and preview changes before
          applying.
        </p>
      </div>

      {/* Filters Row */}
      <div className="flex flex-col gap-layout-md md:flex-row md:items-end">
        <div className="w-full space-y-layout-xs md:w-52">
          <Label>Category</Label>
          <Select
            value={categorySlug || "all"}
            onValueChange={(v) => setCategorySlug(v === "all" ? "" : v)}
          >
            <SelectTrigger>
              <SelectValue placeholder="All categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories?.map((cat) => (
                <SelectItem key={cat._id} value={cat.slug}>
                  {cat.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-full space-y-layout-xs md:w-72">
          <Label>Product name</Label>
          <Input
            placeholder="Search by name..."
            value={nameSearch}
            onChange={(e) => setNameSearch(e.target.value)}
          />
        </div>

        <div className="flex flex-col justify-end">
          <Button
            onClick={handleLoadProducts}
            className="w-full md:w-auto"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              "Load Products"
            )}
          </Button>
        </div>
      </div>

      {/* Operation Row — only show after products are loaded */}
      {skuCount > 0 && (
        <div className="flex flex-col gap-layout-md border-t border-border pt-layout-lg md:flex-row md:items-start">
          <div className="w-full space-y-layout-xs md:w-44">
            <Label>Target field</Label>
            <Select value="price" disabled>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="price">Price</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="w-full space-y-layout-xs md:w-64">
            <Label>Operation</Label>
            <Select
              value={operation}
              onValueChange={(v) => onOperationChange(v as BulkOperationType)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(OPERATION_LABELS).map(([key, label]) => (
                  <SelectItem key={key} value={key}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="w-full space-y-layout-xs md:w-48">
            <Label>Value</Label>
            <Input
              type="number"
              placeholder="Enter value..."
              value={operationValue}
              onChange={(e) => onOperationValueChange(e.target.value)}
              min={0}
              step="any"
            />
            {validationError && (
              <p className="text-sm text-destructive">{validationError}</p>
            )}
          </div>

          <div className="flex flex-col justify-end pt-6">
            <Button
              onClick={onCalculatePreview}
              className="w-full md:w-auto"
              disabled={!operationValue || !!validationError}
              variant={hasPreview ? "outline" : "default"}
            >
              {hasPreview ? "Recalculate Preview" : "Calculate Preview"}
            </Button>
          </div>
        </div>
      )}

      {skuCount > 0 && (
        <p className="border-t border-border pt-layout-md text-sm text-muted-foreground">
          {skuCount} SKU{skuCount !== 1 ? "s" : ""} loaded
        </p>
      )}
    </section>
  );
}
