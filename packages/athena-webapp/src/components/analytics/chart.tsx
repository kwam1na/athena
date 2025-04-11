import { Bar, BarChart, CartesianGrid, XAxis } from "recharts";

import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import { Analytic } from "~/types";
import { countGroupedAnalytics, groupProductViewsByDay } from "./utils";

const chartConfig = {
  viewed_homepage: {
    label: "View homepage",
    color: "hsl(var(--chart-1))",
  },
  viewed_product: {
    label: "View product",
    color: "hsl(var(--chart-2))",
  },
} satisfies ChartConfig;

export function AnalyticsChart({ analytics }: { analytics: Analytic[] }) {
  const productViews = groupProductViewsByDay(analytics);

  const data = Object.entries(productViews).map(([day, values]) => ({
    day,
    ...values,
  }));

  // Extract unique product IDs
  const productIds = new Set<string>();
  data.forEach((entry) => {
    Object.keys(entry).forEach((key) => {
      if (key !== "day") productIds.add(key);
    });
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>Analytics</CardTitle>
        {/* <CardDescription>January - June 2024</CardDescription> */}
      </CardHeader>
      <CardContent>
        {/* <ChartContainer config={chartConfig}>
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 3)}
            />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Bar
              dataKey="viewed_homepage"
              stackId="a"
              fill="var(--color-viewed_homepage)"
              radius={[0, 0, 4, 4]}
            />
            <Bar
              dataKey="viewed_product"
              stackId="a"
              fill="var(--color-viewed_product)"
              radius={[4, 4, 0, 0]}
            />
          </BarChart>
        </ChartContainer> */}

        <ChartContainer config={chartConfig}>
          <BarChart accessibilityLayer data={data}>
            <CartesianGrid vertical={false} />
            <XAxis
              dataKey="day"
              tickLine={false}
              tickMargin={10}
              axisLine={false}
              tickFormatter={(value) => value.slice(0, 3)}
            />
            <ChartTooltip content={<ChartTooltipContent hideLabel />} />
            <ChartLegend content={<ChartLegendContent />} />
            {[...productIds].map((id, index) => (
              <Bar
                key={id}
                dataKey={id}
                stackId="a"
                fill={`hsl(var(--chart-${(index % 5) + 1}))`}
              />
            ))}
          </BarChart>
        </ChartContainer>
      </CardContent>
      {/* <CardFooter className="flex-col items-start gap-2 text-sm">
        <div className="flex gap-2 font-medium leading-none">
          Trending up by 5.2% this month <TrendingUp className="h-4 w-4" />
        </div>
        <div className="leading-none text-muted-foreground">
          Showing total visitors for the last 6 months
        </div>
      </CardFooter> */}
    </Card>
  );
}
