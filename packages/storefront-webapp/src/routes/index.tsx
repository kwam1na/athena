import { createFileRoute } from "@tanstack/react-router";
import HomePage from "@/components/HomePage";
import { loadHomePageData } from "./-homePageLoader";

export const Route = createFileRoute("/")({
  loader: () => loadHomePageData(),
  component: HomeRoute,
});

function HomeRoute() {
  const initialData = Route.useLoaderData();

  return <HomePage initialData={initialData} />;
}
