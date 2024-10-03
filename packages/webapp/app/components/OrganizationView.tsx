import { getAllOrganizations } from "@/api/organization";
import View from "./View";
import { useQuery } from "@tanstack/react-query";
import { useLoaderData, useNavigate, useParams } from "@tanstack/react-router";
import NotFound from "./states/not-found/NotFound";
import SingleLineError from "./states/error/SingleLineError";
import Spinner from "./ui/spinner";
import { useEffect } from "react";

export default function OrganizationView() {
  const Navigation = () => {
    return (
      <div className="flex gap-2 h-[40px]">
        <div className="flex items-center"></div>
      </div>
    );
  };

  const navigate = useNavigate();

  // const state = Route.useLoaderData()
  const organizations = useLoaderData({ from: "__root__" });

  // const {
  //   data: organizations,
  //   isLoading,
  //   error: fetchOrganizationsError,
  // } = useQuery({
  //   queryKey: ["organizations"],
  //   queryFn: getAllOrganizations,
  // });

  // const { orgUrlSlug } = useParams({ strict: false });

  // const isValidOrganizationName =
  //   organizations &&
  //   organizations.some((organization) => organization.slug == orgUrlSlug);

  // console.log(data);

  // useEffect(() => {
  //   if (organizations) {
  //     const organization = organizations[0];

  //     navigate({
  //       to: "/$orgUrlSlug",
  //       params: (prev) => ({ ...prev, orgUrlSlug: organization.slug }),
  //     });
  //   }
  // }, [organizations]);

  return (
    <View className="bg-background" header={<Navigation />}>
      {/* {!isValidOrganizationName &&
        orgUrlSlug &&
        !isLoading &&
        !fetchOrganizationsError && (
          <NotFound entity="organization" entityName={orgUrlSlug} />
        )} */}
      {/* {fetchOrganizationsError && (
        <SingleLineError message={fetchOrganizationsError.message} />
      )} */}
      {/* {isLoading && <Spinner />} */}
      <span></span>
    </View>
  );
}
