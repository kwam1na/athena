import { useLoaderData, useNavigate } from "@tanstack/react-router";
import View from "./View";
import { useQuery } from "@tanstack/react-query";
import { getAllOrganizations } from "@/api/organization";
import { useEffect } from "react";
import SingleLineError from "./states/error/SingleLineError";
import { Organization } from "@athena/db";

export default function Home() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <span>Home</span>
      </div>
    );
  };

  const navigate = useNavigate();

  const organizations = useLoaderData({ from: "/_authed" });

  // const organizations: Organization[] = [];

  useEffect(() => {
    if (organizations && organizations.length > 0) {
      const organization = organizations[0];

      navigate({
        to: "/$orgUrlSlug",
        params: (prev) => ({
          ...prev,
          orgUrlSlug: organization.slug,
        }),
      });
    }
  }, [organizations]);

  return (
    <View header={<Navigation />}>
      <span />
    </View>
  );
}
