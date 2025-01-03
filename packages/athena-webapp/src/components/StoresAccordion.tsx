import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useGetActiveOrganization } from "@/hooks/useGetOrganizations";
import { Link, useParams } from "@tanstack/react-router";
import { Store } from "lucide-react";
import { Button } from "./ui/button";
import { useStoreModal } from "@/hooks/use-store-modal";
import { PlusIcon } from "@radix-ui/react-icons";
import { StoreActions } from "./StoreActions";
import { useQuery } from "convex/react";
import { api } from "~/convex/_generated/api";

export function StoresAccordion() {
  const storeModal = useStoreModal();

  const { activeOrganization } = useGetActiveOrganization();

  const { storeUrlSlug } = useParams({ strict: false });

  const stores = useQuery(
    api.inventory.stores.getAll,
    activeOrganization?._id
      ? {
          organizationId: activeOrganization._id,
        }
      : "skip"
  );

  return (
    <Accordion
      type="single"
      collapsible
      className="w-full px-4"
      defaultValue="item-1"
    >
      <AccordionItem value="item-1" className="border-none">
        <div className="flex w-full gap-2 items-center justify-between">
          <div className="w-[85%]">
            <AccordionTrigger>
              <div className="flex items-center">
                <Store className="w-4 h-4 text-muted-foreground mr-2" />
                <p className="text-sm text-muted-foreground">Stores</p>
              </div>
            </AccordionTrigger>
          </div>
          {stores && stores.length > 0 && (
            <div className="transition-opacity duration-300 opacity-50 hover:opacity-100">
              <StoreActions />
            </div>
          )}
        </div>
        {stores?.map((store: any) => {
          return (
            <AccordionContent
              key={store._id}
              className="w-full flex items-center"
            >
              <Link
                to={"/$orgUrlSlug/store/$storeUrlSlug/products"}
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
        <AccordionContent>
          <Button variant={"ghost"} onClick={() => storeModal.onOpen()}>
            <PlusIcon className="w-3 h-3 mr-2" />
            Add store
          </Button>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
