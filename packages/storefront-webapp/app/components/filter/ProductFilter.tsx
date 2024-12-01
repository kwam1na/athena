import { useQuery } from "@tanstack/react-query";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "../ui/accordion";
import { getAllColors } from "@/api/color";
import { OG_ORGANIZTION_ID, OG_STORE_ID } from "@/lib/constants";
import FilterComponent from "../footer/Filter";
import { Separator } from "../ui/separator";

export default function ProductFilter() {
  const { data, isLoading, isFetching, error } = useQuery({
    queryKey: ["products", "colors"],
    queryFn: () =>
      getAllColors({
        organizationId: OG_ORGANIZTION_ID,
        storeId: OG_STORE_ID,
      }),
  });

  const colors = data
    ?.map((col) => ({ label: col.name, value: col._id }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const lengths = [
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
      <Accordion type="single" collapsible className="w-full space-y-4">
        <AccordionItem value="color" className="border-none">
          <AccordionTrigger className="w-[160px]">
            <p className="text-sm">Color</p>
          </AccordionTrigger>

          <AccordionContent>
            <FilterComponent filters={colors || []} type="color" />
          </AccordionContent>
        </AccordionItem>

        <Separator />

        <AccordionItem value="length" className="border-none">
          <AccordionTrigger className="w-[160px]">
            <p className="text-sm">Length</p>
          </AccordionTrigger>

          <AccordionContent>
            <FilterComponent filters={lengths || []} type="length" />
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </div>
  );
}
