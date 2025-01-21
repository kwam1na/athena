import { useQuery } from "@tanstack/react-query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { getAllColors } from "@/api/color";
import FilterComponent from "../footer/Filter";
import { Separator } from "../ui/separator";
import { useState } from "react";
import { useGetShopSearchParams } from "../navigation/hooks";
import { useStoreContext } from "@/contexts/StoreContext";

export default function ProductFilter() {
  const { organizationId, storeId } = useStoreContext();
  const { data } = useQuery({
    queryKey: ["products", "colors"],
    queryFn: () =>
      getAllColors({
        organizationId,
        storeId,
      }),
    enabled: Boolean(organizationId && storeId),
  });

  const searchParams = useGetShopSearchParams();

  const [selectedColors, setSelectedColors] = useState(
    searchParams?.color?.split(",")?.length || 0
  );
  const [selectedLength, setSelectedLengths] = useState(
    searchParams?.length?.split(",")?.length || 0
  );

  const colors = data
    ?.map((col) => ({ label: col.name, value: col._id }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const lengths = [
    { value: "8", label: '8"' },
    { value: "10", label: '10"' },
    { value: "12", label: '12"' },
    { value: "18", label: '18"' },
    { value: "20", label: '20"' },
    { value: "22", label: '22"' },
    { value: "24", label: '24"' },
    { value: "26", label: '26"' },
    { value: "28", label: '28"' },
    { value: "30", label: '30"' },
    { value: "32", label: '32"' },
  ];

  return (
    <div>
      <Accordion type="multiple" className="w-full space-y-4">
        <AccordionItem value="color" className="border-none">
          <AccordionTrigger className="w-[160px]">
            <p className="text-sm">
              {selectedColors > 0 ? `Color (${selectedColors})` : "Color"}
            </p>
          </AccordionTrigger>

          <AccordionContent>
            <FilterComponent
              filters={colors || []}
              type="color"
              setSelectedCount={setSelectedColors}
            />
          </AccordionContent>
        </AccordionItem>

        <Separator />

        <AccordionItem value="length" className="border-none">
          <AccordionTrigger className="w-[160px]">
            <p className="text-sm">
              {selectedLength > 0 ? `Length (${selectedLength})` : "Length"}
            </p>
          </AccordionTrigger>

          <AccordionContent>
            <FilterComponent
              filters={lengths || []}
              type="length"
              setSelectedCount={setSelectedLengths}
            />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
