import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Link, useParams } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useGetStores } from "~/src/hooks/useGetActiveStore";

export function StoresSettingsAccordion() {
  const { storeUrlSlug } = useParams({ strict: false });

  const stores = useGetStores();

  return (
    <Accordion
      type="single"
      collapsible
      className="w-full px-4"
      defaultValue="item-1"
    >
      <AccordionItem value="item-1" className="border-none">
        <AccordionTrigger>
          <div className="flex items-center">
            <Store className="w-4 h-4 text-muted-foreground mr-2" />
            <p className="text-sm text-muted-foreground">Stores</p>
          </div>
        </AccordionTrigger>
        {stores?.map((store) => {
          return (
            <AccordionContent
              key={store._id}
              className="w-full flex items-center"
            >
              <Link
                to={"/$orgUrlSlug/settings/stores/$storeUrlSlug"}
                activeProps={{
                  className: "font-bold",
                }}
                params={(prev) => ({
                  ...prev,
                  orgUrlSlug: prev.orgUrlSlug!,
                  storeUrlSlug: store.slug,
                })}
              >
                <Button
                  className={`${store.slug == storeUrlSlug ? "font-bold bg-zinc-100" : ""}`}
                  variant={"ghost"}
                >
                  {store.name}
                </Button>
              </Link>
            </AccordionContent>
          );
        })}
      </AccordionItem>
    </Accordion>
  );
}
