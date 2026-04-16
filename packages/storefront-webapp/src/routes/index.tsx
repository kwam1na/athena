import { getBestSellers, getFeatured } from "@/api/product";
import { createFileRoute } from "@tanstack/react-router";
import HomePage from "@/components/HomePage";

export const Route = createFileRoute("/")({
  loader: async () => {
    const [bestSellers, featured] = await Promise.all([
      getBestSellers(),
      getFeatured(),
    ]);

    return {
      bestSellers,
      featured,
    };
  },

  component: HomeRoute,
});

function HomeRoute() {
  const initialData = Route.useLoaderData();

  return <HomePage initialData={initialData} />;
}
