import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { useQuery } from "@tanstack/react-query";
import { Link, useRouterState } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Button } from "../../../components/ui/button";
import { getAllOrganizations } from "@/api/organization";

export function OrganizationSettingsAccordion() {
  const router = useRouterState();

  const pathName = router.location.pathname;

  const last = pathName.split("/").at(-1);

  const settings = [
    {
      title: "General",
      href: "/$orgUrlSlug/settings/organization",
      urlSlug: "organization",
    },
  ];

  const { data: organizations } = useQuery({
    queryKey: ["organizations"],
    queryFn: getAllOrganizations,
  });

  return (
    <Accordion type="single" className="w-full px-4" defaultValue="item-1">
      <AccordionItem value="item-1" className="border-none">
        <AccordionTrigger hideChevron>
          <div className="flex items-center">
            <Building2 className="w-4 h-4 text-muted-foreground mr-2" />
            <p className="text-sm text-muted-foreground">Organization</p>
          </div>
        </AccordionTrigger>
        {organizations?.map((organization) => {
          return (
            <AccordionContent
              key={organization.id}
              className="w-full flex flex-col"
            >
              {settings.map((setting, index) => {
                return (
                  <Link
                    key={index}
                    to={setting.href}
                    activeProps={{
                      className: "font-bold",
                    }}
                    params={(prev) => ({
                      ...prev,
                      orgUrlSlug: organization.slug,
                    })}
                  >
                    <Button
                      className={`${last == setting.urlSlug ? "font-bold" : ""}`}
                      variant={"ghost"}
                    >
                      {setting.title}
                    </Button>
                  </Link>
                );
              })}
            </AccordionContent>
          );
        })}
      </AccordionItem>
    </Accordion>
  );
}
