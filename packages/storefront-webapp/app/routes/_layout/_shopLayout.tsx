import ProductFilter from "@/components/filter/ProductFilter";
import ProductFilterBar from "@/components/filter/ProductFilterBar";
import { createFileRoute, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import { z } from "zod";

const productsPageSchema = z.object({
  color: z.string().optional(),
  length: z.string().optional(),
});

export const Route = createFileRoute("/_layout/_shopLayout")({
  component: LayoutComponent,
  validateSearch: productsPageSchema,
});

function LayoutComponent() {
  const [showFilters, setShowFilters] = useState(false);

  return (
    <div className="grid grid-cols-12 gap-4">
      <div className="col-span-12 sticky top-0 z-30 bg-white">
        <ProductFilterBar
          showFilters={showFilters}
          setShowFilters={setShowFilters}
        />
      </div>

      {showFilters && (
        <div className="col-span-2 h-[calc(100vh-124px)] sticky top-16 py-16 px-16 overflow-auto">
          <ProductFilter />
        </div>
      )}

      <div className={showFilters ? "col-span-10 px-12" : "col-span-12 px-12"}>
        <Outlet />
      </div>
    </div>
  );
}
